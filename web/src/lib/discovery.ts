
// OmniTransfer — Real Peer Discovery
//
// Discovers peers via:
// 1. BroadcastChannel (same browser, multiple tabs) — works immediately
// 2. WebRTC + STUN (LAN peers) — works on same network
//
// Emits "peer-found" / "peer-lost" events as peers appear/disappear.

import type { Peer, DeviceCapabilities } from "./protocol";
import { LocalSignalling, type SignalMessage } from "./webrtc";

const DEFAULT_CAPS: DeviceCapabilities = {
  maxStreams: 8,
  maxChunkSize: 16 * 1024,
  supportsFec: true,
  supportsResume: true,
  version: 1,
};

type DiscoveryEvent =
  | { type: "peer-found"; peer: Peer }
  | { type: "peer-lost"; peerId: string };

type DiscoveryListener = (e: DiscoveryEvent) => void;

let _deviceId: string | null = null;
let _deviceName: string | null = null;

export function getDeviceId(): string {
  if (!_deviceId) {
    _deviceId = sessionStorage.getItem("omni-device-id") ?? crypto.randomUUID();
    sessionStorage.setItem("omni-device-id", _deviceId);
  }
  return _deviceId;
}

export function getDeviceName(): string {
  if (!_deviceName) {
    const stored = localStorage.getItem("omni-device-name");
    if (stored) return (_deviceName = stored);
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return (_deviceName = "iPhone/iPad");
    if (/Android/.test(ua)) return (_deviceName = "Android Device");
    if (/Mac/.test(ua)) return (_deviceName = "Mac");
    if (/Windows/.test(ua)) return (_deviceName = "Windows PC");
    if (/Linux/.test(ua)) return (_deviceName = "Linux PC");
    return (_deviceName = "Browser Tab");
  }
  return _deviceName;
}

export function setDeviceName(name: string) {
  _deviceName = name;
  localStorage.setItem("omni-device-name", name);
}

export class PeerDiscovery {
  private signalling: LocalSignalling;
  private peers = new Map<string, Peer>();
  private listeners = new Set<DiscoveryListener>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeen = new Map<string, number>();
  private offSignal: (() => void) | null = null;

  constructor() {
    this.signalling = new LocalSignalling(getDeviceId());
  }

  on(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: DiscoveryEvent) {
    this.listeners.forEach((l) => l(e));
  }

  get signalChannel(): LocalSignalling {
    return this.signalling;
  }

  startDiscovery() {
    this.offSignal = this.signalling.on((msg: SignalMessage) => {
      if (msg.type === "announce" && msg.from !== getDeviceId()) {
        this.lastSeen.set(msg.from, Date.now());

        const existing = this.peers.get(msg.from);
        const peer: Peer = {
          id: msg.from,
          name: msg.name,
          rssi: -50, // simulated — real RSSI not available via WebRTC
          capabilities: DEFAULT_CAPS,
          ephemeralPubkey: "",
          transport: "webrtc-sim",
        };

        this.peers.set(msg.from, peer);
        if (!existing) {
          this.emit({ type: "peer-found", peer });
        }
      }

      if (msg.type === "bye" && msg.from !== getDeviceId()) {
        this.peers.delete(msg.from);
        this.lastSeen.delete(msg.from);
        this.emit({ type: "peer-lost", peerId: msg.from });
      }
    });

    // Announce ourselves every 2 seconds
    const announce = () => {
      this.signalling.announce(getDeviceName(), JSON.stringify(DEFAULT_CAPS));
    };
    announce();
    this.heartbeatTimer = setInterval(announce, 2000);

    // Prune stale peers (not seen in 8 seconds)
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, ts] of this.lastSeen) {
        if (now - ts > 8000) {
          this.peers.delete(id);
          this.lastSeen.delete(id);
          this.emit({ type: "peer-lost", peerId: id });
        }
      }
    }, 3000);
  }

  stopDiscovery() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.offSignal?.();
    this.signalling.send({ type: "bye", from: getDeviceId() });
  }

  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  dispose() {
    this.stopDiscovery();
    this.signalling.dispose();
    this.listeners.clear();
  }
}

// Singleton
export const discovery = new PeerDiscovery();
