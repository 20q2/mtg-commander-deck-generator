import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { detectNearMissCombos } from '@/services/brew/engine';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Flame, Sprout, Crosshair, Bomb, BookOpen, Shield, Zap, Sparkles, Layers, Package, Infinity as InfinityIcon, Crown, Plus, Pin, Info, Check, Link2, Play, Star, type LucideIcon } from 'lucide-react';
import { getCardImageUrl, getCardPrice } from '@/services/scryfall/client';
import { operationTheme, routeKey, themeColor, legibleText } from '@/components/brew/brewVisuals';
import { RoleBadges } from '@/components/brew/RoleBadges';
import { BrewComboDetails } from '@/components/brew/BrewComboDetails';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { BrewOption, BrewCandidate, PickReason, ComboPiece } from '@/services/brew/engine';
import type { ScryfallCard } from '@/types';

/** How strongly a card synergizes with the deck you've built — drives the per-pack "best fit" spotlight.
 *  Only genuine deck-synergy signals count (whole-deck cluster, a combo finisher, a Game Changer, a
 *  high-co lift find) — NOT a plain on-theme tag, which is too common to be a standout. */
const FIT_THRESHOLD = 50;
function synergyFit(c: BrewCandidate, reasons: PickReason[]): number {
  let s = 0;
  if ((c.connectionCount ?? 0) >= 2) s = Math.max(s, 100 + c.connectionCount!);          // lifted by many of your cards
  if (reasons.some(r => r.kind === 'combo')) s = Math.max(s, 100);                        // finishes a combo with your picks
  if (reasons.some(r => r.kind === 'gameChanger')) s = Math.max(s, 90);
  if (c.discoverySource === 'lift' && (c.coSynergy ?? 0) >= FIT_THRESHOLD) s = Math.max(s, c.coSynergy!);
  return s;
}

// Each reason kind gets its own quiet colour so the badge row reads at a glance.
// gameChanger + combo are the headline call-outs and read brighter/bolder than the rest.
const REASON_CHIP: Record<string, string> = {
  gameChanger: 'border-amber-300/70 bg-gradient-to-r from-amber-400/25 to-yellow-500/15 text-amber-100 font-semibold shadow-[0_0_12px_-2px_rgba(251,191,36,0.4)]',
  combo: 'border-teal-300/60 bg-teal-500/20 text-teal-100 font-semibold',
  // Combo glue: related to combos (teal family) but quieter than the "Finishes a combo" call-out.
  comboPiece: 'border-teal-400/40 bg-teal-500/12 text-teal-200',
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
  Ramp: Sprout, Removal: Crosshair, 'Board Wipes': Bomb, 'Card Advantage': BookOpen, Protection: Shield,
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
  const { brewNode, applyBrewOption, backToBrewFork, rerollBrew, customization, pinBrewCard, brewState, brewContext } = useStore();
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Headliner: multi-select. The set of option ids the player has toggled on, plus a commit flag
  // that fires the fly-to-deck animation once they lock in their picks.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [committing, setCommitting] = useState(false);
  // Hovering a (small) card pops a full, readable preview anchored beside it.
  const [hover, setHover] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  // A pack that secretly held a gold card flashes its windfall here before the pick commits.
  const [reveal, setReveal] = useState<BrewCandidate | null>(null);
  // Hovering a "Finishes a combo" badge pops a tiny preview: the owned piece(s) + this card → payoff.
  const [comboHover, setComboHover] = useState<{ finisher: BrewCandidate; have: ComboPiece[]; payoff: string; rect: DOMRect } | null>(null);
  // Map a combo-finisher card name → the near-miss combo it completes (owned pieces resolved to art),
  // so the badge can show what it goes off with. Memoized on the session so it's computed once.
  const finisherCombos = useMemo(() => {
    const map = new Map<string, { have: ComboPiece[]; payoff: string }>();
    if (!brewContext || !brewState) return map;
    const owned = new Map<string, ScryfallCard>();
    owned.set(brewContext.commander.name, brewContext.commander);
    if (brewContext.partnerCommander) owned.set(brewContext.partnerCommander.name, brewContext.partnerCommander);
    for (const p of brewState.picks) owned.set(p.name, p.card);
    for (const nm of detectNearMissCombos(brewContext, brewState)) {
      if (nm.missing.length !== 1 || map.has(nm.missing[0])) continue;
      const have = nm.have
        .map(n => { const scryfall = owned.get(n); return scryfall ? { name: n, scryfall } : null; })
        .filter((p): p is ComboPiece => !!p)
        .slice(0, 2);
      map.set(nm.missing[0], { have, payoff: nm.results[0] ?? 'Combo' });
    }
    return map;
  }, [brewContext, brewState]);
  // Clear any headliner selection when the offered cards change (reroll, back, next node).
  const shownKey = brewNode ? `${brewNode.routeId}|${brewNode.options.flatMap(o => o.cards.map(c => c.name)).join(',')}` : '';
  useEffect(() => { setSelectedIds(new Set()); setCommitting(false); }, [shownKey]);
  if (!brewNode) return null;

  const hoverPreview = (card: ScryfallCard) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => setHover({ card, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => setHover(null),
  });

  const op = operationTheme(brewNode.type, routeKey(brewNode.routeId));

  // The Headliner draft lets you take any number of the four standouts at once (no pinning); every
  // other draft (Hidden Synergy) stays a single-card pick.
  const isHeadliner = brewNode.type === 'draft' && routeKey(brewNode.routeId) === 'elite';
  const exiting = chosenId !== null || committing;
  // A card is on its way to the deck if it's the chosen single pick, or — for the headliner — one of
  // the selected cards now committing. Everything else melts away.
  const goingToDeck = (id: string) => id === chosenId || (committing && selectedIds.has(id));
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
    if (option.goldCard) {
      // The lucky case: after the pack flies out, reveal the secret gold card, let it land, then commit.
      const gold = option.goldCard;
      window.setTimeout(() => setReveal(gold), 520);
      window.setTimeout(() => applyBrewOption(option, passed), 2200);
    } else {
      window.setTimeout(() => applyBrewOption(option, passed), 380); // …then commit the pick
    }
  }

  // Headliner: clicking a card toggles it in/out of your selection (no immediate commit).
  function toggleSelect(id: string) {
    if (exiting) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Headliner: lock in every selected card as one pick (the rest are passed and gone).
  function commitSelection() {
    if (exiting || selectedIds.size === 0 || !brewNode) return;
    const chosen = brewNode.options.filter(o => selectedIds.has(o.id));
    const combined: BrewOption = {
      id: chosen.length === 1 ? chosen[0].id : 'draft:multi',
      cards: chosen.flatMap(o => o.cards),
      reasons: chosen.flatMap(o => o.reasons),
    };
    const taken = new Set(combined.cards.map(c => c.name));
    const passed = allShown.filter(n => !taken.has(n));
    setHover(null);
    setCommitting(true);                           // play the fly-to-deck / melt-away animation…
    window.setTimeout(() => applyBrewOption(combined, passed), 380); // …then commit all of them
  }

  return (
    <div className="text-center" style={{ ['--op' as string]: `hsl(${op.color})`, ['--op-soft' as string]: `hsl(${op.color} / 0.5)` }}>
      <h2 className="font-display text-2xl font-semibold tracking-tight mb-1" style={{ textShadow: `0 2px 22px hsl(${op.color} / 0.35)` }}>
        {brewNode.prompt}
      </h2>
      <p className="text-xs text-muted-foreground mb-7 mx-auto max-w-md">
        {brewNode.type === 'bundle' ? 'Every card in the pack you pick joins your deck and steers which packs come next.'
          : isHeadliner ? 'Pick any number of these standouts. The rest are gone.'
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
          className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-7 items-stretch"
          style={{ perspective: '1200px' }}
        >
          {brewNode.options.map((option, idx) => {
            const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
            // Each theme pack wears its OWN colour (themeColor by slug), so a row of three theme packs
            // reads as three distinct directions, not three identical green crates. Need/discovery/value
            // packs keep their flavor colour.
            const packColor = option.flavor === 'theme' ? themeColor(routeKey(option.id) ?? '') : fl.color;
            // Spotlight the single card with the strongest synergy to your build (if any clears the bar),
            // so a "really good" pick is obvious at a glance — the rest of the pack stays calm.
            const fits = option.cards.map((c, i) => synergyFit(c, option.reasons[i] ?? []));
            const topFit = fits.length ? Math.max(...fits) : 0;
            const bestFitIdx = topFit >= FIT_THRESHOLD ? fits.indexOf(topFit) : -1;
            return (
              <button
                key={option.id}
                onClick={() => choose(option)}
                disabled={exiting}
                style={{
                  ['--pk' as string]: `hsl(${packColor})`,
                  ['--pk-soft' as string]: `hsl(${packColor} / 0.4)`,
                  // A brightened shade used only for colored TEXT, so labels read clearly on the dark
                  // card regardless of the theme's hue (the structural --pk stays the subtler base).
                  ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
                  // A faint flavor wash over the card base so each pack reads in its own colour.
                  background: `linear-gradient(hsl(${packColor} / 0.08), hsl(${packColor} / 0.03)), hsl(var(--card) / 0.4)`,
                  ...(exiting ? {} : { animationDelay: `${idx * 70}ms` }),
                }}
                className={`group relative z-10 flex flex-col overflow-hidden rounded-2xl border border-[color:var(--pk)]/35 bg-card/40 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[box-shadow,border-color] duration-200 hover:border-[color:var(--pk)] hover:shadow-[0_18px_44px_-10px_var(--pk-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
                  exiting ? (option.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss') : 'animate-brew-card-in'
                }`}
              >
                {/* Header — the pack's direction, in its own colour. The icon + colour signal the
                    flavor; we drop the old "On theme / Fills a need" word-tag, which read as noise. */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--pk)]/25" style={{ background: `hsl(${packColor} / 0.14)` }}>
                  <fl.Icon className="w-4 h-4 shrink-0 text-[color:var(--pk-text)]" />
                  <span className="font-display text-sm font-semibold truncate text-left text-[color:var(--pk-text)]">{option.label}</span>
                </div>
                {/* The cards inside the pack, stacked 2-over-1 so each is big enough to read. */}
                <div className="grid grid-cols-2 gap-2 px-2.5 pt-4 pb-2 justify-items-center">
                  {option.cards.map((c, i) => {
                    const rs = option.reasons[i] ?? [];
                    const finishesCombo = rs.some(r => r.kind === 'combo');
                    const isGameChanger = rs.some(r => r.kind === 'gameChanger');
                    const isComboPiece = rs.some(r => r.kind === 'comboPiece');
                    const isBestFit = i === bestFitIdx;
                    // The hallmark: the card that DEFINES this theme (its top signature). Marked so the
                    // pack's name is anchored to a real payoff. Takes the top-center slot over best-fit.
                    const isHallmark = !!option.hallmarkName && c.name === option.hallmarkName;
                    // A concise "why it's the standout" label for the best-fit badge.
                    const fitLabel = (c.connectionCount ?? 0) >= 2 ? `${c.connectionCount} synergies`
                      : finishesCombo ? 'Combo'
                      : isGameChanger ? 'Game Changer'
                      : 'Best fit';
                    // A lone final card (odd count) spans both columns and centers on the bottom row.
                    const cardLastOdd = option.cards.length % 2 === 1 && i === option.cards.length - 1;
                    return (
                      <div key={c.name} className={`relative min-w-0 flex flex-col items-center ${cardLastOdd ? 'col-span-2 w-[calc(50%-0.25rem)]' : 'w-full'}`}>
                        <RoleBadges cardName={c.name} size="sm" corner="bl" />
                        {/* The theme hallmark — the card the pack is named for. Wears the pack's own
                            colour + a star, so "Drain the Table" visibly points at its drain payoff. */}
                        {isHallmark && (
                          <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-0.5 rounded-full border border-[color:var(--pk-text)] bg-[#15131f]/95 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[color:var(--pk-text)] shadow-[0_0_14px_-2px_var(--pk-soft)]">
                            <Star className="w-2.5 h-2.5" /> Signature
                          </span>
                        )}
                        {/* The synergy standout — obvious at a glance: a violet glow + a "why" badge. */}
                        {isBestFit && !isHallmark && (
                          <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-0.5 rounded-full border border-violet-300/80 bg-[#1e1633]/90 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-100 shadow-[0_0_14px_-2px_rgba(167,139,250,0.7)]">
                            <Sparkles className="w-2.5 h-2.5" /> {fitLabel}
                          </span>
                        )}
                        {c.discoverySource === 'lift' && !isBestFit && !isHallmark && (
                          <span className="absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-0.5 rounded-full border border-fuchsia-300/70 bg-[#2a0a2e]/90 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fuchsia-100 shadow-[0_0_12px_-2px_rgba(232,121,249,0.6)]">
                            <Zap className="w-2.5 h-2.5" /> Lift
                          </span>
                        )}
                        {(finishesCombo || isGameChanger || isComboPiece) && (
                          <span className="absolute bottom-1 right-1 z-20 flex flex-col gap-1">
                            {finishesCombo && (() => {
                              const info = finisherCombos.get(c.name);
                              return (
                                <span
                                  title="Finishes a combo"
                                  onMouseEnter={info ? (e) => setComboHover({ finisher: c, have: info.have, payoff: info.payoff, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                                  onMouseLeave={info ? () => setComboHover(null) : undefined}
                                  className="grid place-items-center w-4 h-4 rounded-full bg-teal-500/90 text-white shadow ring-1 ring-black/40 cursor-help"
                                >
                                  <InfinityIcon className="w-2.5 h-2.5" />
                                </span>
                              );
                            })()}
                            {isComboPiece && <span title="Combo piece — recurs across this commander's combos" className="grid place-items-center w-4 h-4 rounded-full bg-teal-500/30 text-teal-100 shadow ring-1 ring-teal-300/50"><Link2 className="w-2.5 h-2.5" /></span>}
                            {isGameChanger && <span title="Game Changer" className="grid place-items-center w-4 h-4 rounded-full bg-amber-400/90 text-black shadow ring-1 ring-black/40"><Crown className="w-2.5 h-2.5" /></span>}
                          </span>
                        )}
                        <img
                          src={getCardImageUrl(c.scryfall, 'small')}
                          alt={c.name}
                          loading="lazy"
                          {...hoverPreview(c.scryfall)}
                          className={`block w-full h-auto rounded-[4.8%] transition-[box-shadow,outline-color] duration-150 ease-out outline outline-2 outline-transparent hover:outline-[color:var(--pk)] hover:shadow-[0_0_20px_-2px_var(--pk-soft),0_4px_14px_rgba(0,0,0,0.5)] ${isHallmark ? 'ring-2 ring-[color:var(--pk)] shadow-[0_0_22px_-2px_var(--pk-soft),0_4px_14px_rgba(0,0,0,0.5)]' : isBestFit ? 'ring-2 ring-violet-300/80 shadow-[0_0_22px_-2px_rgba(167,139,250,0.6),0_4px_14px_rgba(0,0,0,0.5)]' : 'ring-1 ring-black/60 shadow-[0_4px_14px_rgba(0,0,0,0.5)]'}`}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Footer — you're taking the whole pack, not one card. */}
                <div className="mt-auto flex items-center justify-center gap-1 px-3 pb-2.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--pk-text)]">
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
        {brewNode.options.map((option, idx) => {
          const isSelected = isHeadliner && selectedIds.has(option.id);
          return (
          <button
            key={option.id}
            onClick={() => (isHeadliner ? toggleSelect(option.id) : choose(option))}
            disabled={exiting}
            aria-pressed={isHeadliner ? isSelected : undefined}
            style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
            className={`group relative z-10 flex flex-col items-center gap-2 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--op)] ${
              isCombo
                ? 'px-4 pt-3 pb-4 border border-border/50 bg-card/40 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-colors duration-200 hover:border-[color:var(--op)] hover:bg-card/60'
                : 'p-1'
            } ${
              isSelected ? 'ring-2 ring-[color:var(--op)] ring-offset-2 ring-offset-background' : ''
            } ${
              exiting
                ? (goingToDeck(option.id) ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
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
                  {/* Opt-in combo details: the label shows the short payoff; this reveals the full
                      results, popularity, and (lazy-fetched) prerequisites + steps — "if we want it".
                      stopPropagation so opening details never commits the combo pick. */}
                  {isCombo && option.comboId && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 hover:text-violet-200 transition-colors cursor-pointer"
                        >
                          <Info className="w-3 h-3" /> Details
                        </span>
                      </PopoverTrigger>
                      <PopoverContent align="center" className="p-0">
                        <BrewComboDetails comboId={option.comboId} results={option.comboResults ?? []} deckCount={option.comboDeckCount} />
                      </PopoverContent>
                    </Popover>
                  )}
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
                    {/* Headliner: a selection check that reflects whether this standout is in your pick.
                        The whole card toggles it, so this badge is purely a visual read-out. */}
                    {isHeadliner && (
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute -top-2 right-1 z-20 grid place-items-center w-6 h-6 rounded-full border backdrop-blur-sm transition-colors ${
                          isSelected
                            ? 'border-[color:var(--op)] bg-[color:var(--op)] text-background'
                            : 'border-border/60 bg-black/55 text-muted-foreground group-hover:border-[color:var(--op)]/60'
                        }`}
                      >
                        {isSelected ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3 h-3" />}
                      </span>
                    )}
                    {/* Pin-for-later (other drafts): keep a card you're not taking now; it resurfaces later. */}
                    {brewNode.type === 'draft' && !isHeadliner && (() => {
                      const isPinned = (brewState?.pinnedNames ?? []).includes(c.name);
                      return (
                        <span
                          role="button"
                          tabIndex={0}
                          title={isPinned ? 'Pinned for later' : 'Pin for later'}
                          onClick={(e) => { e.stopPropagation(); pinBrewCard(c.name); }}
                          className={`absolute -top-2 right-1 z-20 grid place-items-center w-6 h-6 rounded-full border backdrop-blur-sm transition-colors ${
                            isPinned
                              ? 'border-violet-300/80 bg-violet-500/30 text-violet-100'
                              : 'border-border/60 bg-black/55 text-muted-foreground hover:text-violet-200 hover:border-violet-400/50'
                          }`}
                        >
                          <Pin className="w-3 h-3" fill={isPinned ? 'currentColor' : 'none'} />
                        </span>
                      );
                    })()}
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
                          const LeadIcon = r.kind === 'lift' ? Zap : r.kind === 'comboPiece' ? Link2 : r.kind === 'role' ? ROLE_ICON[r.label] : undefined;
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
          );
        })}
      </div>
      )}

      {/* Headliner: a single CTA to lock in everything you've selected (the rest are gone). */}
      {isHeadliner && brewNode.options.length > 0 && (
        <div className="mt-8 flex justify-center">
          <Button
            className="btn-shimmer"
            disabled={exiting || selectedIds.size === 0}
            onClick={commitSelection}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {selectedIds.size === 0
              ? 'Select at least one'
              : `Take ${selectedIds.size} ${selectedIds.size === 1 ? 'card' : 'cards'} — leave the rest`}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 mt-9 text-muted-foreground">
        <Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" disabled={exiting} onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1.5" /> Show different</Button>
        {brewNode.canPass && (<><span className="w-1 h-1 rotate-45 bg-border" /><Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}>Pass</Button></>)}
        {/* Always offer the bail-out from a pack too, not just the fork: build the deck now with a
            sensible mana base. Mirrors the fork's "Finish for me". */}
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" className="text-violet-300 hover:text-violet-200" disabled={exiting} onClick={onFinish}><Play className="w-4 h-4 mr-1.5" /> Finish for me</Button>
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

      {/* Tiny combo preview — hovering a "Finishes a combo" badge shows the owned piece(s) this card
          goes off with, plus the payoff, so you know WHAT it completes without opening the combo node. */}
      {comboHover && !exiting && (() => {
        const W = 232, GAP = 10, PAD = 8, EST_H = 132;
        const r = comboHover.rect;
        const vw = window.innerWidth, vh = window.innerHeight;
        const left = Math.min(Math.max(PAD, r.left + r.width / 2 - W / 2), vw - W - PAD);
        // Prefer above the badge; flip below if it would clip the top.
        const above = r.top - EST_H - GAP;
        const top = above >= PAD ? above : Math.min(r.bottom + GAP, vh - EST_H - PAD);
        return createPortal(
          <div className="fixed z-[125] pointer-events-none animate-fade-in" style={{ left, top, width: W }}>
            <div className="rounded-xl border border-teal-400/50 bg-[#07211d]/95 backdrop-blur-md p-2.5 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)]">
              <div className="mb-1.5 flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-teal-200">
                <InfinityIcon className="w-3 h-3" /> Finishes a combo
              </div>
              <div className="flex items-end justify-center gap-1.5">
                {comboHover.have.map(p => (
                  <div key={p.name} className="flex w-[46px] flex-col items-center opacity-75">
                    <img src={getCardImageUrl(p.scryfall, 'small')} alt={p.name} className="w-full rounded-[5%] grayscale-[0.3] ring-1 ring-black/60" />
                    <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/70">Have</span>
                  </div>
                ))}
                {comboHover.have.length > 0 && <span className="self-center pb-4 text-base font-light text-teal-300/70">+</span>}
                <div className="flex w-[46px] flex-col items-center">
                  <img src={getCardImageUrl(comboHover.finisher.scryfall, 'small')} alt={comboHover.finisher.name} className="w-full rounded-[5%] ring-1 ring-teal-300/70 shadow-[0_0_12px_-2px_rgba(45,212,191,0.6)]" />
                  <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-teal-200">Add</span>
                </div>
              </div>
              <div className="mt-1.5 text-center text-[11px] font-medium leading-tight text-teal-50">{comboHover.payoff}</div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {/* The secret gold card: a rare windfall hidden in a theme pack. Revealed full-screen after the
          pack flies to the deck — a golden-bordered hero card the player wasn't promised. */}
      {reveal && createPortal(
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/75 backdrop-blur-sm animate-fade-in" aria-live="polite">
          {/* Warm radial glow behind the card so it reads as treasure, not just another pick. */}
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] blur-3xl"
            style={{ background: 'radial-gradient(circle, hsl(45 90% 55% / 0.35), transparent 65%)' }} />
          <div className="relative z-10 flex flex-col items-center gap-3 animate-brew-card-in">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-[#241803]/85 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-200 shadow-[0_0_18px_-2px_rgba(251,191,36,0.55)]">
              <Crown className="w-3.5 h-3.5" /> Hidden gem
            </span>
            <img
              src={getCardImageUrl(reveal.scryfall, 'normal') ?? ''}
              alt={reveal.name}
              className="w-[260px] rounded-[4.8%] shadow-[0_0_60px_-6px_rgba(251,191,36,0.7),0_18px_50px_rgba(0,0,0,0.7)]"
              style={{ outline: '3px solid hsl(45 90% 60%)', outlineOffset: '-1px' }}
            />
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-display text-lg font-semibold text-amber-100" style={{ textShadow: '0 2px 18px rgba(251,191,36,0.5)' }}>{reveal.name}</span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-200/80"><Sparkles className="w-3 h-3" /> Added to your deck, on the house</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
