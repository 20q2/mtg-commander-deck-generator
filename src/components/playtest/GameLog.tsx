import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, ListFilter, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { LOG_CATEGORIES, type LogCategory } from '@/components/playtest/types';
import { HoverPreviewImage } from '@/components/playtest/HoverPreviewImage';
import type { DetectedCombo, ScryfallCard } from '@/types';

type Tab = 'log' | 'combos';

export function GameLog() {
  const log = usePlaytestStore(s => s.log);
  const clearLog = usePlaytestStore(s => s.clearLog);
  const combos = usePlaytestStore(s => s.combos);
  const enabled = usePlaytestSettings(s => s.logFilter);
  const setLogFilter = usePlaytestSettings(s => s.setLogFilter);
  const toggleLogCategory = usePlaytestSettings(s => s.toggleLogCategory);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('log');
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => log.filter(e => enabled[e.category]), [log, enabled]);
  const allEnabled = useMemo(() => (Object.values(enabled) as boolean[]).every(Boolean), [enabled]);

  useEffect(() => {
    if (tab !== 'log') return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [tab, filtered.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-6 border-l border-border/50 bg-card/30 hover:bg-card/60 flex items-center justify-center"
        title="Open side panel"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
    );
  }

  const toggle = (key: LogCategory) => toggleLogCategory(key);
  const setAll = (v: boolean) =>
    setLogFilter({ move: v, tap: v, library: v, counter: v, life: v, turn: v, system: v });

  return (
    <aside className="w-56 border-l border-border/50 bg-card/30 flex flex-col">
      {/* Tab strip */}
      <div className="flex items-stretch border-b border-border/50 text-[11px]">
        <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
          Log{!allEnabled && tab === 'log' ? ` · ${filtered.length}/${log.length}` : ''}
        </TabButton>
        <TabButton active={tab === 'combos'} onClick={() => setTab('combos')}>
          {(() => {
            const completeCount = combos.filter(c => c.isComplete).length;
            return `Combos${completeCount > 0 ? ` · ${completeCount}` : ''}`;
          })()}
        </TabButton>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 ml-auto self-center mr-0.5"
          title="Collapse panel"
          onClick={() => setOpen(false)}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Per-tab toolbar */}
      {tab === 'log' && (
        <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-0.5 text-[10px] text-muted-foreground">
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
        </div>
      )}

      {tab === 'log' && showFilters && (
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
            <button onClick={() => setAll(true)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">All</button>
            <span className="text-muted-foreground/50">·</span>
            <button onClick={() => setAll(false)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">None</button>
          </div>
        </div>
      )}

      {/* Tab body */}
      {tab === 'log' && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[11px] leading-snug">
          {log.length === 0 ? (
            <div className="text-muted-foreground italic">Nothing yet.</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground italic">No entries match the filters.</div>
          ) : (
            filtered.map(e => <LogLine key={e.id} text={e.text} category={e.category} undone={e.undone} />)
          )}
        </div>
      )}

      {tab === 'combos' && <CombosPanel combos={combos} />}
    </aside>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-left font-semibold transition-colors ${
        active
          ? 'text-foreground border-b-2 border-primary -mb-px bg-card/40'
          : 'text-muted-foreground hover:text-foreground hover:bg-card/20'
      }`}
    >
      {children}
    </button>
  );
}

function LogLine({ text, category, undone }: { text: string; category: LogCategory; undone?: boolean }) {
  const cat = LOG_CATEGORIES.find(c => c.key === category);
  return (
    <div className={`flex gap-1.5 ${undone ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground/90'}`}>
      <span
        className={`shrink-0 w-1 self-stretch rounded-full ${cat?.chip.split(' ').find(c => c.startsWith('bg-')) ?? 'bg-zinc-500/40'} ${undone ? 'opacity-40' : ''}`}
        aria-hidden
      />
      <span className="flex-1">{text}</span>
    </div>
  );
}

function CombosPanel({ combos }: { combos: DetectedCombo[] }) {
  // Look up images for combo cards from cards already known to the playtest store.
  const zones = usePlaytestStore(s => s.zones);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const cardByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    for (const z of [zones.command, zones.library, zones.hand, zones.graveyard, zones.exile]) {
      for (const c of z) m.set(c.name, c);
    }
    for (const b of battlefield) m.set(b.card.name, b.card);
    return m;
  }, [zones, battlefield]);

  // Only complete combos — near-misses live elsewhere.
  const complete = combos.filter(c => c.isComplete);

  if (complete.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-3 text-[11px] text-muted-foreground italic">
        <Sparkles className="w-3.5 h-3.5 inline mr-1 opacity-60" />
        No combos in this deck.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-[11px] leading-snug">
      {complete.map(c => <ComboCard key={c.comboId} combo={c} cardByName={cardByName} />)}
    </div>
  );
}

function ComboCard({ combo, cardByName }: { combo: DetectedCombo; cardByName: Map<string, ScryfallCard> }) {
  const result = combo.results?.[0];
  return (
    <div className="rounded border border-emerald-400/25 bg-emerald-500/5 p-1.5">
      <div className="flex flex-wrap gap-1 mb-1.5">
        {combo.cards.map((name, i) => {
          const card = cardByName.get(name);
          if (card) {
            return (
              <div key={`${name}-${i}`} className="w-[42px] shrink-0" title={name}>
                <HoverPreviewImage
                  card={card}
                  size="small"
                  className="w-full rounded-[3px] shadow"
                />
              </div>
            );
          }
          return (
            <span
              key={`${name}-${i}`}
              className="inline-block text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-accent/30 text-foreground/90"
              title={name}
            >
              {name}
            </span>
          );
        })}
      </div>
      {result && (
        <div className="text-[10px] text-muted-foreground/90 line-clamp-2">
          → {result}
        </div>
      )}
    </div>
  );
}
