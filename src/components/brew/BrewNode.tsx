import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Flame, Sprout, Crosshair, Bomb, BookOpen, Zap, Sparkles, Layers, Package, Infinity as InfinityIcon, Crown, Plus, type LucideIcon } from 'lucide-react';
import { getCardImageUrl, getCardPrice } from '@/services/scryfall/client';
import { operationTheme, routeKey, BrewGlyph } from '@/components/brew/brewVisuals';
import { RoleBadges } from '@/components/brew/RoleBadges';
import type { BrewOption } from '@/services/brew/engine';
import type { ScryfallCard } from '@/types';

// Each reason kind gets its own quiet colour so the badge row reads at a glance.
// gameChanger + combo are the headline call-outs and read brighter/bolder than the rest.
const REASON_CHIP: Record<string, string> = {
  gameChanger: 'border-amber-300/70 bg-gradient-to-r from-amber-400/25 to-yellow-500/15 text-amber-100 font-semibold shadow-[0_0_12px_-2px_rgba(251,191,36,0.4)]',
  combo: 'border-teal-300/60 bg-teal-500/20 text-teal-100 font-semibold',
  role: 'border-sky-400/40 bg-sky-500/12 text-sky-200',
  synergy: 'border-violet-400/40 bg-violet-500/15 text-violet-200',
  theme: 'border-emerald-400/40 bg-emerald-500/12 text-emerald-200',
  curve: 'border-cyan-400/40 bg-cyan-500/12 text-cyan-200',
  // Lift = the headline "hidden synergy" call-out: a glowing fuchsia/violet chip that visibly
  // outshines the calm violet "Synergy NN" popularity chip, so a lift find reads as secret tech.
  lift: 'border-fuchsia-300/70 bg-gradient-to-r from-fuchsia-500/30 to-violet-500/20 text-fuchsia-50 font-semibold shadow-[0_0_12px_-2px_rgba(232,121,249,0.55)]',
  discovery: 'border-fuchsia-400/40 bg-fuchsia-500/12 text-fuchsia-200',
  tag: 'border-slate-400/40 bg-slate-500/15 text-slate-200',
};

// Role chips lead with their operation icon (matching the routes/backdrop) instead of the word "Fills".
const ROLE_ICON: Record<string, LucideIcon> = {
  Ramp: Sprout, Removal: Crosshair, 'Board Wipes': Bomb, 'Card Advantage': BookOpen,
};

// Each pack in a multi-pack round wears its direction: a need it fills, your theme, or a lift find.
const PACK_FLAVOR: Record<string, { color: string; Icon: LucideIcon; tag: string }> = {
  need: { color: '205 82% 60%', Icon: Crosshair, tag: 'Fills a need' },
  theme: { color: '152 60% 50%', Icon: Layers, tag: 'On theme' },
  discovery: { color: '292 76% 64%', Icon: Sparkles, tag: 'Hidden synergy' },
  combo: { color: '172 70% 50%', Icon: InfinityIcon, tag: 'Combo pieces' },
  value: { color: '230 12% 70%', Icon: Package, tag: '' }, // label carries the meaning (Wildcards / Top End / Cheap & Early)
};

export function BrewNode({ onFinish }: { onFinish: () => void }) {
  const { brewNode, applyBrewOption, backToBrewFork, rerollBrew, customization } = useStore();
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Hovering a (small) card pops a full, readable preview anchored beside it.
  const [hover, setHover] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  if (!brewNode) return null;

  const hoverPreview = (card: ScryfallCard) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => setHover({ card, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => setHover(null),
  });

  const op = operationTheme(brewNode.type, routeKey(brewNode.routeId));

  const exiting = chosenId !== null;
  const allShown = brewNode.options.flatMap(o => o.cards.map(c => c.name));
  // Packaged choices (a bundle, the lightning five, a multi-piece combo) render as a group of
  // smaller card images; a single-card choice renders one large "hero" card, Slay-the-Spire style.
  // Combos always use the compact grouped layout so 1- and 2-piece combos line up uniformly.
  const packaged = brewNode.type === 'bundle' || brewNode.type === 'combo'
    || (brewNode.options[0]?.cards.length ?? 0) > 1;
  // Single-card draft cells fill their grid column (capped) so all options stay on one row no
  // matter how wide the choices column is; packaged groups keep a fixed compact width.
  const cardW = packaged ? 'w-[136px]' : 'w-full max-w-[200px]';
  const imgSize = packaged ? 'small' : 'normal';
  const isCombo = brewNode.type === 'combo';
  // Pack rounds get their own "crate" treatment — flavor-tinted panels you pick between.
  const isPack = brewNode.type === 'bundle';

  function choose(option: BrewOption) {
    if (exiting) return;                          // ignore clicks once a card is on its way out
    const taken = new Set(option.cards.map(c => c.name));
    const passed = allShown.filter(n => !taken.has(n));
    setChosenId(option.id);                        // play the fly-to-deck / melt-away animation…
    setHover(null);
    window.setTimeout(() => applyBrewOption(option, passed), 380); // …then commit the pick
  }

  return (
    <div className="text-center" style={{ ['--op' as string]: `hsl(${op.color})`, ['--op-soft' as string]: `hsl(${op.color} / 0.5)` }}>
      {/* The operation's sigil, in its own colour, presiding over the prompt. */}
      <span
        className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 backdrop-blur-sm"
        style={{
          color: `hsl(${op.color})`,
          borderColor: `hsl(${op.color} / 0.6)`,
          background: `hsl(${op.color} / 0.12)`,
          boxShadow: `0 0 28px hsl(${op.color} / 0.35)`,
        }}
      >
        <BrewGlyph sym={op.glyph} className="text-[22px] w-6 h-6" />
      </span>
      <h2 className="font-display text-2xl font-semibold tracking-tight mb-1" style={{ textShadow: `0 2px 22px hsl(${op.color} / 0.35)` }}>
        {brewNode.prompt}
      </h2>
      <p className="text-xs text-muted-foreground mb-7">
        {brewNode.type === 'bundle' ? 'Choose one package — the others move on.'
          : brewNode.type === 'draft' ? 'Take one card. The rest are gone.'
          : brewNode.type === 'combo' ? 'Pick a combo to finish, or pass.'
          : 'Take one card.'}
      </p>

      {brewNode.options.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10">
          No cards left for this route.{' '}
          <button className="text-violet-300 underline" onClick={onFinish}>Finish the deck</button> or go back.
        </div>
      ) : isPack ? (
        /* ── Pack picker: three flavor-tinted crates in a row; inside each, the cards stack
              2-over-1 so they're big enough to read. Pick one whole package. ── */
        <div
          key={`${brewNode.routeId}|${allShown.join(',')}`}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch"
          style={{ perspective: '1200px' }}
        >
          {brewNode.options.map((option, idx) => {
            const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
            return (
              <button
                key={option.id}
                onClick={() => choose(option)}
                disabled={exiting}
                style={{
                  ['--pk' as string]: `hsl(${fl.color})`,
                  ['--pk-soft' as string]: `hsl(${fl.color} / 0.4)`,
                  // A faint flavor wash over the card base so each pack reads in its own colour.
                  background: `linear-gradient(hsl(${fl.color} / 0.08), hsl(${fl.color} / 0.03)), hsl(var(--card) / 0.4)`,
                  ...(exiting ? {} : { animationDelay: `${idx * 70}ms` }),
                }}
                className={`group relative z-10 flex flex-col overflow-hidden rounded-2xl border border-[color:var(--pk)]/35 bg-card/40 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1.5 hover:border-[color:var(--pk)] hover:shadow-[0_18px_44px_-10px_var(--pk-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
                  exiting ? (option.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss') : 'animate-brew-card-in'
                }`}
              >
                {/* Header — the pack's direction, in its own colour. */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--pk)]/20" style={{ background: `hsl(${fl.color} / 0.10)` }}>
                  <fl.Icon className="w-4 h-4 shrink-0" style={{ color: `hsl(${fl.color})` }} />
                  <span className="font-display text-sm font-semibold truncate text-left" style={{ color: `hsl(${fl.color})` }}>{option.label}</span>
                  <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">{fl.tag}</span>
                </div>
                {/* The cards inside the pack, stacked 2-over-1 so each is big enough to read. */}
                <div className="grid grid-cols-2 gap-2 px-2.5 pt-4 pb-2 justify-items-center">
                  {option.cards.map((c, i) => {
                    const rs = option.reasons[i] ?? [];
                    const finishesCombo = rs.some(r => r.kind === 'combo');
                    const isGameChanger = rs.some(r => r.kind === 'gameChanger');
                    // A lone final card (odd count) spans both columns and centers on the bottom row.
                    const cardLastOdd = option.cards.length % 2 === 1 && i === option.cards.length - 1;
                    return (
                      <div key={c.name} className={`relative min-w-0 flex flex-col items-center ${cardLastOdd ? 'col-span-2 w-[calc(50%-0.25rem)]' : 'w-full'}`}>
                        <RoleBadges cardName={c.name} size="sm" />
                        {c.discoverySource === 'lift' && (
                          <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-0.5 rounded-full border border-fuchsia-300/70 bg-[#2a0a2e]/90 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fuchsia-100 shadow-[0_0_12px_-2px_rgba(232,121,249,0.6)]">
                            <Zap className="w-2.5 h-2.5" /> Lift
                          </span>
                        )}
                        {(finishesCombo || isGameChanger) && (
                          <span className="absolute top-1 right-1 z-20 flex flex-col gap-1">
                            {finishesCombo && <span title="Finishes a combo" className="grid place-items-center w-4 h-4 rounded-full bg-teal-500/90 text-white shadow ring-1 ring-black/40"><InfinityIcon className="w-2.5 h-2.5" /></span>}
                            {isGameChanger && <span title="Game Changer" className="grid place-items-center w-4 h-4 rounded-full bg-amber-400/90 text-black shadow ring-1 ring-black/40"><Crown className="w-2.5 h-2.5" /></span>}
                          </span>
                        )}
                        <img
                          src={getCardImageUrl(c.scryfall, 'small')}
                          alt={c.name}
                          loading="lazy"
                          {...hoverPreview(c.scryfall)}
                          className="block w-full h-auto rounded-[4.8%] shadow-[0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-black/60 transition-transform duration-150 ease-out group-hover:-translate-y-1"
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Footer — you're taking the whole pack, not one card. */}
                <div className="mt-auto flex items-center justify-center gap-1 px-3 pb-2.5 pt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: `hsl(${fl.color})` }}>
                  <Plus className="w-3 h-3" /> Take all {option.cards.length}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
      /* ── Single-card / lightning / combo layout. Remount on open AND reroll so deal-in replays. ── */
      <div
        key={`${brewNode.routeId}|${allShown.join(',')}`}
        className={`relative gap-y-9 ${packaged ? `flex flex-wrap items-stretch justify-center ${isCombo ? 'gap-x-6' : 'gap-x-2'}` : 'grid items-stretch gap-x-3'}`}
        style={packaged
          ? { perspective: '1200px' }
          : { perspective: '1200px', gridTemplateColumns: `repeat(${brewNode.options.length}, minmax(0, 1fr))` }}
      >
        {/* A soft spotlight in the operation's colour, so the cards feel lit, not floating. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] h-[130%] blur-3xl z-0"
          style={{ background: `radial-gradient(ellipse at center, hsl(${op.color} / 0.10), transparent 70%)` }}
        />
        {brewNode.options.map((option, idx) => (
          <button
            key={option.id}
            onClick={() => choose(option)}
            disabled={exiting}
            style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
            className={`group relative z-10 flex flex-col items-center gap-2 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--op)] ${
              isCombo
                ? 'px-4 pt-3 pb-4 border border-border/50 bg-card/40 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-colors duration-200 hover:border-[color:var(--op)] hover:bg-card/60'
                : 'p-1'
            } ${
              exiting
                ? (option.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                : 'animate-brew-card-in'
            }`}
          >
            {option.label && (() => {
              const fl = option.flavor ? PACK_FLAVOR[option.flavor] : null;
              return (
                <div className="flex flex-col items-center gap-0.5 mb-0.5">
                  <div
                    className="font-display text-sm font-semibold inline-flex items-center gap-1"
                    style={fl ? { color: `hsl(${fl.color})` } : undefined}
                  >
                    {fl && <fl.Icon className="w-3.5 h-3.5" />}{option.label}
                  </div>
                  {fl && <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">{fl.tag}</span>}
                </div>
              );
            })()}
            {/* Floats above the card's top edge so it never pushes the card down or breaks the row. */}
            {option.spicy && (
              <span className="absolute -top-3 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-[#231405]/85 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 shadow-[0_3px_14px_rgba(251,191,36,0.35)]">
                <Flame className="w-3 h-3" /> Spicy
              </span>
            )}
            {/* Top-align the card images so a row stays even no matter how many reason tags hang
                below each card. Combos keep bottom-alignment so the "Have + Add" pieces line up. */}
            <div className={`flex w-full justify-center gap-2.5 ${isCombo ? 'items-end' : 'items-start'}`}>
              {/* Combo context: the owned piece(s) this card goes infinite with, dimmed + a "+". */}
              {isCombo && option.comboHave?.map(p => (
                <div key={`have:${p.name}`} className="w-[88px] flex flex-col items-center opacity-60">
                  <img
                    src={getCardImageUrl(p.scryfall, 'small')}
                    alt={p.name}
                    loading="lazy"
                    className="block w-full h-auto rounded-[4.8%] grayscale-[0.35] shadow-[0_4px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/60"
                  />
                  <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Have</span>
                </div>
              ))}
              {isCombo && (option.comboHave?.length ?? 0) > 0 && (
                <span aria-hidden="true" className="self-center pb-7 text-2xl font-light text-muted-foreground/50">+</span>
              )}
              {option.cards.map((c, i) => {
                // Drop the "On-theme" chip here — the leaning readout already lives on the fork.
                const reasons = (option.reasons[i] ?? []).filter(r => r.kind !== 'theme');
                return (
                  <div key={c.name} className={`${cardW} relative flex flex-col items-center`}>
                    <RoleBadges cardName={c.name} size={packaged ? 'sm' : 'md'} />
                    {/* A lift find wears an electric "⚡ Lift" ribbon — it's in the pool because of a
                        card-to-card synergy spike, not because it's a commander staple. */}
                    {c.discoverySource === 'lift' && (
                      <span className="absolute -top-2 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-0.5 rounded-full border border-fuchsia-300/70 bg-[#2a0a2e]/85 backdrop-blur-sm px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fuchsia-100 shadow-[0_0_12px_-2px_rgba(232,121,249,0.6)]">
                        <Zap className="w-2.5 h-2.5" /> Lift
                      </span>
                    )}
                    <img
                      src={getCardImageUrl(c.scryfall, imgSize)}
                      alt={c.name}
                      loading="lazy"
                      {...hoverPreview(c.scryfall)}
                      className="block w-full h-auto rounded-[4.8%] shadow-[0_6px_18px_rgba(0,0,0,0.55)] ring-1 ring-black/60 transition-transform duration-150 ease-out group-hover:-translate-y-2.5 group-hover:scale-[1.07] group-hover:shadow-[0_18px_44px_var(--op-soft)] group-hover:ring-[color:var(--op)]"
                    />
                    {isCombo && (
                      <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--op)]">Add</span>
                    )}
                    {reasons.length > 0 && (
                      <div className="mt-2 flex w-full flex-wrap justify-center gap-1">
                        {reasons.map((r, ri) => {
                          const LeadIcon = r.kind === 'lift' ? Zap : r.kind === 'role' ? ROLE_ICON[r.label] : undefined;
                          return (
                            <span
                              key={ri}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${REASON_CHIP[r.kind] ?? 'border-border/60 bg-card/60 text-muted-foreground'}`}
                            >
                              {LeadIcon && <LeadIcon className="w-3 h-3" />}
                              {r.label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </button>
        ))}
      </div>
      )}

      <div className="flex items-center justify-center gap-2 mt-9 text-muted-foreground">
        <Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" disabled={exiting} onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1.5" /> Show different</Button>
        {brewNode.canPass && (<><span className="w-1 h-1 rotate-45 bg-border" /><Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}>Pass</Button></>)}
      </div>

      {/* Floating full-size preview of the hovered card — anchored to its right, flipping left near
          the edge and clamped to the viewport, so you can actually read the small pack thumbnails. */}
      {hover && !exiting && (() => {
        const W = 268, IMG_H = Math.round(W * 1.4), BAR = 34, GAP = 14, PAD = 8;
        const H = IMG_H + BAR;                 // reserve room for the price chip below the card
        const r = hover.rect;
        const vw = window.innerWidth, vh = window.innerHeight;
        let left = r.right + GAP;
        if (left + W + PAD > vw) { const l = r.left - GAP - W; left = l >= PAD ? l : Math.max(PAD, vw - W - PAD); }
        const top = Math.min(Math.max(8, r.top + r.height / 2 - IMG_H / 2), vh - H - 8);
        const url = getCardImageUrl(hover.card, 'normal');
        if (!url) return null;

        const raw = getCardPrice(hover.card, customization.currency);
        const n = raw != null ? Number(raw) : NaN;
        const sym = customization.currency === 'EUR' ? '€' : '$';
        const tone = !Number.isFinite(n) ? 'text-muted-foreground border-border/60'
          : n < 1 ? 'text-emerald-200 border-emerald-500/50'
          : n < 5 ? 'text-lime-200 border-lime-500/50'
          : n < 15 ? 'text-amber-200 border-amber-500/50'
          : n < 30 ? 'text-orange-200 border-orange-500/50'
          : 'text-rose-200 border-rose-500/60';

        // Portal to <body>: an ancestor (.animate-brew-view-in) keeps a transform from its
        // animation's fill-mode, which would otherwise make `position: fixed` resolve relative to
        // that element instead of the viewport — flinging the preview far from the card.
        return createPortal(
          <div
            className="fixed z-[120] pointer-events-none animate-fade-in flex flex-col items-center gap-1.5"
            style={{ left, top, width: W }}
          >
            <img src={url} alt={hover.card.name} className="w-full rounded-[4.8%] shadow-2xl ring-1 ring-black/70" />
            <span className={`rounded-md border bg-black/80 px-2.5 py-0.5 text-sm font-bold tabular-nums shadow-lg ${tone}`}>
              {Number.isFinite(n) ? `${sym}${n.toFixed(2)}` : 'No price'}
            </span>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
