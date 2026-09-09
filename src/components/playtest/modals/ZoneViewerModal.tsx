import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { DraggableAttributes } from '@dnd-kit/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import { Sprout, Swords, Flame, BookOpen, Shield, Shuffle, type LucideIcon } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { PlaytestCardMenu, type CardMenuTarget } from '@/components/playtest/PlaytestCardMenu';
import { useMagnifyKey } from '@/hooks/useMagnifyKey';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getAllCardRoles, hasTaggerData, loadTaggerData, type RoleKey } from '@/services/tagger/client';
import type { ScryfallCard } from '@/types';
import type { ZoneKey } from '@/components/playtest/types';

const ZONE_LABEL: Record<string, string> = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', command: 'Command Zone' };

/** Card types worth a filter chip, in the order they read on a curve. A card counts for every
 *  type on its line, so an Artifact Creature answers to both chips. */
const TYPE_CHIPS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'] as const;

/** Short chip labels — ROLE_LABELS' full names ("Card Advantage") don't fit a chip row.
 *  Icons and colors are the app-wide role set (see ROLE_ICON in DeckBuildingArea and
 *  ROLE_ICON_COLORS in the optimizer constants) — a Sprout means ramp everywhere. */
const ROLE_CHIPS: { key: RoleKey; label: string; Icon: LucideIcon; color: string }[] = [
  { key: 'ramp', label: 'Ramp', Icon: Sprout, color: 'text-emerald-400' },
  { key: 'removal', label: 'Removal', Icon: Swords, color: 'text-rose-400' },
  { key: 'boardwipe', label: 'Wipes', Icon: Flame, color: 'text-orange-400' },
  { key: 'cardDraw', label: 'Draw', Icon: BookOpen, color: 'text-sky-400' },
  { key: 'protection', label: 'Protection', Icon: Shield, color: 'text-yellow-400' },
];

/** Zones where card order is yours to scramble. Exile and the command zone aren't piles you draw
 *  from, so shuffling them would be a button that does nothing you can observe. */
const SHUFFLEABLE_ZONES: Exclude<ZoneKey, 'hand'>[] = ['library', 'graveyard'];

function cardHasType(card: ScryfallCard, type: string): boolean {
  return card.type_line?.toLowerCase().includes(type.toLowerCase()) ?? false;
}

interface ZoneCardTriggerProps extends React.ComponentPropsWithoutRef<'button'> {
  card: ScryfallCard;
  dragAttributes: DraggableAttributes;
  dragListeners: Record<string, unknown> | undefined;
  isDragging: boolean;
}

const ZoneCardTrigger = forwardRef<HTMLButtonElement, ZoneCardTriggerProps>(
  function ZoneCardTrigger({ card, dragAttributes, dragListeners, isDragging, className: extraClassName, ...props }, ref) {
    const localRef = useRef<HTMLButtonElement | null>(null);
    const setRefs = (node: HTMLButtonElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
    };
    const [hovered, setHovered] = useState(false);
    const magnify = useMagnifyKey();
    return (
      <button
        ref={setRefs}
        {...dragAttributes}
        {...(dragListeners as Record<string, unknown>)}
        {...props}
        onMouseEnter={(e) => { setHovered(true); props.onMouseEnter?.(e); }}
        onMouseLeave={(e) => { setHovered(false); props.onMouseLeave?.(e); }}
        className={`rounded-[6px] hover:ring-2 hover:ring-primary transition-all touch-none select-none ${isDragging ? 'opacity-0' : ''} ${extraClassName ?? ''}`}
      >
        <img
          src={getCardImageUrl(card, 'small')}
          alt={card.name}
          className="w-full rounded-[6px] shadow pointer-events-none"
          draggable={false}
        />
        {magnify && hovered && !isDragging && <MagnifiedPreview card={card} anchorRef={localRef} />}
      </button>
    );
  },
);

export function ZoneViewerModal() {
  const modal = usePlaytestStore(s => s.modal);
  const zones = usePlaytestStore(s => s.zones);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const moveCard = usePlaytestStore(s => s.moveCard);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const shufflePile = usePlaytestStore(s => s.shufflePile);
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [menu, setMenu] = useState<CardMenuTarget | null>(null);
  const isMobile = !useMediaQuery('(min-width: 768px)');
  // Role chips need the tagger's oracle tags. Same cached fetch the Inspector uses — a no-op
  // once anything else in the session has pulled it. The tick re-renders when it lands.
  const [, setTaggerTick] = useState(0);
  useEffect(() => {
    if (hasTaggerData()) return;
    let alive = true;
    loadTaggerData().then(() => { if (alive) setTaggerTick(t => t + 1); });
    return () => { alive = false; };
  }, []);

  // Hooks must run unconditionally — derive zone before bailing out below.
  const dialogZone: Exclude<ZoneKey, 'hand'> = modal && modal.kind === 'zoneViewer' ? modal.zone : 'graveyard';
  const droppable = useDroppable({
    id: `zone-viewer:${dialogZone}`,
    data: { kind: 'pile', zone: dialogZone, floating: true },
  });

  const cardsForZone = modal && modal.kind === 'zoneViewer' ? zones[modal.zone] : [];

  const filtered = useMemo(() => {
    const indexed = cardsForZone.map((card, originalIndex) => ({ card, originalIndex }));
    const needle = q.toLowerCase().trim();
    if (!needle && types.length === 0 && roles.length === 0) return indexed;
    return indexed.filter(({ card }) => {
      if (needle && !(
        card.name.toLowerCase().includes(needle) ||
        card.type_line.toLowerCase().includes(needle)
      )) return false;
      // OR within a chip group, AND across the groups: "creatures or artifacts, that also ramp".
      if (types.length > 0 && !types.some(t => cardHasType(card, t))) return false;
      if (roles.length > 0) {
        const cardRoles = getAllCardRoles(card.name);
        if (!roles.some(r => cardRoles.includes(r))) return false;
      }
      return true;
    });
  }, [cardsForZone, q, types, roles]);

  // Chip counts read the whole zone, not the current filter — the question a chip answers is
  // "how much removal is left in my library", which shouldn't move as you narrow things down.
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of TYPE_CHIPS) {
      const n = cardsForZone.filter(c => cardHasType(c, type)).length;
      if (n > 0) counts.set(type, n);
    }
    return counts;
  }, [cardsForZone]);

  const roleCounts = useMemo(() => {
    const counts = new Map<RoleKey, number>();
    if (!hasTaggerData()) return counts;
    for (const card of cardsForZone) {
      for (const role of getAllCardRoles(card.name)) {
        counts.set(role, (counts.get(role) ?? 0) + 1);
      }
    }
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- also recomputes when tagger data lands
  }, [cardsForZone, hasTaggerData()]);

  // Re-filter when modal closes/reopens? Reset filter on zone change.
  useEffect(() => { setQ(''); setTypes([]); setRoles([]); }, [dialogZone]);

  if (!modal || modal.kind !== 'zoneViewer') return null;
  const zone = modal.zone;
  const cards = cardsForZone;

  const title = (
    <>
      {ZONE_LABEL[zone]}
      <span className="text-muted-foreground font-normal ml-1.5">
        ({filtered.length}{filtered.length !== cards.length ? ` of ${cards.length}` : ''})
      </span>
    </>
  );

  return (
    <FloatingDialog
      title={title}
      onClose={closeModal}
      storageKey={`playtest:dialog-pos:zone-viewer:${zone}`}
      sizeStorageKey={`playtest:dialog-size:zone-viewer:${zone}`}
      resizable
      headerActions={SHUFFLEABLE_ZONES.includes(zone) && cards.length > 1 ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          // S is a global hotkey; R only fires while a pile is hovered, so it isn't
          // reachable from in here — don't promise it on the graveyard button.
          title={zone === 'library' ? 'Shuffle library (S)' : `Shuffle ${ZONE_LABEL[zone].toLowerCase()}`}
          aria-label={`Shuffle ${ZONE_LABEL[zone].toLowerCase()}`}
          // The header bar is the drag handle — don't let the press start a drag.
          onPointerDown={e => e.stopPropagation()}
          // shuffle() is the library's own action: it also bumps shuffleTick, which is what
          // makes the pile behind the dialog play its shuffle animation.
          onClick={() => (zone === 'library' ? shuffle() : shufflePile(zone))}
        >
          <Shuffle className="w-4 h-4" />
        </Button>
      ) : undefined}
      outerRef={droppable.setNodeRef}
      outerClassName={droppable.isOver ? 'border-primary ring-2 ring-primary/60' : ''}
    >
      <div className="px-4 py-2 border-b border-border/40 space-y-2">
        <Input
          placeholder="Search by name or type…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {(typeCounts.size > 0 || roleCounts.size > 0) && (
          <div className="flex items-center gap-1 flex-wrap">
            {TYPE_CHIPS.filter(t => typeCounts.has(t)).map(type => (
              <FilterChip
                key={type}
                icon={<CardTypeIcon type={type} size="sm" className={types.includes(type) ? '' : 'text-muted-foreground'} />}
                label={type}
                count={typeCounts.get(type)!}
                active={types.includes(type)}
                onClick={() => setTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
              />
            ))}
            {roleCounts.size > 0 && typeCounts.size > 0 && (
              <span className="w-px self-stretch my-0.5 bg-border/60 mx-0.5" aria-hidden />
            )}
            {ROLE_CHIPS.filter(r => roleCounts.has(r.key)).map(role => (
              <FilterChip
                key={role.key}
                // Color is the "on" signal: the role's hue only lights up once its chip is
                // active, so an untouched row reads as one quiet set of glyphs.
                icon={<role.Icon className={roles.includes(role.key) ? role.color : 'text-muted-foreground'} />}
                label={role.label}
                count={roleCounts.get(role.key)!}
                active={roles.includes(role.key)}
                onClick={() => setRoles(prev => prev.includes(role.key) ? prev.filter(r => r !== role.key) : [...prev, role.key])}
              />
            ))}
            {(types.length > 0 || roles.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                onClick={() => { setTypes([]); setRoles([]); }}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground italic text-center py-10">
            {cards.length === 0 ? `${ZONE_LABEL[zone]} is empty. Drag cards here to add them.` : 'No cards match the filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
            {filtered.map(({ card, originalIndex }) => (
              <ViewerCard
                key={`${card.id}-${originalIndex}`}
                card={card}
                originalIndex={originalIndex}
                zone={zone}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'zone', zone, zoneIndex: originalIndex, card, x: e.clientX, y: e.clientY });
                }}
                // Mobile only: tap to play the card straight to the battlefield.
                onTap={isMobile ? () => {
                  moveCard({
                    source: { kind: 'zone', zone, index: originalIndex },
                    target: { kind: 'battlefield', x: 50, y: 0, arrived: true },
                  });
                  closeModal();
                } : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <PlaytestCardMenu target={menu} onClose={() => setMenu(null)} />
    </FloatingDialog>
  );
}

function FilterChip({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      className="h-6 pl-1.5 pr-2 text-[11px] gap-1 [&_svg]:size-3"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
      <span className={`tabular-nums ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{count}</span>
    </Button>
  );
}

interface ViewerCardProps {
  card: ScryfallCard;
  originalIndex: number;
  zone: Exclude<ZoneKey, 'hand'>;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Optional tap-to-play handler (mobile only). Drag still wins via dnd-kit's
   *  activation threshold — a real swipe starts the drag instead of firing this. */
  onTap?: () => void;
}

function ViewerCard({ card, originalIndex, zone, onContextMenu, onTap }: ViewerCardProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `viewer:${zone}:${originalIndex}:${card.id}`,
    data: { source: { kind: 'zone', zone, index: originalIndex } },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `viewer-slot:${zone}:${originalIndex}`,
    data: { kind: 'zone-card-slot', zone, index: originalIndex },
  });
  const composedRef = (node: HTMLButtonElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <ZoneCardTrigger
      ref={composedRef}
      card={card}
      dragAttributes={attributes}
      dragListeners={listeners}
      isDragging={isDragging}
      title={onTap ? `${card.name} · tap to play · long-press for options` : `${card.name} · right-click for options · drag to reorder`}
      onClick={onTap}
      onContextMenu={onContextMenu}
      className={isOver && !isDragging ? 'ring-2 ring-primary' : undefined}
    />
  );
}
