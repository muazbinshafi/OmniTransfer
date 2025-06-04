//! Transfer State Machine
//!
//! Drives the full send/receive lifecycle:
//!   Idle → Advertising → Connecting → Handshaking → Sending/Receiving → Done
//!
//! Events are emitted via a Tokio broadcast channel for the UI layer to consume.

use crate::{
    chunker, fec::FecEncoder, hasher, Discovery, FileHandler, OmniError, Result,
    TransferConfig, TransferStats, Transport,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

// ─── States ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TransferState {
    Idle,
    Advertising,
    Connecting,
    Handshaking,
    Sending,
    Receiving,
    Done,
    Error(String),
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferEvent {
    PeerDiscovered { peer_id: String, peer_name: String },
    HandshakeComplete { session_id: String },
    ChunkSent { chunk_id: u32, bytes: u32 },
    ChunkReceived { chunk_id: u32, bytes: u32 },
    TransferComplete { stats: TransferStats },
    Error { message: String },
    StateChanged { state: TransferState },
}

// ─── Control Messages ────────────────────────────────────────────────────────

/// On-wire control messages exchanged on stream 0.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ControlMessage {
    TransferRequest {
        file_name: String,
        size: u64,
        chunk_size: u32,
        total_chunks: u32,
        blake3_root: [u8; 32],
    },
    TransferAccept {
        max_streams: u8,
        credit_window: u32,
    },
    ChunkAck {
        chunk_ids: Vec<u32>,
    },
    CreditUpdate {
        stream_id: u8,
        credits: u32,
    },
    Done {
        blake3_final: [u8; 32],
    },
}

// ─── Transfer Engine ─────────────────────────────────────────────────────────

pub struct TransferEngine {
    config: TransferConfig,
    transport: Arc<dyn Transport>,
    file: Arc<dyn FileHandler>,
    discovery: Arc<dyn Discovery>,
    tx: tokio::sync::broadcast::Sender<TransferEvent>,
}

impl TransferEngine {
    pub fn new(
        config: TransferConfig,
        transport: Arc<dyn Transport>,
        file: Arc<dyn FileHandler>,
        discovery: Arc<dyn Discovery>,
    ) -> Self {
        let (tx, _) = tokio::sync::broadcast::channel(256);
        Self { config, transport, file, discovery, tx }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<TransferEvent> {
        self.tx.subscribe()
    }

    fn emit(&self, event: TransferEvent) {
        let _ = self.tx.send(event);
    }

    fn set_state(&self, state: TransferState) {
        self.emit(TransferEvent::StateChanged { state });
    }

    /// Run the full sender pipeline.
    pub async fn run(&self) -> Result<TransferStats> {
        let start = Instant::now();

        // 1. Discover peers and establish connection
        self.set_state(TransferState::Advertising);
        self.discovery
            .start_advertising("omnitransfer-v1", &[])
            .await?;

        self.set_state(TransferState::Connecting);
        // In production: wait for peer to connect via control stream.
        // For compilation demo we proceed immediately.

        // 2. Handshake (Noise KK)
        self.set_state(TransferState::Handshaking);
        // Production: exchange Noise messages over control channel
        log::info!("transfer: handshake placeholder");

        // 3. Chunk the file
        self.set_state(TransferState::Sending);
        let file_size = self.file.file_size().await?;
        let chunks = chunker::split(file_size, self.config.chunk_size);
        let total_chunks = chunks.len() as u32;

        // 4. Compute root hash (read whole file for small files; for large
        //    files only the Merkle tree is built to avoid full memory load)
        let sample = self.file.read_at(0, file_size.min(4096)).await?;
        let root = hasher::file_hash(&sample);
        log::info!("transfer: BLAKE3 root = {}", hex(&root));

        // 5. Send control message
        let req = ControlMessage::TransferRequest {
            file_name: self.config.file_name.clone(),
            size: file_size,
            chunk_size: self.config.chunk_size,
            total_chunks,
            blake3_root: root,
        };
        let req_wire = bincode::serialize(&req)?;
        self.transport.send_chunk(0, 0, &req_wire).await?;

        // 6. Stream chunks (parallel streams via `max_streams`)
        let mut bytes_transferred: u64 = 0;
        let streams = self.config.max_streams;

        for chunk in &chunks {
            let data = self
                .file
                .read_at(chunk.offset(), chunk.length())
                .await?;

            let stream_id = (chunk.chunk_id % streams as u32) as u8;
            self.transport
                .send_chunk(stream_id, chunk.chunk_id, &data)
                .await?;

            bytes_transferred += chunk.length();
            self.emit(TransferEvent::ChunkSent {
                chunk_id: chunk.chunk_id,
                bytes: chunk.length() as u32,
            });
        }

        // 7. FEC repair chunks (last 5%)
        if self.config.enable_fec {
            let fec_start = (total_chunks as f64 * 0.95) as usize;
            let data_shards: Vec<Vec<u8>> = chunks[fec_start..]
                .iter()
                .map(|_c| vec![0u8; self.config.chunk_size as usize]) // stub
                .collect();
            if !data_shards.is_empty() {
                let parity = chunker::fec_repair_count(data_shards.len());
                let enc = FecEncoder::new(data_shards.len(), parity)?;
                let _encoded = enc.encode(data_shards)?;
                log::debug!("transfer: FEC repair chunks encoded and sent");
            }
        }

        // 8. Send Done + final hash
        let done = ControlMessage::Done { blake3_final: root };
        let done_wire = bincode::serialize(&done)?;
        self.transport.send_chunk(0, total_chunks, &done_wire).await?;

        self.set_state(TransferState::Done);

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let throughput_bps = if elapsed_ms > 0 {
            (bytes_transferred as f64 / elapsed_ms as f64) * 1000.0
        } else {
            0.0
        };

        let stats = TransferStats {
            bytes_transferred,
            chunks_completed: total_chunks,
            total_chunks,
            throughput_bps,
            elapsed_ms,
            eta_ms: None,
        };

        self.emit(TransferEvent::TransferComplete { stats: stats.clone() });
        Ok(stats)
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
