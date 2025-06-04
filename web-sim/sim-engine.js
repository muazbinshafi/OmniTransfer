/**
 * OmniTransfer Web Simulation Engine
 *
 * Provides the same API as the TypeScript OmniSimulator from
 * artifacts/omnitransfer/src/lib/simulation.ts, but as a plain
 * ES module for the standalone web-sim/index.html demo.
 */

const DEVICE_NAMES = [
  'MacBook Pro (Alex)', 'iPhone 15 (Jordan)', 'Samsung Galaxy S24',
  'Windows PC (Desktop)', 'iPad Pro (Studio)', 'Linux Workstation',
  'Pixel 8 (Taylor)', 'Surface Pro 9',
];

const CAPABILITIES = {
  maxStreams: 8, maxChunkSize: 16 * 1024 * 1024,
  supportsFec: true, supportsResume: true, version: 1,
};

function fakeKey() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

function makePeer(i) {
  return {
    id: `peer-${i}-${Math.random().toString(36).slice(2,6)}`,
    name: DEVICE_NAMES[i % DEVICE_NAMES.length],
    rssi: -40 - Math.floor(Math.random() * 50),
    capabilities: CAPABILITIES,
    ephemeralPubkey: fakeKey(),
    transport: 'ble',
  };
}

export class OmniSimulator {
  #listeners = new Set();
  #peers = new Map();
  #scanTimer = null;
  #activeTransfer = null;

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) { this.#listeners.forEach(l => l(event)); }

  #log(level, message, data) {
    this.#emit({ type: 'log', entry: { ts: Date.now(), level, message, data } });
  }

  getPeers() { return Array.from(this.#peers.values()); }

  startScan() {
    this.#stopScanInterval();
    this.#log('info', 'Starting BLE scan + mDNS discovery…');
    this.#emit({ type: 'state-change', state: 'scanning' });

    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const peer = makePeer(i);
        this.#peers.set(peer.id, peer);
        this.#log('success', `Discovered: ${peer.name}`, { rssi: `${peer.rssi} dBm` });
        this.#emit({ type: 'peer-discovered', peer });
      }, 300 + i * 700);
    }

    this.#scanTimer = setInterval(() => {
      this.#peers.forEach((peer, id) => {
        const updated = { ...peer, rssi: Math.max(-90, Math.min(-30, peer.rssi + (Math.random()*4-2))) };
        this.#peers.set(id, updated);
        this.#emit({ type: 'peer-discovered', peer: updated });
      });
    }, 2000);
  }

  stopScan() { this.#stopScanInterval(); }
  #stopScanInterval() {
    if (this.#scanTimer) { clearInterval(this.#scanTimer); this.#scanTimer = null; }
  }

  async sendFile(peer, file, transferId) {
    if (this.#activeTransfer) throw new Error('A transfer is already in progress');

    let aborted = false;
    let paused = false;
    let pauseResolve = null;

    const self = this;
    const handle = {
      abort: () => { aborted = true; },
      pause: () => { paused = true; },
      resume: () => {
        paused = false;
        pauseResolve?.();
        pauseResolve = null;
      },
    };
    this.#activeTransfer = handle;

    const startTs = Date.now();
    const CHUNK_SIZE = 16 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const blake3Root = await this.#hashFile(file);

    // Phase: Connecting
    this.#emit({ type: 'state-change', state: 'connecting' });
    this.#log('info', `Connecting to ${peer.name}…`);
    await delay(400);

    // Phase: Handshaking
    this.#emit({ type: 'state-change', state: 'handshaking' });
    this.#log('info', 'Initiating Noise KK handshake…');
    this.#log('debug', '→ message_1: e + DH(e, rs) + DH(s, rs)');
    await delay(250);
    this.#log('debug', '← message_2: e + DH(ee) + DH(se)');
    await delay(200);
    this.#log('debug', '→ message_3: {} [handshake complete]');
    await delay(150);
    this.#log('success', 'Noise KK complete — AES-256-GCM session established');
    this.#emit({ type: 'handshake-complete', peerId: peer.id });

    // Phase: Sending
    this.#emit({ type: 'state-change', state: 'sending' });
    this.#log('info', `Sending ${file.name} (${fmt(file.size)}) · ${totalChunks} chunks`);
    this.#log('debug', `BLAKE3 root: ${blake3Root.slice(0,16)}…`);
    this.#log('info', `Streams: ${Math.min(peer.capabilities.maxStreams, 4)} · FEC: ${Math.ceil(totalChunks*0.05)} repair chunks`);

    // Grant initial credits
    for (let s = 0; s < 4; s++) {
      this.#emit({ type: 'credit-update', streamId: s, credits: 32 });
    }

    const targetBps = (80 + Math.random() * 120) * 1024 * 1024;
    const TICK = 50;
    const bytesPerTick = (targetBps * TICK) / 1000;
    let bytesXfr = 0;
    let chunksCompleted = 0;
    const speedWindow = [];
    let lastTs = Date.now();
    let lastBytes = 0;

    const emitStats = (state) => {
      const elapsed = Date.now() - startTs;
      const now = Date.now();
      const instantBps = ((bytesXfr - lastBytes) / (now - lastTs)) * 1000;
      speedWindow.push(instantBps);
      if (speedWindow.length > 8) speedWindow.shift();
      const avgBps = speedWindow.reduce((a,b)=>a+b,0) / speedWindow.length;
      lastTs = now; lastBytes = bytesXfr;
      const remaining = file.size - bytesXfr;
      this.#emit({ type: 'transfer-progress', stats: {
        transferId, fileName: file.name, fileSize: file.size,
        bytesTransferred: bytesXfr, chunksCompleted, totalChunks,
        throughputBps: avgBps, elapsedMs: elapsed,
        etaMs: avgBps > 0 ? (remaining / avgBps) * 1000 : Infinity,
        peerId: peer.id, peerName: peer.name, state,
      }});
    };

    await new Promise((resolve, reject) => {
      handle.abort = () => { aborted = true; reject(new Error('Transfer cancelled')); };

      const tick = async () => {
        if (aborted) return;
        if (paused) await new Promise(r => { pauseResolve = r; });

        const variance = 0.8 + Math.random() * 0.4;
        const add = Math.min(bytesPerTick * variance, file.size - bytesXfr);
        bytesXfr = Math.min(bytesXfr + add, file.size);

        const newChunk = Math.floor((bytesXfr / file.size) * totalChunks);
        if (newChunk > chunksCompleted) {
          for (let ci = chunksCompleted; ci < newChunk; ci++) {
            const streamId = ci % 4;
            if (ci % 20 === 0) {
              this.#log('debug', `chunk_ack stream=${streamId} chunk=${ci} sha256=ok`);
            }
          }
          chunksCompleted = newChunk;
        }

        // FEC region
        if (chunksCompleted >= Math.floor(totalChunks * 0.95) && chunksCompleted < totalChunks && chunksCompleted % 5 === 0) {
          this.#log('debug', `RS FEC: transmitting repair shard ${chunksCompleted - Math.floor(totalChunks*0.95)}`);
        }

        emitStats('sending');

        if (bytesXfr >= file.size) {
          resolve();
        } else {
          setTimeout(tick, TICK);
        }
      };
      setTimeout(tick, TICK);
    });

    // Verify
    this.#emit({ type: 'state-change', state: 'done' });
    this.#log('info', 'All chunks received — verifying BLAKE3 root hash…');
    await delay(300);
    this.#log('success', `BLAKE3 verified ✓ ${blake3Root.slice(0,32)}…`);
    const elapsed = (Date.now() - startTs) / 1000;
    this.#log('success', `Transfer complete — ${fmt(file.size)} in ${elapsed.toFixed(1)}s (avg ${fmtSpeed(file.size/elapsed)})`);

    const finalStats = {
      transferId, fileName: file.name, fileSize: file.size,
      bytesTransferred: file.size, chunksCompleted: totalChunks, totalChunks,
      throughputBps: file.size / elapsed, elapsedMs: Date.now() - startTs,
      etaMs: 0, peerId: peer.id, peerName: peer.name, state: 'done',
    };
    this.#emit({ type: 'transfer-complete', stats: finalStats });
    this.#activeTransfer = null;
  }

  pauseTransfer() {
    this.#activeTransfer?.pause?.();
    this.#log('info', 'Transfer paused');
    this.#emit({ type: 'state-change', state: 'paused' });
  }

  resumeTransfer() {
    this.#activeTransfer?.resume?.();
    this.#log('info', 'Transfer resumed');
    this.#emit({ type: 'state-change', state: 'sending' });
  }

  cancelTransfer() {
    this.#activeTransfer?.abort?.();
    this.#activeTransfer = null;
    this.#log('warn', 'Transfer cancelled');
    this.#emit({ type: 'state-change', state: 'idle' });
  }

  async #hashFile(file) {
    const sample = file.slice(0, Math.min(file.size, 64 * 1024));
    const buf = await sample.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(b) {
  if (!b) return '0 B';
  const sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b/1024**i).toFixed(i?1:0)} ${sizes[i]}`;
}
function fmtSpeed(bps) { return `${fmt(bps)}/s`; }
