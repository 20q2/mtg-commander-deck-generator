import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';

export function GameLog() {
  const log = usePlaytestStore(s => s.log);
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [log.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-6 border-l border-border/50 bg-card/30 hover:bg-card/60 flex items-center justify-center"
        title="Open log"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <aside className="w-56 border-l border-border/50 bg-card/30 flex flex-col">
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between text-xs">
        <span className="font-semibold">Log</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}><ChevronRight className="w-3.5 h-3.5" /></Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[11px] leading-snug">
        {log.length === 0
          ? <div className="text-muted-foreground italic">Nothing yet.</div>
          : log.map(e => <div key={e.id} className="text-muted-foreground/90">· {e.text}</div>)}
      </div>
    </aside>
  );
}
