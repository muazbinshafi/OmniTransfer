
// OmniTransfer Protocol Types
// This file defines all protocol-level types shared across the web simulation,
// Tauri desktop bridge, and native adapters.

export type TransferState =
  | "idle"
  | "advertising"
  | "scanning"
  | "connecting"
  | "handshaking"
  | "sending"
  | "receiving"
  | "paused"
  | "done"
  | "error";

export interface Peer {
  id: string;
  name: string;
  /** RSSI in dBm — negative, higher is closer */
  rssi: number;
  capabilities: DeviceCapabilities;
  /** Ephemeral X25519 public key (32 bytes, base64) */
  ephemeralPubkey: string;
  /** Transport type discovered via */
  transport: "ble" | "wifi-direct" | "lan" | "webrtc-sim";
  connectedAt?: number;
}

export interface DeviceCapabilities {
  maxStreams: number;
  maxChunkSize: number;
  supportsFec: boolean;
  supportsResume: boolean;
  version: number;
}

export interface TransferRequest {
  fileName: string;
  fileSize: number;
  /** Default 16 MB */
  chunkSize: number;
  totalChunks: number;
  /** BLAKE3 root hash (hex) */
  blake3Root: string;
  mimeType: string;
}

export interface TransferStats {
  transferId: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  chunksCompleted: number;
  totalChunks: number;
  /** Running average in bytes/sec */
  throughputBps: number;
  /** Milliseconds */
  elapsedMs: number;
  etaMs: number;
  peerId: string;
  peerName: string;
  state: TransferState;
  errorMessage?: string;
}

export interface ChunkAck {
  chunkIds: number[];
}

export interface CreditUpdate {
  streamId: number;
  credits: number;
}

export interface TransferComplete {
  blake3Final: string;
  verified: boolean;
}

/** Protocol log entry for the console view */
export interface ProtocolLogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "success" | "debug";
  message: string;
  data?: Record<string, unknown>;
}

/** Default chunk size: 16 MB */
export const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024;

/** FEC redundancy factor — 5% */
export const FEC_REDUNDANCY = 0.05;

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps, 1)}/s`;
}

export function formatEta(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "--";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function computeChunks(fileSize: number, chunkSize = DEFAULT_CHUNK_SIZE) {
  const total = Math.ceil(fileSize / chunkSize);
  return Array.from({ length: total }, (_, i) => ({
    chunkId: i,
    offset: i * chunkSize,
    length: i < total - 1 ? chunkSize : fileSize - i * chunkSize,
  }));
}
