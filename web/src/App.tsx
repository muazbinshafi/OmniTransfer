import { useEffect } from "react";
import { useTransfer } from "@/hooks/useTransfer";
import { isTauri } from "@/lib/bridge";
import DeviceList from "@/components/DeviceList";
import FilePicker from "@/components/FilePicker";
import TransferProgress from "@/components/TransferProgress";
import ProtocolLog from "@/components/ProtocolLog";
import { Button } from "@/components/ui/button";
import { Send, Zap, Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatBytes, formatSpeed, formatEta } from "@/lib/protocol";

export default function App() {
  const session = useTransfer();

  const getPhaseIndicator = () => {
    switch(session.phase) {
      case 'idle': return { label: 'Idle', color: 'bg-slate-500', icon: <Activity className="w-4 h-4 mr-1.5" /> };
      case 'scanning': return { label: 'Scanning', color: 'bg-amber-500', icon: <Activity className="w-4 h-4 mr-1.5 animate-pulse" /> };
      case 'connecting':
      case 'handshaking': return { label: 'Connecting', color: 'bg-violet-500', icon: <Zap className="w-4 h-4 mr-1.5 animate-pulse" /> };
      case 'sending': return { label: 'Sending', color: 'bg-blue-500', icon: <Activity className="w-4 h-4 mr-1.5 animate-pulse" /> };
      case 'paused': return { label: 'Paused', color: 'bg-amber-500', icon: <Activity className="w-4 h-4 mr-1.5" /> };
      case 'done': return { label: 'Done', color: 'bg-green-500', icon: <CheckCircle2 className="w-4 h-4 mr-1.5" /> };
      case 'error': return { label: 'Error', color: 'bg-red-500', icon: <AlertCircle className="w-4 h-4 mr-1.5" /> };
      default: return { label: session.phase, color: 'bg-slate-500', icon: null };
    }
  };

  const phaseConfig = getPhaseIndicator();

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden text-foreground">
      
      {/* Left Sidebar */}
      <div className="w-[320px] shrink-0 border-r bg-card flex flex-col z-10 shadow-xl shadow-black/50">
        <div className="p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
              <Zap className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">OmniTransfer</h1>
          </div>
          {!isTauri() && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
              SIM
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <DeviceList 
            peers={session.peers}
            selectedPeer={session.selectedPeer}
            onSelect={session.selectPeer}
            isScanning={session.isScanning}
            onScan={session.scan}
            onStopScan={session.stopScan}
          />
          
          <div className="h-px bg-border w-full" />

          <FilePicker 
            selectedFile={session.selectedFile}
            onSelect={session.selectFile}
            onClear={() => session.selectFile(null as any)}
          />
        </div>

        <div className="p-6 border-t bg-card/50">
          <Button 
            className="w-full shadow-lg shadow-primary/20" 
            size="lg"
            disabled={!session.selectedPeer || !session.selectedFile || (session.phase !== 'idle' && session.phase !== 'done' && session.phase !== 'error')}
            onClick={session.send}
          >
            <Send className="w-4 h-4 mr-2" />
            Send File
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top Bar with Phase Indicator */}
        <div className="h-16 border-b flex items-center px-6 justify-end bg-background/80 backdrop-blur-sm z-10">
          <div className="flex items-center px-3 py-1.5 rounded-full border bg-card/50 shadow-sm">
            {phaseConfig.icon}
            <span className="text-sm font-medium mr-2">{phaseConfig.label}</span>
            <span className={`w-2 h-2 rounded-full ${phaseConfig.color}`} />
          </div>
        </div>

        {/* Dynamic Center Area */}
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8 relative">
          
          {session.phase === 'error' && (
            <div className="absolute top-8 left-1/2 -translate-x-1/2 max-w-lg w-full bg-destructive/10 border border-destructive/30 text-destructive-foreground p-4 rounded-lg flex items-start gap-3 shadow-lg shadow-destructive/5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-destructive" />
              <div>
                <h4 className="font-semibold text-destructive">Transfer Failed</h4>
                <p className="text-sm opacity-90 mt-1">{session.error}</p>
                <Button variant="outline" size="sm" className="mt-3 bg-background/50 border-destructive/30 hover:bg-destructive/20 text-destructive" onClick={session.reset}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {session.phase === 'idle' && (
             <div className="flex flex-col items-center justify-center text-muted-foreground max-w-md text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-6 shadow-inner">
                <Activity className="w-8 h-8 opacity-50" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Ready to Transfer</h2>
              <p className="text-sm">Select a nearby device and a file from the sidebar to begin.</p>
             </div>
          )}

          {(session.phase === 'connecting' || session.phase === 'handshaking' || session.phase === 'sending' || session.phase === 'paused') && (
            <div className="w-full max-w-3xl bg-card border rounded-xl p-8 shadow-2xl shadow-black/20">
              <TransferProgress 
                stats={session.stats} 
                phase={session.phase}
                onPause={session.pause}
                onResume={session.resume}
                onCancel={session.cancel}
              />
            </div>
          )}

          {session.phase === 'done' && session.stats && (
            <div className="w-full max-w-md bg-card border border-green-500/30 rounded-xl p-8 text-center shadow-2xl shadow-green-500/5">
              <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mx-auto mb-6 shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Transfer Complete</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Successfully sent <span className="font-medium text-foreground">{session.stats.fileName}</span> to <span className="font-medium text-foreground">{session.stats.peerName}</span>
              </p>
              
              <div className="bg-background border rounded-lg p-4 grid grid-cols-2 gap-4 text-left mb-6">
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Size</span>
                  <p className="font-mono text-sm">{formatBytes(session.stats.fileSize)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase">Avg Speed</span>
                  <p className="font-mono text-sm">{formatSpeed(session.stats.throughputBps)}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground uppercase">Time</span>
                  <p className="font-mono text-sm">{formatEta(session.stats.elapsedMs)}</p>
                </div>
              </div>

              <Button onClick={session.reset} className="w-full" variant="outline">
                Start New Transfer
              </Button>
            </div>
          )}
        </div>

        {/* Protocol Log Bottom Pane */}
        <div className="h-[250px] shrink-0 w-full relative z-20">
          <ProtocolLog log={session.log} onClear={session.clearLog} />
        </div>
      </div>
    </div>
  );
}
