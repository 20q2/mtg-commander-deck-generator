import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { BrewPackCrack } from '@/components/brew/BrewPackCrack';
import { BrewSpecialPack } from '@/components/brew/BrewSpecialPack';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Flame, Sprout, Crosshair, Bomb, BookOpen, Shield, Zap, Sparkles, Crown, Plus, Pin, Info, Check, Link2, Play, Dices, type LucideIcon } from 'lucide-react';
import { getCardImageUrl, getCardPrice } from '@/services/scryfall/client';
import { operationTheme, routeKey, PACK_FLAVOR } from '@/components/brew/brewVisuals';
import { RoleBadges } from '@/components/brew/RoleBadges';
import { BrewComboDetails } from '@/components/brew/BrewComboDetails';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { BrewOption, BrewCandidate } from '@/services/brew/engine';
import type { ScryfallCard } from '@/types';

// How long the Hidden Gem's fly-to-deck exit plays before the pick commits and the screen changes.
// Matches the brew-to-deck keyframe so the card finishes its flight just as the next screen mounts.
const REVEAL_EXIT_MS = 420;

// Each reason kind gets its own quiet colour so the badge row reads at a glance.
// combo is the headline call-out and reads brighter/bolder than the rest. Game Changers don't get
// a chip at all — they wear the small corner crown instead.
const REASON_CHIP: Record<string, string> = {
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


export function BrewNode({ onFinish }: { onFinish: () => void }) {
  const { brewNode, applyBrewOption, backToBrewFork, rerollBrew, customization, pinBrewCard, brewState } = useStore();
  const [chosenId, setChosenId] = useState<string | null>(null);
  // Headliner: multi-select. The set of option ids the player has toggled on, plus a commit flag
  // that fires the fly-to-deck animation once they lock in their picks.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [committing, setCommitting] = useState(false);
  // A pack has been cracked this round: the crack is the commitment, so Back/reroll disappear
  // (otherwise you could peek inside one pack, back out, and crack a different one).
  const [packCracked, setPackCracked] = useState(false);
  // Hovering a (small) card pops a full, readable preview anchored beside it.
  const [hover, setHover] = useState<{ card: ScryfallCard; rect: DOMRect } | null>(null);
  // A pack that secretly held a windfall reveals it here before the pick commits: a face-down card
  // slides from the crate, shimmers, then flips to the real card (gold, or the rarer rainbow).
  const [reveal, setReveal] = useState<{ card: BrewCandidate; tier: 'gold' | 'rainbow'; wager?: BrewCandidate[]; traded?: boolean } | null>(null);
  const [flipped, setFlipped] = useState(false);
  // The gem plays a fly-to-deck exit before the pick commits and the screen transitions.
  const [revealExiting, setRevealExiting] = useState(false);
  // Pending windfall commit + its timers, so a tap can flip early / skip the hold and commit now.
  const revealTimers = useRef<number[]>([]);
  const pendingCommit = useRef<null | (() => void)>(null);
  // The double-or-nothing trade, armed in choose() when this reveal carries wager stakes.
  const pendingTrade = useRef<null | (() => void)>(null);
  const revealExitingRef = useRef(false); // synchronous guard so auto-commit + a tap can't double-fire
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Clear any headliner selection when the offered cards change (reroll, back, next node).
  const shownKey = brewNode ? `${brewNode.routeId}|${brewNode.options.flatMap(o => o.cards.map(c => c.name)).join(',')}` : '';
  useEffect(() => { setSelectedIds(new Set()); setCommitting(false); setPackCracked(false); setReveal(null); setFlipped(false); setRevealExiting(false); revealExitingRef.current = false; pendingTrade.current = null; }, [shownKey]);
  // Cancel any pending windfall timers if the screen unmounts mid-reveal.
  useEffect(() => () => { revealTimers.current.forEach(t => window.clearTimeout(t)); }, []);
  if (!brewNode) return null;

  const clearRevealTimers = () => { revealTimers.current.forEach(t => window.clearTimeout(t)); revealTimers.current = []; };
  // Play the gem's fly-to-deck exit, then commit the pick (which transitions to the next screen).
  // Guarded by a ref so the auto-commit timer and a manual tap can't both trigger it.
  function finishReveal() {
    if (revealExitingRef.current) return;
    revealExitingRef.current = true;
    clearRevealTimers();
    setRevealExiting(true);
    const run = pendingCommit.current;
    pendingCommit.current = null;
    revealTimers.current.push(window.setTimeout(() => run?.(), reduceMotion ? 0 : REVEAL_EXIT_MS));
  }
  // A tap on the windfall overlay: first flips the card early, then (once flipped) begins the exit.
  function advanceReveal() {
    if (!flipped) { setFlipped(true); return; }
    finishReveal();
  }

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

  // Special routes (Combos / Headliner / Hidden Synergy) arrive as ONE sealed, route-flavored
  // booster: contents hidden until the crack, choices erupting from the open pack. The sealed face
  // wears the route's color + card count and ABSTRACT generated art — no featured card, nothing
  // teased (BrewSpecialPack paints the motif from the route key).
  const specialFace: BrewOption = {
    id: brewNode.routeId,
    label: op.label,
    cards: brewNode.options.flatMap(o => o.cards),
    reasons: [],
    flavor: isCombo ? 'combo' : routeKey(brewNode.routeId) === 'synergy' ? 'discovery' : undefined,
  };

  function choose(option: BrewOption) {
    if (exiting) return;                          // ignore clicks once a card is on its way out
    const taken = new Set(option.cards.map(c => c.name));
    const passed = allShown.filter(n => !taken.has(n));
    setChosenId(option.id);                        // play the fly-to-deck / melt-away animation…
    setHover(null);
    if (option.goldCard) {
      // The lucky case: after the pack flies out, a face-down windfall slides from the crate,
      // shimmers, flips to the real card, holds, then commits. Tap to flip early / skip the hold.
      const gold = option.goldCard;
      const tier = option.windfallTier ?? 'gold';
      // Double-or-nothing stakes ride on some gold reveals (once per run): keeping is the default
      // (a tap anywhere keeps); trading re-aims the commit at the two face-down signatures.
      const wager = tier === 'gold' ? option.wagerTrade : undefined;
      revealExitingRef.current = false;
      pendingCommit.current = () => applyBrewOption(option, passed, wager ? 'kept' : undefined);
      pendingTrade.current = wager
        ? () => {
            if (revealExitingRef.current) return;
            clearRevealTimers();
            pendingCommit.current = () => applyBrewOption(option, passed, 'traded');
            setReveal(r => (r ? { ...r, traded: true } : r));
            revealTimers.current.push(window.setTimeout(() => finishReveal(), reduceMotion ? 1600 : 2600));
          }
        : null;
      const push = (fn: () => void, ms: number) => revealTimers.current.push(window.setTimeout(fn, ms));
      if (reduceMotion) {
        // No ramp: show the card already flipped, hold briefly so it registers, then exit + commit.
        push(() => { setReveal({ card: gold, tier, wager }); setFlipped(true); }, 360);
        if (!wager) push(() => finishReveal(), 1700);   // a wager holds for the player's call
      } else {
        // Slide out (520) → shimmer builds → flip at 1500 (720ms flip lands ~2220) → hold, then the
        // gem flies to the deck (finishReveal) before committing and transitioning to the next screen.
        const hold = tier === 'rainbow' ? 3600 : 2950;
        push(() => setReveal({ card: gold, tier, wager }), 520);
        push(() => setFlipped(true), 1500);
        if (!wager) push(() => finishReveal(), hold);   // a wager holds for the player's call
      }
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
        {isHeadliner ? 'Pick any number of these standouts. The rest are gone.'
          : brewNode.type === 'draft' ? 'Take one card. The rest are gone.'
          : brewNode.type === 'combo' ? 'Pick a combo to finish, or pass.'
          : ''}
      </p>

      {brewNode.options.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10">
          No cards left for this route.{' '}
          <button className="text-violet-300 underline" onClick={onFinish}>Finish the deck</button> or go back.
        </div>
      ) : isPack ? (
        /* ── Crack-a-pack: three sealed themed packs — crack one, keep what you like (min 1),
              pass the rest. The sealed→fan flow lives in BrewPackCrack. ── */
        <>
        {/* God pack: a rare round where every sealed pack hides a windfall — any crack pays out. */}
        {brewNode.godPack && (
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-[#241803]/85 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-200 shadow-[0_0_24px_-4px_rgba(251,191,36,0.6)] animate-brew-view-in">
            <Crown className="w-4 h-4" /> God pack — treasure guaranteed this round
          </div>
        )}
        <BrewPackCrack key={`${brewNode.routeId}|${allShown.join(',')}`} onCracked={setPackCracked} />
        </>
      ) : (
      /* ── Special routes: one sealed route-pack cracks open into the single-card / combo layout.
            Keyed on open AND reroll so the seal + deal-in replay together. ── */
      <BrewSpecialPack
        key={`${brewNode.routeId}|${allShown.join(',')}`}
        face={specialFace}
        packColor={op.color}
        onCracked={() => setPackCracked(true)}
      >
      <div
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
                // Game Changers get the small corner crown on the card instead of a loud chip.
                const reasons = (option.reasons[i] ?? []).filter(r => r.kind !== 'theme' && r.kind !== 'gameChanger');
                const isGameChanger = (option.reasons[i] ?? []).some(r => r.kind === 'gameChanger');
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
                    {/* Wrapped so the corner crown rides the card through the hover lift. */}
                    <div className="relative w-full transition-transform duration-150 ease-out group-hover:-translate-y-2.5 group-hover:scale-[1.07]">
                      <img
                        src={getCardImageUrl(c.scryfall, imgSize)}
                        alt={c.name}
                        loading="lazy"
                        {...hoverPreview(c.scryfall)}
                        className="block w-full h-auto rounded-[4.8%] shadow-[0_6px_18px_rgba(0,0,0,0.55)] ring-1 ring-black/60 group-hover:shadow-[0_18px_44px_var(--op-soft)] group-hover:ring-[color:var(--op)]"
                      />
                      {isGameChanger && (
                        <span title="Game Changer" className="absolute bottom-1 right-1 z-20 grid place-items-center w-4 h-4 rounded-full bg-amber-400/90 text-black shadow ring-1 ring-black/40">
                          <Crown className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
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

      {/* Headliner: a single CTA to lock in everything you've selected (the rest are gone). */}
      {isHeadliner && (
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
      </BrewSpecialPack>
      )}

      <div className="flex items-center justify-center gap-2 mt-9 text-muted-foreground">
        {/* Once a pack is cracked, the crack IS the commitment — no backing out to peek elsewhere. */}
        {!packCracked && (<>
        <Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <span className="w-1 h-1 rotate-45 bg-border" />
        <Button variant="ghost" size="sm" disabled={exiting} onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1.5" /> Show different</Button>
        </>)}
        {brewNode.canPass && (<><span className="w-1 h-1 rotate-45 bg-border" /><Button variant="ghost" size="sm" disabled={exiting} onClick={backToBrewFork}>Pass</Button></>)}
        {/* Always offer the bail-out from a pack too, not just the fork: build the deck now with a
            sensible mana base. Mirrors the fork's "Finish for me". */}
        {!packCracked && <span className="w-1 h-1 rotate-45 bg-border" />}
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


      {/* The secret windfall hidden in a theme pack. After the pack flies to the deck, a face-down
          card slides out of the crate, shimmers, then flips to the real card — gold (common) or the
          rarer prismatic rainbow. Tap to flip early / skip the hold. */}
      {reveal && createPortal((() => {
        const isRainbow = reveal.tier === 'rainbow';
        // Rainbow reads as spectrum-cyan; gold reads warm-amber. Everything downstream keys off this.
        const glow = isRainbow ? 'hsl(190 90% 60% / 0.4)' : 'hsl(45 90% 55% / 0.35)';
        const ring = isRainbow ? 'hsl(280 85% 72%)' : 'hsl(45 90% 60%)';
        const cardShadow = isRainbow
          ? '0 0 62px -6px rgba(129,140,248,0.75),0 18px 50px rgba(0,0,0,0.72)'
          : '0 0 60px -6px rgba(251,191,36,0.7),0 18px 50px rgba(0,0,0,0.7)';
        return (
          <div
            className={`fixed inset-0 z-[130] grid place-items-center bg-black/75 backdrop-blur-sm animate-fade-in ${revealExiting ? 'pointer-events-none opacity-0 transition-opacity duration-300' : 'cursor-pointer'}`}
            aria-live="polite"
            onClick={advanceReveal}
            title={flipped ? 'Continue' : 'Reveal'}
          >
            {/* A wash of light behind the card so it reads as treasure, not just another pick. */}
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] h-[540px] blur-3xl"
              style={{ background: `radial-gradient(circle, ${glow}, transparent 65%)` }} />
            {/* On exit the gem flies up toward the deck (matching a normal pick) before the transition. */}
            <div className={`relative z-10 flex flex-col items-center gap-3 ${revealExiting ? 'animate-brew-to-deck' : 'animate-brew-reveal-in'}`}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] shadow-[0_0_18px_-2px_rgba(0,0,0,0.5)]"
                style={isRainbow
                  ? { borderColor: 'hsl(280 85% 78% / 0.75)', background: '#160a2a', color: 'hsl(280 90% 86%)' }
                  : { borderColor: 'hsl(45 90% 66% / 0.75)', background: '#241803', color: 'hsl(45 90% 80%)' }}
              >
                {isRainbow ? <Sparkles className="w-3.5 h-3.5" /> : <Crown className="w-3.5 h-3.5" />}
                {isRainbow ? 'Rainbow rare' : 'Hidden gem'}
              </span>
              {/* The trade resolved: the two won signatures land face-up — the wager's payoff beat. */}
              {reveal.traded && reveal.wager ? (
                <div className="flex items-center gap-3">
                  {reveal.wager.map(c => (
                    <img
                      key={c.name}
                      src={getCardImageUrl(c.scryfall, 'normal') ?? ''}
                      alt={c.name}
                      className="w-[176px] rounded-[4.8%] animate-brew-reveal-in"
                      style={{ outline: `3px solid ${ring}`, outlineOffset: '-1px', boxShadow: cardShadow }}
                    />
                  ))}
                </div>
              ) : (
              /* The flip scene: card-back (face-up until the flip) over the real card (pre-rotated). */
              <div style={{ perspective: '1400px', width: 260, height: 363 }}>
                <div className={`brew-flip relative w-full h-full ${flipped ? 'is-flipped' : ''}`}>
                  {/* Face-down: a treasure-backed card that shimmers while anticipation builds. */}
                  <div
                    className={`brew-flip-face absolute inset-0 grid place-items-center rounded-[4.8%] brew-shimmer ${isRainbow ? 'brew-shimmer-rainbow' : ''}`}
                    style={{
                      background: isRainbow
                        ? 'radial-gradient(circle at 50% 38%, #2a1350, #150a2c 70%, #0b0620)'
                        : 'radial-gradient(circle at 50% 38%, #4a3208, #241803 70%, #140d02)',
                      outline: `3px solid ${ring}`, outlineOffset: '-1px',
                      boxShadow: cardShadow,
                    }}
                  >
                    {isRainbow
                      ? <Sparkles className="w-14 h-14" style={{ color: 'hsl(280 90% 82%)', filter: 'drop-shadow(0 0 14px rgba(196,181,253,0.8))' }} />
                      : <Crown className="w-14 h-14" style={{ color: 'hsl(45 92% 70%)', filter: 'drop-shadow(0 0 14px rgba(251,191,36,0.8))' }} />}
                  </div>
                  {/* The real card. */}
                  <img
                    src={getCardImageUrl(reveal.card.scryfall, 'normal') ?? ''}
                    alt={reveal.card.name}
                    className="brew-flip-face brew-flip-back absolute inset-0 w-full h-full object-cover rounded-[4.8%]"
                    style={{ outline: `3px solid ${ring}`, outlineOffset: '-1px', boxShadow: cardShadow }}
                  />
                </div>
              </div>
              )}
              {reveal.traded && reveal.wager ? (
                <div className="flex flex-col items-center gap-0.5 animate-fade-in">
                  <span className="font-display text-lg font-semibold" style={{ color: 'hsl(45 90% 82%)', textShadow: '0 2px 18px rgba(0,0,0,0.6)' }}>
                    {reveal.wager.map(c => c.name).join(' + ')}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'hsl(45 70% 78%)' }}>
                    <Dices className="w-3 h-3" /> Double or nothing — both added to your deck
                  </span>
                </div>
              ) : reveal.wager ? (
                /* The wager: keeping is the default (a tap anywhere keeps); the trade is explicit. */
                <div className="flex flex-col items-center gap-2" style={{ opacity: flipped ? 1 : 0, transition: 'opacity 300ms' }}>
                  <span className="font-display text-lg font-semibold" style={{ color: 'hsl(45 90% 82%)', textShadow: '0 2px 18px rgba(0,0,0,0.6)' }}>{reveal.card.name}</span>
                  <span className="text-xs" style={{ color: 'hsl(45 70% 78%)' }}>
                    Keep it — or trade it, sight unseen, for TWO of this theme's signatures?
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <Button size="sm" className="btn-shimmer" onClick={(e) => { e.stopPropagation(); finishReveal(); }}>
                      Keep it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-400/60 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                      onClick={(e) => { e.stopPropagation(); pendingTrade.current?.(); }}
                    >
                      <Dices className="w-3.5 h-3.5 mr-1" /> Double or nothing
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-0.5" style={{ opacity: flipped ? 1 : 0, transition: 'opacity 300ms' }}>
                  <span className="font-display text-lg font-semibold" style={{ color: isRainbow ? 'hsl(280 90% 88%)' : 'hsl(45 90% 82%)', textShadow: '0 2px 18px rgba(0,0,0,0.6)' }}>{reveal.card.name}</span>
                  <span className="inline-flex items-center gap-1 text-xs" style={{ color: isRainbow ? 'hsl(280 60% 82%)' : 'hsl(45 70% 78%)' }}>
                    <Sparkles className="w-3 h-3" /> Added to your deck, on the house
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })(), document.body)}
    </div>
  );
}
