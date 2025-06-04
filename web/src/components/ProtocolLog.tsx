import { ProtocolLogEntry } from "@/lib/protocol";
import { useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Trash2 } from "lucide-react";

interface ProtocolLogProps {
  log: ProtocolLogEntry[];
  onClear: () => void;
}

export default function ProtocolLog({ log, onClear }: ProtocolLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  const getColor = (level: ProtocolLogEntry['level']) => {
    switch(level) {
      case 'info': return 'text-slate-400';
      case 'success': return 'text-green-400';
      case 'warn': return 'text-amber-400';
      case 'error': return 'text-red-400';
      case 'debug': return 'text-slate-600';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0c10] border-t border-border font-mono text-[11px] md:text-xs">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <span className="text-muted-foreground uppercase tracking-widest text-[10px] font-bold">Protocol Log</span>
        <Button variant="ghost" size="sm" className="h-6 text-muted-foreground hover:text-foreground text-[10px] px-2" onClick={onClear}>
          <Trash2 className="w-3 h-3 mr-1" /> Clear
        </Button>
      </div>
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-1"
      >
        {log.length === 0 ? (
          <div className="text-muted-foreground/50 italic">No activity yet.</div>
        ) : (
          log.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
              <span className="text-slate-500 shrink-0">{formatTime(entry.ts)}</span>
              <span className={`${getColor(entry.level)} uppercase shrink-0 w-12`}>[{entry.level}]</span>
              <span className="text-slate-300 break-all">{entry.message}</span>
              {entry.data && (
                <span className="text-slate-500 truncate ml-2 text-[10px]">{JSON.stringify(entry.data)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
