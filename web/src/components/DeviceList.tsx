import { Peer } from "@/lib/protocol";
import { Laptop, Smartphone, Tablet, Monitor, Signal, SignalLow, SignalMedium, SignalHigh, RefreshCw, StopCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface DeviceListProps {
  peers: Peer[];
  selectedPeer: Peer | null;
  onSelect: (peer: Peer) => void;
  isScanning: boolean;
  onScan: () => void;
  onStopScan: () => void;
}

function getDeviceIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("iphone") || lower.includes("pixel") || lower.includes("galaxy")) return <Smartphone className="w-5 h-5" />;
  if (lower.includes("ipad") || lower.includes("tablet")) return <Tablet className="w-5 h-5" />;
  if (lower.includes("macbook") || lower.includes("laptop")) return <Laptop className="w-5 h-5" />;
  return <Monitor className="w-5 h-5" />;
}

function getSignalIcon(rssi: number) {
  if (rssi > -50) return <SignalHigh className="w-4 h-4 text-green-500" />;
  if (rssi > -70) return <SignalMedium className="w-4 h-4 text-amber-500" />;
  if (rssi > -85) return <SignalLow className="w-4 h-4 text-orange-500" />;
  return <Signal className="w-4 h-4 text-red-500" />;
}

export default function DeviceList({ peers, selectedPeer, onSelect, isScanning, onScan, onStopScan }: DeviceListProps) {
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Nearby Devices</h3>
        {isScanning ? (
          <Button variant="ghost" size="icon" onClick={onStopScan} title="Stop scanning" className="h-8 w-8 text-amber-500 hover:text-amber-400">
            <StopCircle className="w-4 h-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={onScan} title="Scan for devices" className="h-8 w-8 text-primary hover:text-primary-foreground">
            <RefreshCw className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {peers.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md bg-muted/20">
            {isScanning ? "Scanning for devices..." : "No devices found."}
          </div>
        ) : (
          peers.map(peer => {
            const isSelected = selectedPeer?.id === peer.id;
            return (
              <Card 
                key={peer.id} 
                className={`p-3 cursor-pointer transition-all ${isSelected ? 'border-primary bg-primary/10' : 'hover:border-muted-foreground/50 border-border bg-card'}`}
                onClick={() => onSelect(peer)}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-md ${isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {getDeviceIcon(peer.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{peer.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {getSignalIcon(peer.rssi)}
                      <span className="text-xs text-muted-foreground">{peer.rssi} dBm</span>
                    </div>
                  </div>
                  {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
