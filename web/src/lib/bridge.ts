
// OmniTransfer Tauri Bridge
//
// In a native Tauri desktop build this module calls real IPC commands.
// In the browser it transparently falls back to the web simulation.

import type { Peer, TransferStats } from "./protocol";
import { simulator } from "./simulation";

declare global {
  interface Window {
    __TAURI__?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      event: {
        listen: <T>(event: string, cb: (payload: { payload: T }) => void) => Promise<() => void>;
      };
    };
  }
}

export const isTauri = (): boolean => typeof window.__TAURI__ !== "undefined";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Not running in Tauri");
  return window.__TAURI__!.invoke<T>(cmd, args);
}

// ─── BLE / Discovery ─────────────────────────────────────────────────────────

export async function scanBle(): Promise<Peer[]> {
  if (isTauri()) {
    return tauriInvoke<Peer[]>("scan_ble");
  }
  // Web simulation: trigger scan and return current peer list after a delay
  simulator.startScan();
  return [];
}

export async function startAdvertising(deviceName: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("start_advertising", { deviceName });
  }
  simulator.log("info", `Started BLE advertising as "${deviceName}"`);
}

// ─── Hotspot ─────────────────────────────────────────────────────────────────

export async function startHotspot(ssid: string, passphrase: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("start_hotspot", { ssid, passphrase });
  }
  simulator.log("info", `[sim] startHotspot ssid=${ssid}`);
}

export async function stopHotspot(): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("stop_hotspot");
  }
  simulator.log("info", "[sim] stopHotspot");
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export async function startTransfer(
  peer: Peer,
  file: File,
  transferId: string,
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("start_transfer", {
      peerId: peer.id,
      filePath: (file as File & { path?: string }).path ?? file.name,
    });
  }
  return simulator.sendFile(peer, file, transferId);
}

export function pauseTransfer(): void {
  if (isTauri()) {
    tauriInvoke("pause_transfer").catch(console.error);
    return;
  }
  simulator.pauseTransfer();
}

export function resumeTransfer(): void {
  if (isTauri()) {
    tauriInvoke("resume_transfer").catch(console.error);
    return;
  }
  simulator.resumeTransfer();
}

export function cancelTransfer(): void {
  if (isTauri()) {
    tauriInvoke("cancel_transfer").catch(console.error);
    return;
  }
  simulator.cancelTransfer();
}

// ─── Native event subscription (Tauri only) ──────────────────────────────────

export async function listenTransferProgress(
  cb: (stats: TransferStats) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const unlisten = await window.__TAURI__!.event.listen<TransferStats>(
    "transfer_progress",
    ({ payload }) => cb(payload),
  );
  return unlisten;
}
