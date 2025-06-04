/**
 * OmniTransfer Web Simulation
 *
 * Demonstrates the complete OmniTransfer protocol flow using:
 * - Simulated BLE peer discovery (synthetic peers with RSSI variation)
 * - WebRTC RTCPeerConnection with a loopback data channel (same-page)
 * - Simulated chunking, per-chunk SHA-256 hashing, and BLAKE3-style root
 * - Credit-based flow control and Reed-Solomon FEC logging
 * - Full protocol console output
 */

import { OmniSimulator } from './sim-engine.js';

const sim = new OmniSimulator();

// ── DOM refs ────────────────────────────────────────────────────────────────
const deviceList   = document.getElementById('device-list');
const btnScan      = document.getElementById('btn-scan');
const btnStopScan  = document.getElementById('btn-stop-scan');
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const btnSend      = document.getElementById('btn-send');
const btnReset     = document.getElementById('btn-reset');
const phaseChip    = document.getElementById('phase-chip');
const progressBar  = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressBytes= document.getElementById('progress-bytes');
const streamLanes  = document.getElementById('stream-lanes');
const statSpeed    = document.getElementById('stat-speed');
const statEta      = document.getElementById('stat-eta');
const statChunks   = document.getElementById('stat-chunks');
const statElapsed  = document.getElementById('stat-elapsed');
const btnPause     = document.getElementById('btn-pause');
const btnResume    = document.getElementById('btn-resume');
const btnCancel    = document.getElementById('btn-cancel');
const logArea      = document.getElementById('log-area');
const btnClearLog  = document.getElementById('btn-clear-log');
const transferIdle  = document.getElementById('transfer-idle');
const transferActive= document.getElementById('transfer-active');
const transferDone  = document.getElementById('transfer-done');
const doneDetails   = document.getElementById('done-details');

let selectedPeer = null;
let selectedFile = null;
const STREAM_COUNT = 4;

// Initialise stream lane UI
for (let i = 0; i < STREAM_COUNT; i++) {
  const lane = document.createElement('div');
  lane.className = 'stream-lane';
  lane.setAttribute('aria-label', `Stream ${i}`);
  const fill = document.createElement('div');
  fill.className = 'stream-fill';
  fill.style.width = '0%';
  fill.id = `stream-fill-${i}`;
  lane.appendChild(fill);
  streamLanes.appendChild(lane);
}

// ── Simulation events ────────────────────────────────────────────────────────
sim.on((event) => {
  switch (event.type) {
    case 'peer-discovered':
      renderPeers(sim.getPeers());
      break;
    case 'state-change':
      setPhase(event.state);
      break;
    case 'log':
      appendLog(event.entry);
      break;
    case 'transfer-progress':
      updateProgress(event.stats);
      break;
    case 'transfer-complete':
      showDone(event.stats);
      break;
    case 'transfer-error':
      setPhase('error');
      break;
    case 'credit-update':
      flashStreamLane(event.streamId);
      break;
  }
});

// ── Peer rendering ───────────────────────────────────────────────────────────
const DEVICE_ICONS = {
  'MacBook': '💻', 'iPhone': '📱', 'Samsung': '📱', 'Windows': '🖥️',
  'iPad': '📱', 'Linux': '🖥️', 'Pixel': '📱', 'Surface': '💻',
};

function deviceIcon(name) {
  for (const [k, v] of Object.entries(DEVICE_ICONS)) {
    if (name.includes(k)) return v;
  }
  return '📡';
}

function rssiToQuality(rssi) {
  if (rssi >= -50) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

function renderPeers(peers) {
  if (peers.length === 0) {
    deviceList.innerHTML = `
      <div class="empty-state" style="padding:20px;font-size:12px;">
        <div class="empty-icon" style="font-size:24px;">📡</div>
        <div>No peers found</div>
      </div>`;
    return;
  }

  deviceList.innerHTML = '';
  peers.forEach(peer => {
    const item = document.createElement('div');
    item.className = 'device-item' + (selectedPeer?.id === peer.id ? ' selected' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Select ${peer.name}`);
    item.setAttribute('tabindex', '0');

    const quality = rssiToQuality(peer.rssi);
    const bars = [1,2,3,4].map(h =>
      `<span style="height:${h*4}px" class="${h <= quality ? 'active' : ''}"></span>`
    ).join('');

    item.innerHTML = `
      <div class="device-avatar">${deviceIcon(peer.name)}</div>
      <div style="flex:1;min-width:0;">
        <div class="device-name">${peer.name}</div>
        <div class="device-meta">${peer.rssi} dBm · BLE + Wi-Fi</div>
      </div>
      <div class="rssi-bar" aria-label="Signal strength ${quality} of 4">${bars}</div>
    `;

    item.addEventListener('click', () => selectPeer(peer));
    item.addEventListener('keydown', e => { if (e.key === 'Enter') selectPeer(peer); });
    deviceList.appendChild(item);
  });
}

function selectPeer(peer) {
  selectedPeer = peer;
  renderPeers(sim.getPeers());
  updateSendBtn();
  appendLog({ ts: Date.now(), level: 'info', message: `Selected peer: ${peer.name}` });
}

// ── File drop/pick ───────────────────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter') fileInput.click(); });
dropZone.setAttribute('role', 'button');
dropZone.setAttribute('tabindex', '0');

fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) setFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
});

function setFile(file) {
  selectedFile = file;
  dropZone.classList.add('has-file');
  dropZone.innerHTML = `
    <div class="drop-icon">📄</div>
    <div class="drop-file-name">${escHtml(file.name)}</div>
    <div class="drop-file-size">${formatBytes(file.size)}</div>
  `;
  updateSendBtn();
  appendLog({ ts: Date.now(), level: 'info', message: `File selected: ${file.name} (${formatBytes(file.size)})` });
}

// ── Transfer controls ────────────────────────────────────────────────────────
btnScan.addEventListener('click', () => {
  btnScan.disabled = true;
  btnStopScan.disabled = false;
  sim.startScan();
});

btnStopScan.addEventListener('click', () => {
  sim.stopScan();
  btnScan.disabled = false;
  btnStopScan.disabled = true;
});

btnSend.addEventListener('click', async () => {
  if (!selectedPeer || !selectedFile) return;
  btnSend.disabled = true;
  showTransferUI('active');

  try {
    const tid = `xfr-${Date.now()}`;
    await sim.sendFile(selectedPeer, selectedFile, tid);
  } catch (err) {
    if (err.message !== 'Transfer cancelled') {
      appendLog({ ts: Date.now(), level: 'error', message: `Error: ${err.message}` });
      setPhase('error');
    }
  }
});

btnPause.addEventListener('click', () => {
  sim.pauseTransfer();
  btnPause.style.display = 'none';
  btnResume.style.display = '';
});

btnResume.addEventListener('click', () => {
  sim.resumeTransfer();
  btnResume.style.display = 'none';
  btnPause.style.display = '';
});

btnCancel.addEventListener('click', () => {
  sim.cancelTransfer();
  showTransferUI('idle');
  btnSend.disabled = false;
  btnPause.style.display = '';
  btnResume.style.display = 'none';
});

btnReset.addEventListener('click', () => {
  sim.stopScan();
  selectedPeer = null;
  selectedFile = null;
  deviceList.innerHTML = `<div class="empty-state" style="padding:20px;font-size:12px;"><div class="empty-icon" style="font-size:24px;">📡</div><div>Press Scan to discover peers</div></div>`;
  dropZone.classList.remove('has-file');
  dropZone.innerHTML = `<div class="drop-icon">📄</div><div class="drop-text">Drop a file or click to browse</div><input type="file" id="file-input" style="display:none;" />`;
  document.getElementById('file-input').addEventListener('change', () => {
    if (document.getElementById('file-input').files?.[0]) setFile(document.getElementById('file-input').files[0]);
  });
  showTransferUI('idle');
  setPhase('idle');
  btnSend.disabled = true;
  btnReset.hidden = true;
  for (let i = 0; i < STREAM_COUNT; i++) {
    document.getElementById(`stream-fill-${i}`).style.width = '0%';
  }
});

btnClearLog.addEventListener('click', () => { logArea.innerHTML = ''; });

function updateSendBtn() {
  btnSend.disabled = !(selectedPeer && selectedFile);
}

// ── UI state ─────────────────────────────────────────────────────────────────
const PHASE_LABELS = {
  idle: 'Idle', scanning: 'Scanning', connecting: 'Connecting',
  handshaking: 'Handshake', sending: 'Sending', receiving: 'Receiving',
  paused: 'Paused', done: 'Done', error: 'Error',
};

function setPhase(phase) {
  const label = PHASE_LABELS[phase] || phase;
  phaseChip.className = `phase-chip phase-${phase}`;
  phaseChip.innerHTML = `<span class="phase-dot"></span> ${label}`;
}

function showTransferUI(mode) {
  transferIdle.style.display  = mode === 'idle'   ? '' : 'none';
  transferActive.style.display = mode === 'active' ? '' : 'none';
  transferDone.style.display  = mode === 'done'   ? '' : 'none';
  btnReset.hidden = mode === 'idle';
}

function updateProgress(stats) {
  const pct = stats.fileSize > 0
    ? Math.min(100, (stats.bytesTransferred / stats.fileSize) * 100)
    : 0;

  progressBar.style.width = `${pct.toFixed(1)}%`;
  progressText.textContent = `${pct.toFixed(1)}%`;
  progressBytes.textContent = `${formatBytes(stats.bytesTransferred)} / ${formatBytes(stats.fileSize)}`;

  const bps = stats.throughputBps;
  statSpeed.textContent = formatSpeed(bps);
  statSpeed.style.color = bps > 50e6 ? 'var(--success)' : bps > 10e6 ? 'var(--warn)' : 'var(--text)';
  statEta.textContent = formatEta(stats.etaMs);
  statChunks.textContent = `${stats.chunksCompleted} / ${stats.totalChunks}`;
  statElapsed.textContent = formatEta(stats.elapsedMs);

  // Animate stream fill lanes (stagger by chunk_id % STREAM_COUNT)
  for (let i = 0; i < STREAM_COUNT; i++) {
    const fill = document.getElementById(`stream-fill-${i}`);
    // Stagger fills slightly so they don't all move together
    const offset = (i * 7) % 15;
    const lanePct = Math.min(100, pct + offset * (Math.random() * 0.1));
    fill.style.width = `${Math.min(pct, 100)}%`;
  }
}

function showDone(stats) {
  showTransferUI('done');
  setPhase('done');
  const elapsed = stats.elapsedMs / 1000;
  const avg = formatSpeed(stats.fileSize / elapsed);
  doneDetails.textContent = `${formatBytes(stats.fileSize)} transferred in ${elapsed.toFixed(1)}s · avg ${avg} · BLAKE3 verified`;
  btnSend.disabled = false;
  for (let i = 0; i < STREAM_COUNT; i++) {
    document.getElementById(`stream-fill-${i}`).style.width = '100%';
  }
}

function flashStreamLane(streamId) {
  const fill = document.getElementById(`stream-fill-${streamId % STREAM_COUNT}`);
  if (fill) {
    fill.style.background = 'var(--success)';
    setTimeout(() => { fill.style.background = ''; }, 300);
  }
}

// ── Protocol log ─────────────────────────────────────────────────────────────
const MAX_LOG = 500;
let logCount = 0;

function appendLog(entry) {
  if (logCount >= MAX_LOG) {
    logArea.removeChild(logArea.firstChild);
  }

  const d = new Date(entry.ts);
  const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`;

  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg log-${entry.level}">${escHtml(entry.message)}</span>`;
  logArea.appendChild(row);
  logArea.scrollTop = logArea.scrollHeight;
  logCount++;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ── Utilities ────────────────────────────────────────────────────────────────
function formatBytes(bytes, d = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : d)} ${sizes[i]}`;
}

function formatSpeed(bps) { return `${formatBytes(bps, 1)}/s`; }

function formatEta(ms) {
  if (!ms || !isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
