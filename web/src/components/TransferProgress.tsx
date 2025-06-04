import { TransferStats, formatBytes, formatSpeed, formatEta } from "@/lib/protocol";
import { TransferPhase } from "@/hooks/useTransfer";
import { Pause, Play, XCircle } from "lucide-react";
import { Button } from "./ui/button";

interface TransferProgressProps {
  stats: TransferStats | null;
  phase: TransferPhase;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export default function TransferProgress({ stats, phase, onPause, onResume, onCancel }: TransferProgressProps) {
  if (!stats) return null;

  const progress = stats.fileSize > 0 ? (stats.bytesTransferred / stats.fileSize) * 100 : 0;
  
  return (
    <div className="flex flex-col w-full max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold truncate text-foreground">{stats.fileName}</h2>
        <p className="text-sm text-muted-foreground">Transferring to <span className="font-medium text-foreground">{stats.peerName}</span></p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm font-medium">
          <span>{formatBytes(stats.bytesTransferred)}</span>
          <span>{formatBytes(stats.fileSize)}</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300 ease-out" 
            style={{ width: `${Math.max(progress, 0.5)}%` }} 
          />
        </div>
      </div>

      {/* Stream lanes simulation */}
      {(phase === 'sending' || phase === 'paused') && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase mb-2">Active Streams</p>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-4">{i}</span>
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden relative">
                {phase === 'sending' && (
                  <div 
                    className="absolute top-0 bottom-0 bg-blue-400/50"
                    style={{
                      left: `${(i * 25 + (Date.now() / 10) % 100)}%`,
                      width: '20%',
                      opacity: Math.random() > 0.3 ? 1 : 0
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border p-3 rounded-lg flex flex-col">
          <span className="text-xs text-muted-foreground uppercase mb-1">Speed</span>
          <span className="text-sm font-mono">{formatSpeed(stats.throughputBps)}</span>
        </div>
        <div className="bg-card border p-3 rounded-lg flex flex-col">
          <span className="text-xs text-muted-foreground uppercase mb-1">ETA</span>
          <span className="text-sm font-mono">{formatEta(stats.etaMs)}</span>
        </div>
        <div className="bg-card border p-3 rounded-lg flex flex-col">
          <span className="text-xs text-muted-foreground uppercase mb-1">Chunks</span>
          <span className="text-sm font-mono">{stats.chunksCompleted} / {stats.totalChunks}</span>
        </div>
        <div className="bg-card border p-3 rounded-lg flex flex-col">
          <span className="text-xs text-muted-foreground uppercase mb-1">Elapsed</span>
          <span className="text-sm font-mono">{formatEta(stats.elapsedMs)}</span>
        </div>
      </div>

      <div className="flex justify-center gap-4 pt-4">
        {phase === 'sending' && (
          <Button variant="secondary" onClick={onPause}>
            <Pause className="w-4 h-4 mr-2" /> Pause
          </Button>
        )}
        {phase === 'paused' && (
          <Button variant="default" onClick={onResume}>
            <Play className="w-4 h-4 mr-2" /> Resume
          </Button>
        )}
        <Button variant="destructive" onClick={onCancel}>
          <XCircle className="w-4 h-4 mr-2" /> Cancel
        </Button>
      </div>
    </div>
  );
}
