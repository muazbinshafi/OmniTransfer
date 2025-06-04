
// useTransfer — Unified Transfer Hook
//
// Manages peer discovery, file selection, and transfer lifecycle.
// In the browser: uses real WebRTC P2P via LocalSignalling (BroadcastChannel).
// In Tauri: proxies to native IPC commands.
// Falls back to simulation if WebRTC is unavailable.

import { useState, useEffect, useCallback, useRef } from "react";
import type { Peer, TransferStats, ProtocolLogEntry } from "../lib/protocol";
import { discovery, getDeviceId, getDeviceName } from "../lib/discovery";
import { WebRTCTransferSession, LocalSignalling, downloadBlob, type RTCEventPayload } from "../lib/webrtc";
import { simulator } from "../lib/simulation";
import type { SimEventPayload } from "../lib/simulation";
import { isTauri } from "../lib/bridge";

export type TransferPhase =
  | "idle"
  | "scanning"
  | "connecting"
  | "handshaking"
  | "sending"
  | "receiving"
  | "paused"
  | "done"
  | "error";

export interface TransferSession {
  phase: TransferPhase;
  peers: Peer[];
  selectedPeer: Peer | null;
  selectedFile: File | null;
  stats: TransferStats | null;
  log: ProtocolLogEntry[];
  isScanning: boolean;
  error: string | null;
  deviceId: string;
  deviceName: string;
  isWebRTC: boolean;

  scan: () => void;
  stopScan: () => void;
  selectPeer: (peer: Peer) => void;
  selectFile: (file: File) => void;
  send: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  reset: () => void;
  clearLog: () => void;
}

const MAX_LOG = 300;

const isWebRTCAvailable = () =>
  typeof window !== "undefined" &&
  typeof window.RTCPeerConnection !== "undefined" &&
  typeof BroadcastChannel !== "undefined";

export function useTransfer(): TransferSession {
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stats, setStats] = useState<TransferStats | null>(null);
  const [log, setLog] = useState<ProtocolLogEntry[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<WebRTCTransferSession | null>(null);
  const transferIdRef = useRef<string>("");
  const useRealWebRTC = isWebRTCAvailable() && !isTauri();

  const addLog = useCallback((entry: ProtocolLogEntry) => {
    setLog((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  }, []);

  const logMsg = useCallback(
    (level: ProtocolLogEntry["level"], message: string) => {
      addLog({ ts: Date.now(), level, message });
    },
    [addLog],
  );

  // ── Real WebRTC discovery ─────────────────────────────────────────────────
  useEffect(() => {
    if (!useRealWebRTC) return;

    const off = discovery.on((e) => {
      if (e.type === "peer-found") {
        setPeers((prev) => {
          const idx = prev.findIndex((p) => p.id === e.peer.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = e.peer;
            return next;
          }
          return [...prev, e.peer];
        });
        logMsg("success", `Discovered peer: ${e.peer.name} [WebRTC]`);
      }
      if (e.type === "peer-lost") {
        setPeers((prev) => prev.filter((p) => p.id !== e.peerId));
        setSelectedPeer((sp) => (sp?.id === e.peerId ? null : sp));
      }
    });

    // Receive incoming files
    const signalling = discovery.signalChannel;
    const offSig = signalling.on((msg) => {
      if (msg.type !== "offer" && msg.type !== "answer" && msg.type !== "ice") return;
      if (msg.to !== getDeviceId()) return;

      if (msg.type === "offer") {
        const session = new WebRTCTransferSession(msg.from);
        sessionRef.current = session;

        session.createAnswer(msg.sdp, signalling).then((answer) => {
          signalling.send({ type: "answer", from: getDeviceId(), to: msg.from, sdp: answer });

          session.receiveFile(
            (received, total) => {
              setPhase("receiving");
              setStats({
                transferId: transferIdRef.current,
                fileName: "",
                fileSize: total,
                bytesTransferred: received,
                chunksCompleted: 0,
                totalChunks: 0,
                throughputBps: 0,
                elapsedMs: 0,
                etaMs: 0,
                peerId: msg.from,
                peerName: peers.find((p) => p.id === msg.from)?.name ?? "Peer",
                state: "receiving",
              });
            },
            (blob, fileName) => {
              downloadBlob(blob, fileName);
              setPhase("done");
              logMsg("success", `Received and saved: ${fileName}`);
            },
          );
        });
      }

      if (msg.type === "answer" && sessionRef.current) {
        sessionRef.current.acceptAnswer(msg.sdp);
      }

      if (msg.type === "ice" && sessionRef.current) {
        sessionRef.current.addIceCandidate(msg.candidate);
      }
    });

    return () => {
      off();
      offSig();
    };
  }, [useRealWebRTC, logMsg, peers]);

  // ── Simulation fallback ───────────────────────────────────────────────────
  useEffect(() => {
    if (useRealWebRTC) return;

    const off: () => void = simulator.on((event: SimEventPayload) => {
      switch (event.type) {
        case "peer-discovered":
          setPeers((prev) => {
            const idx = prev.findIndex((p) => p.id === event.peer.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = event.peer;
              return next;
            }
            return [...prev, event.peer];
          });
          break;
        case "peer-lost":
          setPeers((prev) => prev.filter((p) => p.id !== event.peerId));
          break;
        case "transfer-progress":
          setStats(event.stats);
          setPhase(event.stats.state as TransferPhase);
          break;
        case "transfer-complete":
          setStats(event.stats);
          setPhase("done");
          break;
        case "transfer-error":
          setStats(event.stats);
          setPhase("error");
          setError(event.stats.errorMessage ?? "Transfer failed");
          break;
        case "log":
          addLog(event.entry);
          break;
        case "state-change":
          setPhase(event.state as TransferPhase);
          if (event.state === "scanning") setIsScanning(true);
          if (["idle", "done", "error"].includes(event.state)) setIsScanning(false);
          break;
      }
    });
    return off;
  }, [useRealWebRTC, addLog]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const scan = useCallback(() => {
    setIsScanning(true);
    setPhase("scanning");
    setError(null);
    setPeers([]);

    if (useRealWebRTC) {
      logMsg("info", `Starting real WebRTC P2P discovery… (Device: ${getDeviceName()})`);
      logMsg("info", "Open OmniTransfer in another tab or device on the same network to see it appear");
      discovery.startDiscovery();
    } else {
      logMsg("info", "WebRTC not available — using simulation mode");
      simulator.startScan();
    }
  }, [useRealWebRTC, logMsg]);

  const stopScan = useCallback(() => {
    if (useRealWebRTC) {
      discovery.stopDiscovery();
    } else {
      simulator.stopScan();
    }
    setIsScanning(false);
    setPhase("idle");
  }, [useRealWebRTC]);

  const selectPeer = useCallback((peer: Peer) => {
    setSelectedPeer(peer);
    logMsg("info", `Selected peer: ${peer.name}`);
  }, [logMsg]);

  const selectFile = useCallback((file: File) => {
    setSelectedFile(file);
    logMsg("info", `File selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
  }, [logMsg]);

  const send = useCallback(async () => {
    if (!selectedPeer || !selectedFile) return;
    const tid = `xfr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    transferIdRef.current = tid;
    setError(null);
    setPhase("connecting");

    if (useRealWebRTC) {
      logMsg("info", `Initiating WebRTC connection to ${selectedPeer.name}…`);
      try {
        const signalling = discovery.signalChannel;
        const session = new WebRTCTransferSession(selectedPeer.id);
        sessionRef.current = session;

        session.on((e: RTCEventPayload) => {
          switch (e.type) {
            case "progress":
              setStats(e.stats);
              setPhase("sending");
              break;
            case "complete":
              setStats(e.stats);
              setPhase("done");
              break;
            case "error":
              setError(e.message);
              setPhase("error");
              break;
            case "log":
              addLog(e.entry);
              break;
            case "state":
              setPhase(e.state as TransferPhase);
              break;
          }
        });

        logMsg("debug", "Creating WebRTC offer (DTLS/SCTP)…");
        const offer = await session.createOffer(signalling);
        signalling.send({
          type: "offer",
          from: getDeviceId(),
          to: selectedPeer.id,
          sdp: offer,
        });
        logMsg("debug", "Offer sent — waiting for answer…");

        // Wait for answer via signalling
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Connection timeout (15s)")), 15000);
          const off = signalling.on((msg) => {
            if (msg.type === "answer" && msg.from === selectedPeer.id) {
              clearTimeout(timeout);
              off();
              resolve();
            }
          });
        });

        setPhase("sending");
        logMsg("info", "WebRTC connection established — starting transfer");
        await session.sendFile(selectedFile, tid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        logMsg("error", `Transfer failed: ${msg}`);
      }
    } else {
      // Simulation mode
      try {
        await simulator.sendFile(selectedPeer, selectedFile, tid);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Transfer cancelled") {
          setError(msg);
          setPhase("error");
        }
      }
    }
  }, [selectedPeer, selectedFile, useRealWebRTC, logMsg, addLog]);

  const pause = useCallback(() => {
    simulator.pauseTransfer();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    simulator.resumeTransfer();
    setPhase("sending");
  }, []);

  const cancel = useCallback(() => {
    sessionRef.current?.abort();
    simulator.cancelTransfer();
    setPhase("idle");
    setStats(null);
  }, []);

  const reset = useCallback(() => {
    sessionRef.current?.close();
    simulator.cancelTransfer();
    discovery.stopDiscovery();
    setPhase("idle");
    setStats(null);
    setError(null);
    setSelectedPeer(null);
    setSelectedFile(null);
    setPeers([]);
    setIsScanning(false);
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

  return {
    phase, peers, selectedPeer, selectedFile, stats, log,
    isScanning, error,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    isWebRTC: useRealWebRTC,
    scan, stopScan, selectPeer, selectFile,
    send, pause, resume, cancel, reset, clearLog,
  };
}
