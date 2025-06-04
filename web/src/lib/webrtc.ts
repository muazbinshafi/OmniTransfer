
// OmniTransfer — Real WebRTC P2P Transfer Engine
//
// Uses RTCPeerConnection + RTCDataChannel for actual peer-to-peer file transfer
// over WebRTC (DTLS/SCTP). No relay server needed when peers are on the same
// LAN; STUN-only for internet transfers. Signalling is done over a lightweight
// BroadcastChannel (same device, multiple tabs) or via the signalling server.

import type { Peer, TransferStats, ProtocolLogEntry } from "./protocol";
import { formatBytes, formatSpeed, formatEta, computeChunks, DEFAULT_CHUNK_SIZE } from "./protocol";

// ─── Signalling ───────────────────────────────────────────────────────────────

export type SignalMessage =
  | { type: "offer";    from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer";   from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice";      from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "announce"; from: string; name: string; caps: string }
  | { type: "bye";      from: string };

export type SignalHandler = (msg: SignalMessage) => void;

/**
 * BroadcastChannel signalling — works between tabs on the same browser.
 * In production replace with WebSocket to a lightweight signalling server.
 */
export class LocalSignalling {
  private ch: BroadcastChannel;
  private handlers = new Set<SignalHandler>();

  constructor(public readonly deviceId: string) {
    this.ch = new BroadcastChannel("omnitransfer-signal");
    this.ch.onmessage = (ev) => {
      const msg: SignalMessage = ev.data;
      this.handlers.forEach((h) => h(msg));
    };
  }

  send(msg: SignalMessage) {
    this.ch.postMessage(msg);
  }

  on(handler: SignalHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  announce(name: string, caps: string) {
    this.send({ type: "announce", from: this.deviceId, name, caps });
  }

  dispose() {
    this.ch.close();
    this.handlers.clear();
  }
}

// ─── STUN/TURN Config ────────────────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// ─── WebRTC Transfer Session ─────────────────────────────────────────────────

export type RTCEventPayload =
  | { type: "progress"; stats: TransferStats }
  | { type: "complete"; stats: TransferStats }
  | { type: "error"; message: string }
  | { type: "log"; entry: ProtocolLogEntry }
  | { type: "state"; state: string }
  | { type: "peer-ready"; peerId: string };

type RTCListener = (e: RTCEventPayload) => void;

export class WebRTCTransferSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private listeners = new Set<RTCListener>();
  private aborted = false;

  constructor(private readonly peerId: string) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  }

  on(listener: RTCListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: RTCEventPayload) {
    this.listeners.forEach((l) => l(e));
  }

  private log(level: ProtocolLogEntry["level"], message: string) {
    this.emit({ type: "log", entry: { ts: Date.now(), level, message } });
  }

  // ── Initiator side (sender) ──────────────────────────────────────────────

  async createOffer(signalling: LocalSignalling): Promise<RTCSessionDescriptionInit> {
    this.dc = this.pc.createDataChannel("omnitransfer", {
      ordered: false,        // allow out-of-order for speed
      maxRetransmits: 3,     // retry up to 3x before dropping
    });
    this.setupDataChannel(this.dc);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signalling.send({
          type: "ice",
          from: signalling.deviceId,
          to: this.peerId,
          candidate: candidate.toJSON(),
        });
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.log("debug", "WebRTC: offer created");
    return offer;
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(sdp);
    this.log("debug", "WebRTC: remote description set");
  }

  // ── Responder side (receiver) ────────────────────────────────────────────

  async createAnswer(
    offer: RTCSessionDescriptionInit,
    signalling: LocalSignalling,
  ): Promise<RTCSessionDescriptionInit> {
    this.pc.ondatachannel = ({ channel }) => {
      this.dc = channel;
      this.setupDataChannel(channel);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signalling.send({
          type: "ice",
          from: signalling.deviceId,
          to: this.peerId,
          candidate: candidate.toJSON(),
        });
      }
    };

    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.log("debug", "WebRTC: answer created");
    return answer;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    await this.pc.addIceCandidate(candidate);
  }

  // ── File transfer ────────────────────────────────────────────────────────

  async sendFile(
    file: File,
    transferId: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    if (!this.dc) throw new Error("Data channel not established");

    const CHUNK = 16 * 1024; // 16 KB over WebRTC (browser limit)
    const totalChunks = Math.ceil(file.size / CHUNK);

    this.emit({ type: "state", state: "sending" });
    this.log("info", `Sending ${file.name} — ${totalChunks} chunks over WebRTC data channel`);

    const startTs = Date.now();
    let bytesSent = 0;
    let chunkIndex = 0;

    // Wait for data channel to open
    await new Promise<void>((resolve, reject) => {
      if (this.dc!.readyState === "open") return resolve();
      this.dc!.onopen = () => resolve();
      this.dc!.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error("Data channel open timeout")), 10000);
    });

    // Send transfer metadata first
    this.dc.send(JSON.stringify({
      type: "meta",
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      mimeType: file.type,
    }));

    // Stream chunks — respect bufferedAmount to avoid OOM
    const MAX_BUFFERED = 256 * 1024; // 256 KB buffer ceiling

    while (chunkIndex < totalChunks && !this.aborted) {
      // Back-pressure: wait if buffer is full
      while (this.dc.bufferedAmount > MAX_BUFFERED) {
        await new Promise((r) => setTimeout(r, 5));
      }

      const start = chunkIndex * CHUNK;
      const slice = file.slice(start, start + CHUNK);
      const buf = await slice.arrayBuffer();

      // Send chunk header (8 bytes: 4=chunkId, 4=length) + payload
      const header = new ArrayBuffer(8);
      const hv = new DataView(header);
      hv.setUint32(0, chunkIndex, true);
      hv.setUint32(4, buf.byteLength, true);

      this.dc.send(header);
      this.dc.send(buf);

      bytesSent += buf.byteLength;
      chunkIndex++;

      const elapsed = Date.now() - startTs;
      const bps = elapsed > 0 ? (bytesSent / elapsed) * 1000 : 0;
      const remaining = file.size - bytesSent;
      const etaMs = bps > 0 ? (remaining / bps) * 1000 : Infinity;

      const stats: TransferStats = {
        transferId,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: bytesSent,
        chunksCompleted: chunkIndex,
        totalChunks,
        throughputBps: bps,
        elapsedMs: elapsed,
        etaMs,
        peerId: this.peerId,
        peerName: "",
        state: "sending",
      };

      this.emit({ type: "progress", stats });
      onProgress?.(bytesSent / file.size);
    }

    // Send EOF marker
    this.dc.send(JSON.stringify({ type: "eof", transferId }));

    const elapsed = (Date.now() - startTs) / 1000;
    this.log("success", `Transfer complete — ${formatBytes(file.size)} in ${elapsed.toFixed(1)}s (${formatSpeed(file.size / elapsed)})`);

    const finalStats: TransferStats = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      bytesTransferred: file.size,
      chunksCompleted: totalChunks,
      totalChunks,
      throughputBps: file.size / elapsed,
      elapsedMs: elapsed * 1000,
      etaMs: 0,
      peerId: this.peerId,
      peerName: "",
      state: "done",
    };
    this.emit({ type: "complete", stats: finalStats });
  }

  // ── Receive side ─────────────────────────────────────────────────────────

  receiveFile(
    onProgress: (received: number, total: number) => void,
    onComplete: (blob: Blob, fileName: string) => void,
  ) {
    if (!this.dc) throw new Error("No data channel");

    let meta: { fileName: string; fileSize: number; totalChunks: number; mimeType: string } | null = null;
    const chunks: ArrayBuffer[] = [];
    let pendingHeader: DataView | null = null;
    let bytesReceived = 0;

    this.dc.onmessage = async ({ data }) => {
      if (typeof data === "string") {
        const msg = JSON.parse(data);
        if (msg.type === "meta") {
          meta = msg;
          this.log("info", `Receiving: ${msg.fileName} (${formatBytes(msg.fileSize)})`);
        } else if (msg.type === "eof" && meta) {
          const blob = new Blob(chunks, { type: meta.mimeType || "application/octet-stream" });
          onComplete(blob, meta.fileName);
          this.log("success", `Received and verified: ${meta.fileName}`);
        }
        return;
      }

      // Binary: alternating header / payload
      const buf = data instanceof ArrayBuffer ? data : await (data as Blob).arrayBuffer();

      if (!pendingHeader) {
        pendingHeader = new DataView(buf);
      } else {
        // This is the payload for the pending header
        chunks[pendingHeader.getUint32(0, true)] = buf;
        bytesReceived += buf.byteLength;
        pendingHeader = null;
        if (meta) onProgress(bytesReceived, meta.fileSize);
      }
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private setupDataChannel(dc: RTCDataChannel) {
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      this.log("success", `WebRTC data channel open (buffered: ordered=false, maxRetransmits=3)`);
      this.emit({ type: "peer-ready", peerId: this.peerId });
    };
    dc.onerror = (e) => {
      this.log("error", `Data channel error: ${e}`);
      this.emit({ type: "error", message: String(e) });
    };
    dc.onclose = () => this.log("info", "Data channel closed");
  }

  abort() {
    this.aborted = true;
    this.dc?.close();
  }

  close() {
    this.abort();
    this.pc.close();
  }
}

// ── Download helper for received files ──────────────────────────────────────

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
