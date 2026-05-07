import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, ListFilter, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { LOG_CATEGORIES, type LogCategory } from '@/components/playtest/types';

export function GameLog() {
  const log = usePlaytestStore(s => s.log);
  const clearLog = usePlaytestStore(s => s.clearLog);
  const [open, setOpen] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [enabled, setEnabled] = useState<Record<LogCategory, boolean>>({
    move: true, tap: true, library: true, counter: true, life: true, turn: true, system: true,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => log.filter(e => enabled[e.category]),
    [log, enabled],
  );

  const allEnabled = useMemo(
    () => (Object.values(enabled) as boolean[]).every(Boolean),
    [enabled],
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered.length]);

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

  const toggle = (key: LogCategory) => setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  const setAll = (v: boolean) =>
    setEnabled({ move: v, tap: v, library: v, counter: v, life: v, turn: v, system: v });

  return (
    <aside className="w-56 border-l border-border/50 bg-card/30 flex flex-col">
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between text-xs">
        <span className="font-semibold">
          Log{!allEnabled ? ` · ${filtered.length}/${log.length}` : ''}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={showFilters ? 'Hide filters' : 'Filter by category'}
            onClick={() => setShowFilters(s => !s)}
          >
            <ListFilter className={`w-3.5 h-3.5 ${showFilters || !allEnabled ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Clear log"
            disabled={log.length === 0}
            onClick={() => log.length > 0 && clearLog()}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Collapse log"
            onClick={() => setOpen(false)}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="px-3 py-2 border-b border-border/40 space-y-2">
          <div className="flex flex-wrap gap-1">
            {LOG_CATEGORIES.map(cat => {
              const on = enabled[cat.key];
              return (
                <button
                  key={cat.key}
                  onClick={() => toggle(cat.key)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-all ${
                    on ? cat.chip : 'bg-transparent text-muted-foreground border-border/40 opacity-60 hover:opacity-100'
                  }`}
                  title={`${on ? 'Hide' : 'Show'} ${cat.label}`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 text-[10px]">
            <button
              onClick={() => setAll(true)}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground/50">·</span>
            <button
              onClick={() => setAll(false)}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              None
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[11px] leading-snug">
        {log.length === 0 ? (
          <div className="text-muted-foreground italic">Nothing yet.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground italic">No entries match the filters.</div>
        ) : (
          filtered.map(e => <LogLine key={e.id} text={e.text} category={e.category} />)
        )}
      </div>
    </aside>
  );
}

function LogLine({ text, category }: { text: string; category: LogCategory }) {
  const cat = LOG_CATEGORIES.find(c => c.key === category);
  return (
    <div className="text-muted-foreground/90 flex gap-1.5">
      <span
        className={`shrink-0 w-1 self-stretch rounded-full ${cat?.chip.split(' ').find(c => c.startsWith('bg-')) ?? 'bg-zinc-500/40'}`}
        aria-hidden
      />
      <span className="flex-1">{text}</span>
    </div>
  );
}
