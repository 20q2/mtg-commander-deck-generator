import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Bot, ChevronDown, ChevronUp, Heart, Plus, Skull, Swords, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { getCardImageUrl, getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { Opponent, OpponentPermanent } from '@/components/playtest/opponentTypes';

/**
 * The opponent band above the battlefield. It's a zone first and a bot second:
 * with nobody seated it's a single slim line offering the bots, which is the
 * discovery moment, and it never costs more than that when unused.
 */
export function OpponentStrip() {
  const opponents = useOpponentStore(s => s.opponents);
  const openModal = usePlaytestStore(s => s.openModal);
  const [collapsed, setCollapsed] = useState(false);

  if (opponents.length === 0) {
    return (
      <div className="shrink-0 border-b border-border/50 bg-card/30 px-2 sm:px-3 py-1.5 flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 text-violet-300/80 shrink-0" />
        <span className="text-[11px] text-muted-foreground hidden sm:inline">
          Goldfishing solo — no opponents.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          onClick={() => openModal({ kind: 'opponents' })}
        >
          <Plus className="w-3 h-3 mr-1" />
          Play against bots
        </Button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-border/50 bg-card/30">
      <div className="px-2 sm:px-3 py-1 flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 text-violet-300/80 shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Opponents · {opponents.length}
        </span>
        {collapsed && (
          <span className="text-[11px] text-muted-foreground truncate">
            {opponents.map(o => `${o.name} ${o.life}`).join(' · ')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {opponents.length < MAX_OPPONENTS && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => openModal({ kind: 'opponents' })}
              title="Seat another opponent"
            >
              <Plus className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">Add</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand opponents' : 'Collapse opponents'}
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex items-stretch gap-2 px-2 sm:px-3 pb-2 overflow-x-auto">
          {opponents.map(o => <OpponentLane key={o.id} opponent={o} />)}
        </div>
      )}
    </div>
  );
}

function OpponentLane({ opponent }: { opponent: Opponent }) {
  const adjustLife = useOpponentStore(s => s.adjustLife);
  const remove = useOpponentStore(s => s.remove);
  const setResistance = useOpponentStore(s => s.setResistance);
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
      className={`min-w-[210px] flex-1 rounded-lg border bg-background/30 p-1.5 transition-colors ${
        isOver ? 'border-violet-400/70 bg-violet-500/10' : 'border-border/40'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold truncate flex-1">{opponent.name}</span>
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
          onClick={() => remove(opponent.id)}
          className="ml-0.5 text-muted-foreground/70 hover:text-red-400 transition-colors"
          title={`Remove ${opponent.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/70">
        <span>hand {opponent.hand.length}</span>
        <span>library {opponent.library.length}</span>
        <span>gy {opponent.graveyard.length}</span>
        {opponent.decked && <span className="text-amber-400/80">decked</span>}
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
          {opponent.resistance ? 'Resisting' : 'Passive'}
        </button>
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
                    width={row.width}
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
 * Board rows, front to back. Creatures lead because the row's job is "what can
 * hit me"; lands sit at the back where they'd be in front of a real player.
 *
 * Flip this array to mirror the board instead — creatures nearest your own
 * battlefield, as if you were sitting across the table from them.
 */
const ROW_ORDER: { key: RowKey; label: string; width: number }[] = [
  { key: 'creatures', label: 'Creatures',       width: 58 },
  { key: 'others',    label: 'Other permanents', width: 46 },
  { key: 'lands',     label: 'Lands',            width: 34 },
];

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
  const removePermanent = useOpponentStore(s => s.removePermanent);
  const [hovered, setHovered] = useState(false);

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
      className={`relative shrink-0 ${drag.isDragging ? 'opacity-30' : ''}`}
      style={{ width }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        ref={drag.setNodeRef as unknown as React.Ref<HTMLImageElement>}
        {...drag.attributes}
        {...drag.listeners}
        src={getCardImageUrl(permanent.card, 'small')}
        alt={permanent.card.name}
        title={`${permanent.card.name}${permanent.tapped ? ' (tapped)' : ''} · click to tap · drag onto your battlefield to steal`}
        onClick={() => { if (!dragMoved.current) togglePermanentTap(opponentId, permanent.instanceId); }}
        draggable={false}
        className={`w-full rounded-[3px] shadow cursor-grab touch-none transition-transform ${
          permanent.tapped ? 'rotate-90' : ''
        } ${permanent.summoningSick ? 'ring-1 ring-amber-300/50' : ''}`}
      />
      {hovered && (
        <button
          onClick={() => removePermanent(opponentId, permanent.instanceId)}
          title={`Destroy ${permanent.card.name}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center shadow ring-1 ring-black/40"
        >
          <Skull className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}
