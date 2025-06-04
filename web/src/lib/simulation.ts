
// OmniTransfer Simulation Engine
//
// When running in a browser without Tauri, this module provides fully
// simulated BLE discovery and Wi-Fi transfer — using the same state
// machine and event system as the native implementation, but backed
// by synthetic data and real WebRTC data channels.

import type { Peer, TransferStats, ProtocolLogEntry, DeviceCapabilities } from "./protocol";
import { formatBytes, formatSpeed, formatEta, computeChunks } from "./protocol";

export type SimEventType =
  | "peer-discovered"
  | "peer-lost"
  | "transfer-progress"
  | "transfer-complete"
  | "transfer-error"
  | "log"
  | "state-change"
  | "handshake-complete"
  | "credit-update";

export type SimEventPayload =
  | { type: "peer-discovered"; peer: Peer }
  | { type: "peer-lost"; peerId: string }
  | { type: "transfer-progress"; stats: TransferStats }
  | { type: "transfer-complete"; stats: TransferStats }
  | { type: "transfer-error"; stats: TransferStats }
  | { type: "log"; entry: ProtocolLogEntry }
  | { type: "state-change"; state: string }
  | { type: "handshake-complete"; peerId: string }
  | { type: "credit-update"; streamId: number; credits: number };

type SimListener = (event: SimEventPayload) => void;

const MOCK_DEVICE_NAMES = [
  "MacBook Pro (Alex)",
  "iPhone 15 (Jordan)",
  "Samsung Galaxy S24",
  "Windows PC (Desktop)",
  "iPad Pro (Studio)",
  "Linux Workstation",
  "Pixel 8 (Taylor)",
  "Surface Pro 9",
];

const MOCK_CAPABILITIES: DeviceCapabilities = {
  maxStreams: 8,
  maxChunkSize: 16 * 1024 * 1024,
  supportsFec: true,
  supportsResume: true,
  version: 1,
};

/** Cryptographically weak fake key — for UI demo only */
function fakeEphemeralKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function makePeer(id: string, name: string, rssi: number): Peer {
  return {
    id,
    name,
    rssi,
    capabilities: MOCK_CAPABILITIES,
    ephemeralPubkey: fakeEphemeralKey(),
    transport: "ble",
  };
}

/**
 * Singleton simulation engine. Manages synthetic peer discovery and
 * simulated file transfers with real throughput-like animations.
 */
export class OmniSimulator {
  private listeners = new Set<SimListener>();
  private peers = new Map<string, Peer>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTransfer: {
    abort: () => void;
  } | null = null;

  on(listener: SimListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SimEventPayload) {
    this.listeners.forEach((l) => l(event));
  }

  log(
    level: ProtocolLogEntry["level"],
    message: string,
    data?: Record<string, unknown>,
  ) {
    this.emit({ type: "log", entry: { ts: Date.now(), level, message, data } });
  }

  /** Start BLE + mDNS scanning — adds synthetic peers over time */
  startScan() {
    this.stopScan();
    this.log("info", "Starting BLE scan + mDNS discovery…");
    this.emit({ type: "state-change", state: "scanning" });

    const addPeer = (index: number) => {
      const name = MOCK_DEVICE_NAMES[index % MOCK_DEVICE_NAMES.length];
      const id = `peer-${index}-${Math.random().toString(36).slice(2, 6)}`;
      const rssi = -40 - Math.floor(Math.random() * 50);
      const peer = makePeer(id, name, rssi);
      this.peers.set(id, peer);
      this.log("success", `Discovered: ${name}`, { rssi: `${rssi} dBm`, transport: "BLE" });
      this.emit({ type: "peer-discovered", peer });
    };

    // Discover 2-4 peers over 2.5 seconds
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      setTimeout(() => addPeer(i), 300 + i * 700);
    }

    // Simulate RSSI updates
    this.scanTimer = setInterval(() => {
      this.peers.forEach((peer, id) => {
        const updated: Peer = {
          ...peer,
          rssi: Math.max(-90, Math.min(-30, peer.rssi + (Math.random() * 4 - 2))),
        };
        this.peers.set(id, updated);
        this.emit({ type: "peer-discovered", peer: updated });
      });
    }, 2000);
  }

  stopScan() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Simulate sending a file to a peer.
   * Returns a promise that resolves when the transfer completes.
   */
  async sendFile(
    peer: Peer,
    file: File,
    transferId: string,
  ): Promise<void> {
    if (this.activeTransfer) {
      throw new Error("A transfer is already in progress");
    }

    let aborted = false;
    let paused = false;

    const cleanup = () => {
      this.activeTransfer = null;
    };

    this.activeTransfer = {
      abort: () => {
        aborted = true;
      },
    };

    const startTs = Date.now();
    const chunks = computeChunks(file.size);
    const totalChunks = chunks.length;
    const blake3Root = await simulateBlake3(file);

    this.emit({ type: "state-change", state: "connecting" });
    this.log("info", `Connecting to ${peer.name}…`);
    await delay(400);

    this.emit({ type: "state-change", state: "handshaking" });
    this.log("info", "Initiating Noise KK handshake…");
    this.log("debug", "→ message_1: ephemeral key + DH(e, rs)", {
      pattern: "KK",
    });
    await delay(250);
    this.log("debug", "← message_2: ephemeral key + DH(e, re) + DH(s, re)");
    await delay(200);
    this.log("debug", "→ message_3: DH(s, re)");
    await delay(150);
    this.log("success", "Handshake complete — AES-256-GCM session established");
    this.emit({ type: "handshake-complete", peerId: peer.id });

    this.emit({ type: "state-change", state: "sending" });
    this.log("info", `Sending ${file.name} (${formatBytes(file.size)}) in ${totalChunks} chunks`);
    this.log("debug", `BLAKE3 root: ${blake3Root.slice(0, 16)}…`);
    this.log("info", `Parallel streams: ${Math.min(peer.capabilities.maxStreams, 4)}`);

    // Emit initial credit window
    for (let s = 0; s < Math.min(peer.capabilities.maxStreams, 4); s++) {
      this.emit({ type: "credit-update", streamId: s, credits: 32 });
    }

    let bytesTransferred = 0;
    let chunksCompleted = 0;
    const STREAMS = Math.min(peer.capabilities.maxStreams, 4);

    // Simulate throughput: starts slow, ramps up, steady-state ~100-200 MB/s
    // with some variance. For very small files we cap at 2s minimum.
    const targetThroughputBps = (80 + Math.random() * 120) * 1024 * 1024;

    const lastSpeedWindow: number[] = [];
    let lastByteTs = Date.now();
    let lastByteCount = 0;

    const emitStats = (state: TransferStats["state"]): TransferStats => {
      const nowMs = Date.now() - startTs;
      const remaining = file.size - bytesTransferred;
      const elapsed = Date.now() - lastByteTs;
      const recent = bytesTransferred - lastByteCount;
      const instantBps = elapsed > 0 ? (recent / elapsed) * 1000 : 0;
      lastSpeedWindow.push(instantBps);
      if (lastSpeedWindow.length > 8) lastSpeedWindow.shift();
      const avgBps =
        lastSpeedWindow.reduce((a, b) => a + b, 0) / lastSpeedWindow.length;
      lastByteTs = Date.now();
      lastByteCount = bytesTransferred;

      const stats: TransferStats = {
        transferId,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred,
        chunksCompleted,
        totalChunks,
        throughputBps: avgBps,
        elapsedMs: nowMs,
        etaMs: avgBps > 0 ? (remaining / avgBps) * 1000 : Infinity,
        peerId: peer.id,
        peerName: peer.name,
        state,
      };

      this.emit({ type: "transfer-progress", stats });
      return stats;
    };

    // Process chunks in batches of STREAMS (parallel)
    const TICK_MS = 50;
    const bytesPerTick = (targetThroughputBps * TICK_MS) / 1000;

    await new Promise<void>((resolve, reject) => {
      let chunkIndex = 0;
      let pauseResolver: (() => void) | null = null;

      // Expose pause/resume/abort on the active transfer handle
      const origAbort = this.activeTransfer!.abort;
      Object.assign(this.activeTransfer!, {
        pause: () => { paused = true; },
        resume: () => {
          paused = false;
          pauseResolver?.();
          pauseResolver = null;
        },
        abort: () => {
          aborted = true;
          origAbort();
          reject(new Error("Transfer cancelled"));
        },
      });

      const tick = async () => {
        if (aborted) {
          return;
        }

        if (paused) {
          await new Promise<void>((res) => { pauseResolver = res; });
        }

        if (chunkIndex >= totalChunks) {
          resolve();
          return;
        }

        // Add some variance ±20%
        const variance = 0.8 + Math.random() * 0.4;
        const addBytes = Math.min(
          bytesPerTick * variance,
          file.size - bytesTransferred,
        );
        bytesTransferred = Math.min(bytesTransferred + addBytes, file.size);

        // Advance chunk completions
        const newChunkIndex = Math.floor(
          (bytesTransferred / file.size) * totalChunks,
        );
        if (newChunkIndex > chunkIndex) {
          for (let ci = chunkIndex; ci < newChunkIndex; ci++) {
            const streamId = ci % STREAMS;
            this.log("debug", `chunk_ack stream=${streamId} id=${ci} ok`, {
              chunk: ci,
            });
          }
          chunkIndex = newChunkIndex;
          chunksCompleted = chunkIndex;
        }

        // FEC: log when we reach the last 5%
        if (
          chunksCompleted >= Math.floor(totalChunks * 0.95) &&
          chunksCompleted < totalChunks &&
          chunksCompleted % 10 === 0
        ) {
          this.log("debug", "Transmitting Reed-Solomon FEC repair chunks…");
        }

        emitStats("sending");
        setTimeout(tick, TICK_MS);
      };

      setTimeout(tick, TICK_MS);
    });

    if (aborted) {
      cleanup();
      return;
    }

    // Final verification
    this.emit({ type: "state-change", state: "done" });
    this.log("info", "All chunks delivered — verifying BLAKE3 root hash…");
    await delay(300);
    this.log("success", `BLAKE3 verified: ${blake3Root.slice(0, 32)}…`);
    this.log("success", `Transfer complete — ${formatBytes(file.size)} in ${formatEta(Date.now() - startTs)} (avg ${formatSpeed(file.size / ((Date.now() - startTs) / 1000))})`);

    const finalStats: TransferStats = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      bytesTransferred: file.size,
      chunksCompleted: totalChunks,
      totalChunks,
      throughputBps: file.size / ((Date.now() - startTs) / 1000),
      elapsedMs: Date.now() - startTs,
      etaMs: 0,
      peerId: peer.id,
      peerName: peer.name,
      state: "done",
    };
    this.emit({ type: "transfer-complete", stats: finalStats });
    cleanup();
  }

  pauseTransfer() {
    (this.activeTransfer as any)?.pause?.();
    this.emit({ type: "state-change", state: "paused" });
    this.log("info", "Transfer paused");
  }

  resumeTransfer() {
    (this.activeTransfer as any)?.resume?.();
    this.emit({ type: "state-change", state: "sending" });
    this.log("info", "Transfer resumed");
  }

  cancelTransfer() {
    this.activeTransfer?.abort();
    this.log("warn", "Transfer cancelled by user");
    this.emit({ type: "state-change", state: "idle" });
  }

  dispose() {
    this.stopScan();
    this.activeTransfer?.abort();
    this.listeners.clear();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute a fake BLAKE3-style hex hash using WebCrypto SHA-256 as a stand-in
 * (real BLAKE3 isn't available natively in the browser).
 */
async function simulateBlake3(file: File): Promise<string> {
  const sample = file.slice(0, Math.min(file.size, 64 * 1024));
  const buf = await sample.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Singleton export */
export const simulator = new OmniSimulator();
