import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Bot, ChevronLeft, Heart, Play, Plus, RotateCcw, Skull, Swords, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { OpponentCardMenu, type OpponentMenuTarget } from '@/components/playtest/opponents/OpponentCardMenu';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';

/**
 * The opponent column, beside the table rather than across the top. With nobody
 * seated it collapses to a narrow rail so it costs almost nothing, and the rail
 * is still the entry point — the discovery moment lives in the play area.
 */
const WIDTH_KEY = 'playtest-opponent-column-width';
const MIN_WIDTH = 150;
const MAX_WIDTH = 460;

export function OpponentStrip() {
  const opponents = useOpponentStore(s => s.opponents);
  const runAllTurns = useOpponentStore(s => s.runAllTurns);
  const openModal = usePlaytestStore(s => s.openModal);
  const autoTurns = usePlaytestSettings(s => s.opponentAutoTurns);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? Math.min(stored, MAX_WIDTH) : 208;
  });

  // Drag the right edge to resize. Pointer capture rather than window listeners
  // so a fast drag that outruns the handle doesn't drop the gesture.
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startWidth = width;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      setWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      // Read off the element rather than closing over stale state.
      const final = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      localStorage.setItem(WIDTH_KEY, String(final));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // Empty, or deliberately collapsed → a rail just wide enough to get back.
  if (opponents.length === 0 || collapsed) {
    return (
      <div className="hidden md:flex shrink-0 w-9 border-r border-border/50 bg-card/30 flex-col items-center gap-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => (opponents.length === 0 ? openModal({ kind: 'opponents' }) : setCollapsed(false))}
          title={opponents.length === 0 ? 'Play against bots' : 'Show opponents'}
        >
          <Bot className="w-4 h-4 text-violet-300/80" />
        </Button>
        {opponents.length === 0 ? (
          <span
            className="text-[10px] uppercase tracking-wider text-muted-foreground/60 select-none"
            style={{ writingMode: 'vertical-rl' }}
          >
            Play against bots
          </span>
        ) : (
          <>
            <span className="text-[10px] font-bold tabular-nums text-violet-200">{opponents.length}</span>
            <span
              className="text-[10px] uppercase tracking-wider text-muted-foreground/60 select-none"
              style={{ writingMode: 'vertical-rl' }}
            >
              {opponents.map(o => `${o.name} ${o.life}`).join(' · ')}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="hidden md:flex shrink-0 relative border-r border-border/50 bg-card/30 flex-col min-h-0"
      style={{ width }}
    >
      {/* Resize handle on the right edge. */}
      <div
        onPointerDown={onResizeStart}
        onDoubleClick={() => { setWidth(208); localStorage.setItem(WIDTH_KEY, '208'); }}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 z-20 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />
      <div className="px-2 py-1 flex items-center gap-1.5 border-b border-border/40">
        <Bot className="w-3.5 h-3.5 text-violet-300/80 shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-1">
          Opponents · {opponents.length}
        </span>
        {/* With auto-turns off, Next Turn no longer moves the table, so this is
            the only way for the bots to act. */}
        {!autoTurns && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={() => runAllTurns()}
            title="Run every bot's turn now (auto-turns are off in Settings → Bots)"
          >
            <Play className="w-3 h-3 mr-1" />Turn
          </Button>
        )}
        {opponents.length < MAX_OPPONENTS && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => openModal({ kind: 'opponents' })}
            title="Seat another opponent"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setCollapsed(true)}
          title="Collapse opponents"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-2">
        {opponents.map(o => <OpponentLane key={o.id} opponent={o} columnWidth={width} />)}
      </div>
    </div>
  );
}

function OpponentLane({ opponent, columnWidth }: { opponent: Opponent; columnWidth: number }) {
  const adjustLife = useOpponentStore(s => s.adjustLife);
  const remove = useOpponentStore(s => s.remove);
  const setResistance = useOpponentStore(s => s.setResistance);
  const untapAll = useOpponentStore(s => s.untapAll);
  const openModal = usePlaytestStore(s => s.openModal);
  const tiny = 'px-1 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium leading-4';

  // Drop target for donating one of your permanents to this bot.
  const { setNodeRef, isOver } = useDroppable({
    id: `opponent:${opponent.id}`,
    data: { kind: 'opponentLane', opponentId: opponent.id },
  });

  const rows = useMemo(() => splitRows(opponent.battlefield), [opponent.battlefield]);

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 rounded-lg border bg-background/30 p-1.5 transition-colors ${
        isOver ? 'border-violet-400/70 bg-violet-500/10' : 'border-border/40'
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold truncate flex-1">{opponent.name}</span>
        <button
          onClick={() => remove(opponent.id)}
          className="text-muted-foreground/70 hover:text-red-400 transition-colors shrink-0"
          title={`Remove ${opponent.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="mt-1 flex items-center gap-1">
        <button onClick={() => adjustLife(opponent.id, -1)} className={tiny} title="−1 life">−</button>
        <span
          className="inline-flex items-center gap-1 px-1.5 rounded bg-rose-500/15 border border-rose-400/40 text-rose-300 font-bold text-[11px] leading-5 tabular-nums"
          title={`${opponent.name}'s life`}
        >
          <Heart className="w-2.5 h-2.5 fill-rose-400/40" />
          {opponent.life}
        </span>
        <button onClick={() => adjustLife(opponent.id, 1)} className={tiny} title="+1 life">+</button>
        <button
          onClick={() => setResistance(opponent.id, !opponent.resistance)}
          title={
            opponent.resistance
              ? 'Resisting — casts removal and sweepers at your board. Click for a passive dummy.'
              : 'Passive — only develops and attacks. Click to let it fight back.'
          }
          className={`ml-auto inline-flex items-center gap-1 px-1.5 rounded border text-[10px] leading-4 transition-colors ${
            opponent.resistance
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
              : 'border-border/50 bg-transparent text-muted-foreground/70'
          }`}
        >
          <Swords className="w-2.5 h-2.5" />
          {opponent.resistance ? 'Resist' : 'Passive'}
        </button>
      </div>

      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
        <span title="Cards in hand — hidden, as they would be">hand {opponent.hand.length}</span>
        <span title="Cards left in library">lib {opponent.library.length}</span>
        <button
          onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'graveyard' })}
          className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
          title="View their graveyard"
        >
          gy {opponent.graveyard.length}
        </button>
        <button
          onClick={() => openModal({ kind: 'opponentZone', opponentId: opponent.id, zone: 'exile' })}
          className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
          title="View their exile"
        >
          ex {opponent.exile.length}
        </button>
        <button
          onClick={() => untapAll(opponent.id)}
          className="ml-auto hover:text-foreground transition-colors"
          title="Untap all of their permanents"
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
        {opponent.decked && <span className="text-amber-400/80">decked</span>}
      </div>

      <div className="mt-1 space-y-1 min-h-[52px]">
        {opponent.battlefield.length === 0 ? (
          <span className="text-[10px] text-muted-foreground/50 italic">
            empty board — drag a permanent up here to give it away
          </span>
        ) : (
          ROW_ORDER.map(row => {
            const cards = rows[row.key];
            if (cards.length === 0) return null;
            return (
              <div key={row.key} className="flex items-end gap-1 flex-wrap" title={row.label}>
                {cards.map(p => (
                  <OpponentPermanentCard
                    key={p.instanceId}
                    opponentId={opponent.id}
                    permanent={p}
                    width={rowWidth(columnWidth, row.scale)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

type RowKey = 'creatures' | 'others' | 'lands';

/**
 * Board rows, rendered top to bottom in this order: creatures in front, other
 * permanents in the middle, lands on the bottom — the way a player lays out
 * their own side of the table.
 *
 * Widths are a fraction of the column so cards grow when you widen it, and they
 * step down by row: a pile of basics shouldn't dominate the lane, and the row
 * you actually scan — what can attack me — should read largest.
 */
const ROW_ORDER: { key: RowKey; label: string; scale: number }[] = [
  { key: 'creatures', label: 'Creatures',        scale: 0.30 },
  { key: 'others',    label: 'Other permanents', scale: 0.24 },
  { key: 'lands',     label: 'Lands',            scale: 0.18 },
];

/** Column width → card width for a row, clamped so it stays legible and sane. */
function rowWidth(columnWidth: number, scale: number): number {
  return Math.round(Math.max(26, Math.min(120, columnWidth * scale)));
}

/**
 * Split a board into rows. Creature is checked before land so a creature-land
 * lands in the row you'd scan for attackers rather than hiding among the mana.
 */
function splitRows(battlefield: OpponentPermanent[]): Record<RowKey, OpponentPermanent[]> {
  const out: Record<RowKey, OpponentPermanent[]> = { creatures: [], others: [], lands: [] };
  for (const p of battlefield) {
    const type = getFrontFaceTypeLine(p.card).toLowerCase();
    if (type.includes('creature')) out.creatures.push(p);
    else if (type.includes('land')) out.lands.push(p);
    else out.others.push(p);
  }
  return out;
}

function OpponentPermanentCard({
  opponentId, permanent, width,
}: {
  opponentId: string;
  permanent: OpponentPermanent;
  width: number;
}) {
  const togglePermanentTap = useOpponentStore(s => s.togglePermanentTap);
  const permanentToZone = useOpponentStore(s => s.permanentToZone);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<OpponentMenuTarget | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const ctrlHeld = useMagnifyKey();
  const previewMode = usePlaytestSettings(s => s.opponentPreview);
  const showPreview =
    previewMode === 'off'   ? false
  : previewMode === 'hover' ? hovered
  :                           ctrlHeld && hovered;
  const counters = Object.entries(permanent.counters).filter(([, v]) => v > 0);

  // Theft: drag this down onto your battlefield to take it.
  const drag = useDraggable({
    id: `opp:${opponentId}:${permanent.instanceId}`,
    data: {
      opponentSource: { opponentId, instanceId: permanent.instanceId },
      card: permanent.card,
    },
  });
  const dragMoved = useRef(false);
  useEffect(() => {
    if (drag.isDragging) dragMoved.current = true;
    else {
      const id = setTimeout(() => { dragMoved.current = false; }, 50);
      return () => clearTimeout(id);
    }
  }, [drag.isDragging]);

  return (
    <div
      ref={boxRef}
      className={`relative shrink-0 ${drag.isDragging ? 'opacity-30' : ''}`}
      style={{ width }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ opponentId, permanent, x: e.clientX, y: e.clientY });
      }}
    >
      <img
        ref={drag.setNodeRef as unknown as React.Ref<HTMLImageElement>}
        {...drag.attributes}
        {...drag.listeners}
        src={getCardImageUrl(permanent.card, 'small')}
        alt={permanent.card.name}
        title={`${permanent.card.name}${permanent.tapped ? ' (tapped)' : ''} · click to tap · right-click for options · hold Ctrl to magnify · drag onto your battlefield to steal`}
        onClick={() => { if (!dragMoved.current) togglePermanentTap(opponentId, permanent.instanceId); }}
        draggable={false}
        className={`w-full rounded-[3px] shadow cursor-grab touch-none transition-transform ${
          permanent.tapped ? 'rotate-90' : ''
        } ${permanent.summoningSick ? 'ring-1 ring-amber-300/50' : ''}`}
      />

      {counters.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-0.5 pointer-events-none">
          {counters.map(([type, n]) => (
            <span
              key={type}
              className={`px-1 rounded-full text-[9px] font-bold leading-4 tabular-nums shadow ring-1 ring-white/30 ${
                type === '+1/+1' ? 'bg-emerald-500/90 text-white'
                : type === '-1/-1' ? 'bg-red-500/90 text-white'
                : 'bg-zinc-600/90 text-white'
              }`}
            >
              {type === '+1/+1' ? `+${n}` : type === '-1/-1' ? `−${n}` : n}
            </span>
          ))}
        </div>
      )}

      {hovered && (
        <button
          onClick={() => permanentToZone(opponentId, permanent.instanceId, 'graveyard')}
          title={`Destroy ${permanent.card.name}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center shadow ring-1 ring-black/40"
        >
          <Skull className="w-2.5 h-2.5" />
        </button>
      )}

      {showPreview && !drag.isDragging && (
        <MagnifiedPreview card={permanent.card} anchorRef={boxRef} />
      )}
      <OpponentCardMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
