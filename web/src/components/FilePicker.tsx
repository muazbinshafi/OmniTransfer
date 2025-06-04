import { formatBytes } from "@/lib/protocol";
import { FileUp, File as FileIcon, X } from "lucide-react";
import { useRef, DragEvent, useState } from "react";
import { Button } from "./ui/button";

interface FilePickerProps {
  selectedFile: File | null;
  onSelect: (file: File) => void;
  onClear: () => void;
}

export default function FilePicker({ selectedFile, onSelect, onClear }: FilePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onSelect(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">File Selection</h3>
      
      {selectedFile ? (
        <div className="border border-primary bg-primary/5 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 bg-primary/20 rounded-md text-primary shrink-0">
              <FileIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate text-foreground">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(selectedFile.size)}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClear} className="text-muted-foreground hover:text-destructive shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div 
          className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
            ${isDragging ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 hover:border-muted-foreground/60 bg-muted/20'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3 text-muted-foreground">
            <FileUp className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-foreground">Click or drag file to select</p>
          <p className="text-xs text-muted-foreground mt-1">Any file size supported</p>
          <input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onSelect(e.target.files[0]);
              }
            }} 
          />
        </div>
      )}
    </div>
  );
}
