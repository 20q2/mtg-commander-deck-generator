import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { CardCounterChip } from '@/components/playtest/CardOverlays';
import { CARD_COUNTER_TYPES, COUNTER_COLORS, DIE_SIDES, type CounterColor, type DieSides } from '@/components/playtest/types';

// Polyhedral silhouettes (percent coords) — distinct per die.
const DIE_SHAPES: Record<DieSides, string> = {
  4:  'polygon(50% 4%, 96% 96%, 4% 96%)',
  6:  'polygon(8% 8%, 92% 8%, 92% 92%, 8% 92%)',
  8:  'polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)',
  10: 'polygon(50% 0%, 92% 38%, 50% 100%, 8% 38%)',
  12: 'polygon(50% 4%, 95% 38%, 78% 96%, 22% 96%, 5% 38%)',
  20: 'polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)',
};

/** Nudge the user when they tap a card-bound tile with nothing selected. */
function hint(text: string) {
  usePlaytestStore.setState(s => ({ toast: { text, tick: (s.toast?.tick ?? 0) + 1 } }));
}

export function CreateModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const addFreeCounter = usePlaytestStore(s => s.addFreeCounter);
  const addFreeDie = usePlaytestStore(s => s.addFreeDie);
  const adjustCounter = usePlaytestStore(s => s.adjustCounter);
  const addSticker = usePlaytestStore(s => s.addSticker);
  const selectedIds = usePlaytestStore(s => s.selectedIds);

  const [color, setColor] = useState<CounterColor>('blue');
  const colorCfg = COUNTER_COLORS.find(c => c.key === color) ?? COUNTER_COLORS[0];
  const [stickerText, setStickerText] = useState('');

  // Card counters and stickers have to land on a card. Tapping applies to the
  // current selection; with nothing selected the only route is a drag, so say so.
  const applyCounter = (type: string) => {
    if (selectedIds.length === 0) { hint('Select a card, or drag the counter onto one'); return; }
    selectedIds.forEach(id => adjustCounter(id, type, 1));
  };
  const applySticker = () => {
    if (selectedIds.length === 0) { hint('Select a card, or drag the sticker onto one'); return; }
    const state = usePlaytestStore.getState();
    selectedIds.forEach(id => {
      // Stagger down the card so a second sticker doesn't land on the first.
      const n = state.battlefield.find(b => b.instanceId === id)?.stickers?.length ?? 0;
      addSticker(id, stickerText.trim() || 'New sticker', { x: 8, y: 8 + n * 20 });
    });
  };

  return (
    <FloatingDialog
      title="Create"
      onClose={closeModal}
      storageKey="playtest:dialog-pos:create"
      width={360}
    >
      <div className="px-5 py-4 space-y-4">
        {/* Header row: section label + current color name */}
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground/80">
            Palette
          </div>
          <div className="text-xs font-medium text-foreground/90">{colorCfg.label}</div>
        </div>

        {/* Color picker — large, clearly tappable swatches in a single row */}
        <div className="grid grid-cols-6 gap-2">
          {COUNTER_COLORS.map(c => {
            const active = color === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setColor(c.key)}
                title={c.label}
                aria-label={c.label}
                aria-pressed={active}
                className={`relative h-9 rounded-md ${c.chip} transition-all duration-150 ${
                  active
                    ? `ring-2 ring-offset-2 ring-offset-card ${c.ring} -translate-y-0.5 shadow-md`
                    : 'hover:-translate-y-0.5 hover:shadow-sm opacity-90 hover:opacity-100'
                }`}
              >
                {active && (
                  <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" strokeWidth={3} />
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-border/40" />

        {/* Palette grid — counter + 6 dice, tinted with current color at rest */}
        <div className="grid grid-cols-4 gap-3">
          <CounterTile color={color} colorCfg={colorCfg} onClick={() => addFreeCounter(color)} />
          {DIE_SIDES.map(n => (
            <DieTile
              key={n}
              sides={n}
              color={color}
              colorCfg={colorCfg}
              onClick={() => addFreeDie(n, undefined, color)}
            />
          ))}
        </div>

        <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60 text-center">
          Tap to spawn · drag onto the battlefield
        </p>

        <div className="border-t border-border/40" />

        {/* Card counters — unlike the free counters above, these go ON a card, so
            they carry the fixed badge colour of their type, not the palette. */}
        <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground/80">
          Card counters
        </div>
        <div className="grid grid-cols-4 gap-3">
          {CARD_COUNTER_TYPES.map(t => (
            <CardCounterTile key={t.key} type={t} onClick={() => applyCounter(t.key)} />
          ))}
        </div>

        {/* Text stickers */}
        <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground/80">
          Text sticker
        </div>
        <div className="flex items-center gap-3">
          <input
            value={stickerText}
            onChange={(e) => setStickerText(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applySticker(); }}
            placeholder="Flying, Goaded, 8/8…"
            className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-background border border-border/60 text-xs outline-none focus:border-teal-400"
          />
          <StickerTile text={stickerText} onClick={applySticker} />
        </div>

        <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60 text-center">
          Drag onto a card · tap to apply to the selection
        </p>
      </div>
    </FloatingDialog>
  );
}

function CardCounterTile({ type, onClick }: {
  type: typeof CARD_COUNTER_TYPES[number]; onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `create-card-counter:${type.key}`,
    data: { createCardCounter: { type: type.key } },
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      title={`${type.label} counter`}
      aria-label={`${type.label} counter`}
      className={`group relative h-[72px] rounded-md border border-border/60 hover:border-foreground/40 transition-colors duration-150 touch-none flex flex-col items-center justify-center gap-1.5 ${
        isDragging ? 'opacity-0' : ''
      }`}
    >
      {/* The badge this tile will produce, so loyalty reads as a shield here too. */}
      <span className="flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity duration-150">
        <CardCounterChip type={type.key} height={26} />
      </span>
      <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/80 group-hover:text-foreground transition-colors">
        {type.label}
      </span>
    </button>
  );
}

function StickerTile({ text, onClick }: { text: string; onClick: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: 'create-sticker',
    // Read at drop time by the page, so the label typed above rides along.
    data: { createSticker: { text } },
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      title="Text sticker"
      aria-label="Text sticker"
      className={`group shrink-0 px-3 h-[34px] rounded-md border border-border/60 hover:border-foreground/40 transition-colors duration-150 touch-none flex items-center ${
        isDragging ? 'opacity-0' : ''
      }`}
    >
      <span className="inline-block max-w-[110px] truncate px-1.5 py-0.5 rounded bg-teal-500/90 text-white text-[10px] font-bold shadow ring-1 ring-teal-200/50 opacity-70 group-hover:opacity-100 transition-opacity">
        {text.trim() || 'Sticker'}
      </span>
    </button>
  );
}

function CounterTile({ color, colorCfg, onClick }: {
  color: CounterColor; colorCfg: typeof COUNTER_COLORS[number]; onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `create-counter:${color}`,
    data: { createCounter: { color } },
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      title="Counter"
      aria-label="Counter"
      className={`group relative h-[72px] rounded-md border border-border/60 hover:border-foreground/40 transition-colors duration-150 touch-none flex flex-col items-center justify-center gap-1.5 ${
        isDragging ? 'opacity-0' : ''
      }`}
    >
      {/* Tinted chip preview — softly the active color at rest, full on hover */}
      <div
        className={`relative w-7 h-7 rounded-md ${colorCfg.chip} opacity-40 group-hover:opacity-100 transition-opacity duration-150 ring-2 ${colorCfg.ring} ring-offset-0`}
      >
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white/0 group-hover:text-white transition-colors">
          1
        </span>
      </div>
      <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/80 group-hover:text-foreground transition-colors">
        Counter
      </span>
    </button>
  );
}

function DieTile({ sides, color, colorCfg, onClick }: {
  sides: DieSides; color: CounterColor; colorCfg: typeof COUNTER_COLORS[number]; onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `create-die:${sides}:${color}`,
    data: { createDie: { sides, color } },
  });
  const clip = { clipPath: DIE_SHAPES[sides] } as const;
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      title={`d${sides}`}
      aria-label={`d${sides}`}
      className={`group relative h-[72px] rounded-md border border-border/60 hover:border-foreground/40 transition-colors touch-none ${
        isDragging ? 'opacity-0' : ''
      }`}
    >
      {/* Tinted polygon — soft fill in the active color at rest, full on hover. */}
      <span
        aria-hidden
        className={`absolute inset-2 ${colorCfg.chip} opacity-30 group-hover:opacity-100 transition-opacity duration-150`}
        style={clip}
      />
      {/* Subtle top sheen — only visible at full opacity (on hover) */}
      <span
        aria-hidden
        className="absolute inset-2 bg-gradient-to-b from-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={clip}
      />
      <span className="relative z-10 flex items-center justify-center w-full h-full font-semibold tabular-nums text-xs text-foreground/85 group-hover:text-white transition-colors">
        d{sides}
      </span>
    </button>
  );
}
