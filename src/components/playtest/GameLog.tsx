import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ListFilter, Trash2, Sparkles, Crown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { LOG_CATEGORIES, type LogCategory } from '@/components/playtest/types';
import { LogCardText, useCardIndex, type CardIndex } from '@/components/playtest/LogCardText';
import type { DetectedCombo, ScryfallCard } from '@/types';

type Tab = 'log' | 'combos';

/**
 * The seat chip standing for everything that isn't a bot — your own moves, turn
 * markers, system notices. Those entries carry no `seats`, so they need a key of
 * their own to be switched off by.
 */
const YOU = 'you';

/**
 * The log/combos half of the side panel. It no longer owns the strip: SidePanel
 * does, because the strip now holds the stack underneath as well and folding
 * away one half of it made no sense.
 */
export function GameLog({ onCollapse }: { onCollapse?: () => void }) {
  const log = usePlaytestStore(s => s.log);
  const clearLog = usePlaytestStore(s => s.clearLog);
  const combos = usePlaytestStore(s => s.combos);
  const enabled = usePlaytestSettings(s => s.logFilter);
  const setLogFilter = usePlaytestSettings(s => s.setLogFilter);
  const toggleLogCategory = usePlaytestSettings(s => s.toggleLogCategory);
  const cardIndex = useCardIndex();
  const opponents = useOpponentStore(s => s.opponents);
  const [tab, setTab] = useState<Tab>('log');
  const [showFilters, setShowFilters] = useState(false);
  // Seats are per-game ids, so which ones you've muted is not worth persisting
  // alongside the category filter — it would name seats that no longer exist.
  const [hiddenSeats, setHiddenSeats] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // A seat that has left the table takes its mute with it: otherwise its
  // parting line stays hidden behind a chip that is no longer there to unhide.
  const hidden = useMemo(() => {
    const live = new Set(opponents.map(o => o.id));
    return new Set([...hiddenSeats].filter(id => id === YOU || live.has(id)));
  }, [hiddenSeats, opponents]);

  const filtered = useMemo(() => log.filter(e => {
    if (!enabled[e.category]) return false;
    // A line can name two seats — one bot attacking another — and stays as long
    // as either of them is showing.
    return e.seats?.length ? e.seats.some(id => !hidden.has(id)) : !hidden.has(YOU);
  }), [log, enabled, hidden]);
  const allEnabled = useMemo(
    () => (Object.values(enabled) as boolean[]).every(Boolean) && hidden.size === 0,
    [enabled, hidden],
  );

  useEffect(() => {
    if (tab !== 'log') return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [tab, filtered.length]);

  const toggle = (key: LogCategory) => toggleLogCategory(key);
  const toggleSeat = (key: string) => setHiddenSeats(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const setAll = (v: boolean) => {
    setLogFilter({ move: v, tap: v, library: v, counter: v, life: v, turn: v, bot: v, system: v });
    setHiddenSeats(v ? new Set() : new Set([YOU, ...opponents.map(o => o.id)]));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
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
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 ml-auto self-center mr-0.5"
            title="Collapse panel"
            onClick={onCollapse}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        )}
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
          {opponents.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/30">
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70">Seats</div>
              <div className="flex flex-wrap gap-1">
                <SeatChip
                  label="You"
                  on={!hidden.has(YOU)}
                  chip="bg-sky-500/15 text-sky-300 border-sky-400/40"
                  onClick={() => toggleSeat(YOU)}
                />
                {opponents.map(o => (
                  <SeatChip
                    key={o.id}
                    label={o.name}
                    on={!hidden.has(o.id)}
                    chip="bg-violet-500/15 text-violet-300 border-violet-400/40"
                    onClick={() => toggleSeat(o.id)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 text-[10px]">
            <button onClick={() => setAll(true)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">All</button>
            <span className="text-muted-foreground/50">·</span>
            <button onClick={() => setAll(false)} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">None</button>
          </div>
        </div>
      )}

      {/* Tab body */}
      {/* The log is the one part of the playtest surface that reads as text you
          might want to take away with you, so it opts out of the board's
          `select-none`. */}
      {tab === 'log' && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-[11px] leading-snug select-text">
          {log.length === 0 ? (
            <div className="text-muted-foreground italic">Nothing yet.</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground italic">No entries match the filters.</div>
          ) : (
            filtered.map(e => (
              <LogLine key={e.id} text={e.text} category={e.category} undone={e.undone} cardIndex={cardIndex} />
            ))
          )}
        </div>
      )}

      {tab === 'combos' && <CombosPanel combos={combos} />}
    </div>
  );
}

/**
 * One seat's toggle. Same shape as the category chips above it, so the two rows
 * read as one filter rather than as two unrelated controls.
 */
function SeatChip({ label, on, chip, onClick }: {
  label: string;
  on: boolean;
  chip: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-all max-w-[11rem] truncate ${
        on ? chip : 'bg-transparent text-muted-foreground border-border/40 opacity-60 hover:opacity-100'
      }`}
      title={`${on ? 'Hide' : 'Show'} ${label}`}
    >
      {label}
    </button>
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

function LogLine({ text, category, undone, cardIndex }: {
  text: string;
  category: LogCategory;
  undone?: boolean;
  cardIndex: CardIndex;
}) {
  const cat = LOG_CATEGORIES.find(c => c.key === category);
  return (
    <div className={`flex gap-1.5 ${undone ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground/90'}`}>
      <span
        className={`shrink-0 w-1 self-stretch rounded-full ${cat?.chip.split(' ').find(c => c.startsWith('bg-')) ?? 'bg-zinc-500/40'} ${undone ? 'opacity-40' : ''}`}
        aria-hidden
      />
      <span className="flex-1">
        <LogCardText
          text={text}
          index={cardIndex}
          scope={category === 'bot' ? 'opponent' : 'own'}
          dim={undone}
        />
      </span>
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

  // "Live" cards = anything currently in hand or on the battlefield — combos
  // are sorted by how many of their cards are live so the most actionable
  // combos float to the top.
  const liveNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of zones.hand) s.add(c.name);
    for (const b of battlefield) s.add(b.card.name);
    return s;
  }, [zones.hand, battlefield]);

  const complete = useMemo(() => {
    const withCount = combos
      .filter(c => c.isComplete)
      .map(c => ({ combo: c, presentCount: c.cards.filter(n => liveNames.has(n)).length }));
    withCount.sort((a, b) => b.presentCount - a.presentCount);
    return withCount;
  }, [combos, liveNames]);

  const filtered = useMemo(() => {
    const needle = filter.toLowerCase().trim();
    if (!needle) return complete;
    return complete.filter(({ combo: c }) =>
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
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="px-1 py-3 text-[10px] text-muted-foreground italic">No matches.</div>
        ) : (
          filtered.map(({ combo: c, presentCount }) => (
            <ComboRow
              key={c.comboId}
              combo={c}
              cardByName={cardByName}
              hasCommander={c.cards.some(n => commanderNames.includes(n))}
              dimmed={presentCount === 0}
              liveNames={liveNames}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ComboRow({
  combo, cardByName, hasCommander, dimmed, liveNames,
}: {
  combo: DetectedCombo;
  cardByName: Map<string, ScryfallCard>;
  hasCommander: boolean;
  dimmed: boolean;
  liveNames: Set<string>;
}) {
  const result = combo.results?.[0] ?? '';
  return (
    <div
      className={`group rounded-md overflow-hidden border transition-all ${dimmed ? 'opacity-50 hover:opacity-100' : ''} ${
        hasCommander
          ? 'border-amber-400/40 bg-amber-500/[0.06] hover:bg-amber-500/20 hover:border-amber-400/70 shadow-[0_1px_0_rgba(0,0,0,0.4)]'
          : 'border-border/60 bg-card/60 hover:bg-accent hover:border-border shadow-[0_1px_0_rgba(0,0,0,0.3)]'
      }`}
    >
      {/* Full-width art banner — equal sections, one per card */}
      <div className="flex h-9 bg-black/50 border-b border-black/40">
        {combo.cards.map((name, i) => {
          const card = cardByName.get(name);
          const artUrl =
            card?.image_uris?.art_crop ??
            card?.card_faces?.[0]?.image_uris?.art_crop ??
            null;
          const live = liveNames.has(name);
          return (
            <div
              key={`${name}-${i}`}
              className={`flex-1 min-w-0 relative transition-opacity ${i > 0 ? 'border-l border-black/70' : ''} ${live ? '' : 'opacity-40 saturate-50 group-hover:opacity-100 group-hover:saturate-100'}`}
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
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[8px] text-muted-foreground/60 px-0.5 truncate">
                  {name}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Body: names + result on a backdrop that contrasts the art band */}
      <div className="px-2 py-1.5">
        <div className="text-[10px] leading-snug text-foreground/90 mb-0.5">
          {hasCommander && (
            <Crown className="w-2.5 h-2.5 inline -mt-px mr-1 text-amber-300/90 align-baseline" />
          )}
          {combo.cards.map((name, i) => {
            const live = liveNames.has(name);
            return (
              <span key={`name-${i}`}>
                {i > 0 && <span className="text-muted-foreground/50 mx-0.5">+</span>}
                <span className={live ? 'text-foreground font-medium' : 'text-muted-foreground/50 group-hover:text-foreground/90'}>{name}</span>
              </span>
            );
          })}
        </div>
        {result && (
          <div className="text-[10px] italic text-muted-foreground/80 leading-snug">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
