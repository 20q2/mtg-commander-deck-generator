import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, ListFilter, Trash2, Sparkles, Crown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { LOG_CATEGORIES, type LogCategory } from '@/components/playtest/types';
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
  const commanderNames = usePlaytestStore(s => s.source?.commanderNames ?? []);
  const zones = usePlaytestStore(s => s.zones);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const [filter, setFilter] = useState('');

  const cardByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    for (const z of [zones.command, zones.library, zones.hand, zones.graveyard, zones.exile]) {
      for (const c of z) m.set(c.name, c);
    }
    for (const b of battlefield) m.set(b.card.name, b.card);
    return m;
  }, [zones, battlefield]);

  const complete = useMemo(() => combos.filter(c => c.isComplete), [combos]);

  const filtered = useMemo(() => {
    const needle = filter.toLowerCase().trim();
    if (!needle) return complete;
    return complete.filter(c =>
      c.cards.some(name => name.toLowerCase().includes(needle)) ||
      (c.results[0]?.toLowerCase().includes(needle) ?? false),
    );
  }, [complete, filter]);

  if (complete.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-3 text-[11px] text-muted-foreground italic">
        <Sparkles className="w-3.5 h-3.5 inline mr-1 opacity-60" />
        No combos in this deck.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-2 py-1.5 border-b border-border/40 relative">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter combos…"
          className="w-full bg-transparent border border-border/50 rounded px-1.5 py-0.5 pr-5 text-[11px] outline-none focus:border-primary"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear filter"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-[10px] text-muted-foreground italic">No matches.</div>
        ) : (
          filtered.map(c => (
            <ComboRow
              key={c.comboId}
              combo={c}
              cardByName={cardByName}
              hasCommander={c.cards.some(n => commanderNames.includes(n))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ComboRow({
  combo, cardByName, hasCommander,
}: {
  combo: DetectedCombo;
  cardByName: Map<string, ScryfallCard>;
  hasCommander: boolean;
}) {
  const result = combo.results?.[0] ?? '';
  return (
    <div
      className={`px-2 py-1.5 hover:bg-accent/30 transition-colors border-l-2 ${
        hasCommander ? 'border-amber-400/70' : 'border-transparent'
      }`}
      title={combo.cards.join(' + ')}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {hasCommander && <Crown className="w-2.5 h-2.5 text-amber-300/90 shrink-0" />}
        <div className="flex gap-0.5 min-w-0">
          {combo.cards.map((name, i) => {
            const card = cardByName.get(name);
            const artUrl =
              card?.image_uris?.art_crop ??
              card?.card_faces?.[0]?.image_uris?.art_crop ??
              null;
            return (
              <div
                key={`${name}-${i}`}
                className="w-7 h-[18px] rounded-sm overflow-hidden bg-black/50 ring-1 ring-black/40 shrink-0"
                title={name}
              >
                {artUrl ? (
                  <img
                    src={artUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    draggable={false}
                    loading="lazy"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="text-[10px] italic text-muted-foreground/85 truncate">
        {result}
      </div>
    </div>
  );
}
