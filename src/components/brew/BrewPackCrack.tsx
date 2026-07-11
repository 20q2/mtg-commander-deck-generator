import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getCardImageUrl } from '@/services/scryfall/client';
import { playPackCrack } from '@/services/brew/brewSound';
import type { BrewOption, BrewCandidate } from '@/services/brew/engine';
import { PACK_FLAVOR, themeColor, legibleText, routeKey } from '@/components/brew/brewVisuals';
import { Check, Crown, Sparkles, Package, MoveRight } from 'lucide-react';

/**
 * The crack-a-pack loop (2026-07-11 redesign): a pack round offers three SEALED boosters — theme +
 * headline card showing, contents hidden. Picking one stages it center-screen, where you TEAR the
 * seam yourself (drag across it, Pocket's "trace to open"; a tap auto-tears). The strip rips off,
 * the wrapper drops away, and the fan of ~5 cards rises out of it — keep any you like (min 1).
 *
 * Physicality: sealed packs tilt in 3D toward the pointer with a foil glare hotspot tracking it
 * (the poke-holo technique: pointer position drives CSS custom properties; gradients + blend modes
 * do the rest). All effects are CSS/DOM — no canvas, no asset files.
 *
 * A windfall rides the fan as a FOIL — the gold/rainbow card is simply *in the pack* when you
 * crack it, replacing the old full-screen reveal ceremony for pack rounds.
 */

const COMMIT_MS = 380;    // matches the fly-to-deck / melt-away animations used across brew
const OFF_MS = 780;       // strip-off + wrapper-drop, then the fan rises

// --- Spring-driven tilt: the pack has mass. It lags the pointer, overshoots, and wobbles back
//     to rest instead of snapping — the difference between a sticker and an object. Springs run
//     per-element on rAF and write CSS vars directly; React never re-renders for motion. ---
const TILT_RANGE = 16;    // degrees of rotation at the pack's edges
const SPRING_K = 0.16;    // stiffness — how eagerly the pack chases the pointer
const SPRING_D = 0.78;    // damping — how quickly the wobble dies out

type Spring = { cur: number; vel: number; target: number };
type TiltState = { rx: Spring; ry: Spring; raf: number | null };
const tiltStates = new WeakMap<HTMLElement, TiltState>();

function tiltStep(el: HTMLElement, s: TiltState): void {
  let live = false;
  for (const sp of [s.rx, s.ry]) {
    sp.vel = sp.vel * SPRING_D + (sp.target - sp.cur) * SPRING_K;
    sp.cur += sp.vel;
    if (Math.abs(sp.vel) > 0.005 || Math.abs(sp.target - sp.cur) > 0.005) live = true;
  }
  el.style.setProperty('--rx', `${s.rx.cur.toFixed(3)}deg`);
  el.style.setProperty('--ry', `${s.ry.cur.toFixed(3)}deg`);
  s.raf = live ? requestAnimationFrame(() => tiltStep(el, s)) : null;
}
function setTiltTarget(el: HTMLElement, rx: number, ry: number): void {
  let s = tiltStates.get(el);
  if (!s) {
    s = { rx: { cur: 0, vel: 0, target: 0 }, ry: { cur: 0, vel: 0, target: 0 }, raf: null };
    tiltStates.set(el, s);
  }
  s.rx.target = rx;
  s.ry.target = ry;
  if (s.raf == null) s.raf = requestAnimationFrame(() => tiltStep(el, s!));
}

/** Pointer over the pack: glare follows instantly (light is massless); tilt springs after it. */
function trackTilt(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  el.style.setProperty('--mx', `${px * 100}%`);
  el.style.setProperty('--my', `${py * 100}%`);
  setTiltTarget(el, (py - 0.5) * -TILT_RANGE, (px - 0.5) * TILT_RANGE);
}
function resetTilt(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  el.style.setProperty('--mx', '50%');
  el.style.setProperty('--my', '50%');
  setTiltTarget(el, 0, 0);   // springs home with a wobble instead of snapping
}

/** The pack's physical depth: back slab + side edges, revealed as the front face tilts. */
function PackDepth() {
  return (
    <>
      <div aria-hidden="true" className="brew-pack-back absolute inset-0 rounded-lg" />
      <span aria-hidden="true" className="brew-pack-edge brew-pack-edge-l absolute inset-y-1 left-0 w-[10px]" />
      <span aria-hidden="true" className="brew-pack-edge brew-pack-edge-r absolute inset-y-1 right-0 w-[10px]" />
    </>
  );
}

/** The booster wrapper visuals, shared by the grid packs and the center-stage tear. */
function PackBody({ option, packColor, brand = true }: { option: BrewOption; packColor: string; brand?: boolean }) {
  const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
  const sigCard = option.cards.find(c => c.name === option.hallmarkName) ?? option.cards[0];
  const packArt = sigCard?.scryfall.image_uris?.art_crop ?? sigCard?.scryfall.card_faces?.[0]?.image_uris?.art_crop;
  const count = option.cards.length + (option.goldCard ? 1 : 0);
  return (
    <>
      {/* The wrapper body — foil in the pack's own hue, darker at the seams. */}
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.55), hsl(${packColor} / 0.28) 18%, hsl(${packColor} / 0.2) 82%, hsl(${packColor} / 0.6))` }} />
      {/* Pack art: the headline card's art, the wrapper's centerpiece. */}
      {packArt && (
        <div aria-hidden="true" className="absolute inset-x-0 top-[13%] bottom-[24%]"
          style={{
            backgroundImage: `url(${packArt})`, backgroundSize: 'cover', backgroundPosition: 'center 30%',
            boxShadow: 'inset 0 0 34px rgba(0,0,0,0.55)',
          }} />
      )}
      {/* Art fade into the wrapper above and below, so it reads as printed, not pasted. */}
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.5) 0%, transparent 20%, transparent 68%, hsl(${packColor} / 0.55) 84%)` }} />
      {/* The holo sheen — a slow glossy sweep + faint iridescence — and the pointer-tracked glare. */}
      <div aria-hidden="true" className="brew-pack-foil absolute inset-0" />
      <div aria-hidden="true" className="brew-pack-glare absolute inset-0 z-10" />
      {/* Bottom crimp (the top one is the tearable strip, rendered by the caller). */}
      <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 bottom-0 h-[18px]" />
      <div className="absolute inset-0 z-10 flex flex-col items-center">
        {brand && (
          <span className="mt-[26px] text-[8px] font-bold uppercase tracking-[0.34em] text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            ManaFoundry · Brew
          </span>
        )}
        <div className="flex-1" />
        {/* The set plate — theme name big, headline card beneath. */}
        <div className="mb-[30px] flex w-full flex-col items-center gap-1 px-3">
          {option.windfallTease && (
            <span className="font-flavor text-[11px] italic text-amber-200 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">something glints inside…</span>
          )}
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/25 bg-black/55 px-3 py-1 font-display text-sm font-bold uppercase tracking-wide text-[color:var(--pk-text)] shadow-[0_3px_12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
            <fl.Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{option.label}</span>
          </span>
          {option.hallmarkName && (
            <span className="max-w-full truncate text-[11px] text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              feat. <span className="font-semibold">{option.hallmarkName}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/65 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            <Package className="w-3 h-3" /> {count} cards
          </span>
        </div>
      </div>
    </>
  );
}

export function BrewPackCrack({ onCracked }: { onCracked?: (cracked: boolean) => void }) {
  const { brewNode, applyBrewOption } = useStore();
  // The pack staged center-screen for the tear — the pick is committed, the seam awaits.
  const [opening, setOpening] = useState<BrewOption | null>(null);
  // 'tear' = seam intact, drag across it; 'off' = strip ripped, wrapper dropping, fan incoming.
  const [stage, setStage] = useState<'tear' | 'off'>('tear');
  // Which pack was cracked (option id) — drives the fan phase.
  const [cracked, setCracked] = useState<string | null>(null);
  // Names the player is keeping from the fan (the foil pre-selects — it's the pull).
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const timers = useRef<number[]>([]);
  const tearEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; progress: number; active: boolean; done: boolean }>({ startX: 0, progress: 0, active: false, done: false });
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  if (!brewNode) return null;
  const options = brewNode.options;
  const crackedOption = cracked ? options.find(o => o.id === cracked) ?? null : null;

  function pick(option: BrewOption) {
    if (committing || cracked || opening) return;
    onCracked?.(true);   // the pick is the commitment — the parent hides Back/reroll
    // The foil starts selected — you pulled it; passing it back is the deliberate act.
    setKeep(option.goldCard ? new Set([option.goldCard.name]) : new Set());
    if (reduceMotion) { setCracked(option.id); return; }   // no ceremony — straight to the fan
    drag.current = { startX: 0, progress: 0, active: false, done: false };
    if (tearSpring.current.raf != null) cancelAnimationFrame(tearSpring.current.raf);
    tearSpring.current = { cur: 0, vel: 0, target: 0, raf: null };
    setStage('tear');
    setOpening(option);
  }

  /** The seam gave way: strip flies off, wrapper drops, then the fan rises out of it. */
  function completeTear(option: BrewOption) {
    if (drag.current.done) return;
    drag.current.done = true;
    playPackCrack();
    setStage('off');
    timers.current.push(window.setTimeout(() => {
      setCracked(option.id);
      setOpening(null);
    }, OFF_MS));
  }

  // The tear is a spring too: the rip lags your drag and the strip's curl follows the VELOCITY —
  // yank it and the foil peels harder. Written straight to CSS vars on rAF, no re-renders.
  const tearSpring = useRef<{ cur: number; vel: number; target: number; raf: number | null }>({ cur: 0, vel: 0, target: 0, raf: null });

  function ensureTearLoop(option: BrewOption) {
    const s = tearSpring.current;
    if (s.raf != null) return;
    const step = () => {
      const el = tearEl.current;
      if (!el || drag.current.done) { s.raf = null; return; }
      s.vel = s.vel * 0.72 + (s.target - s.cur) * 0.22;
      s.cur += s.vel;
      if (s.cur < 0) { s.cur = 0; s.vel = 0; }
      el.style.setProperty('--tear', s.cur.toFixed(4));
      const curl = Math.min(30, s.cur * 6 + Math.max(0, s.vel) * 300);
      el.style.setProperty('--strip-rot', `${(-curl).toFixed(2)}deg`);
      if (s.cur >= 0.99 && s.target >= 1) { s.raf = null; completeTear(option); return; }
      const settled = Math.abs(s.vel) < 0.0005 && Math.abs(s.target - s.cur) < 0.001;
      s.raf = settled ? null : requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }

  function onTearDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current.done) return;
    drag.current.active = true;
    drag.current.startX = e.clientX - tearSpring.current.target * (e.currentTarget.getBoundingClientRect().width * 0.8);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onTearMove(e: ReactPointerEvent<HTMLDivElement>, option: BrewOption) {
    if (!drag.current.active || drag.current.done) return;
    const w = e.currentTarget.getBoundingClientRect().width * 0.8;
    tearSpring.current.target = Math.min(1, Math.max(0, (e.clientX - drag.current.startX) / w));
    ensureTearLoop(option);
  }
  function onTearUp(option: BrewOption) {
    if (!drag.current.active || drag.current.done) return;
    drag.current.active = false;
    // A tap or a half-tear both finish the job — the ritual invites the gesture, never demands
    // it. Springing the target to 1 finishes the rip with the same physics as a real drag.
    tearSpring.current.target = 1;
    ensureTearLoop(option);
  }

  function toggleKeep(name: string) {
    if (committing) return;
    setKeep(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Lock in the kept cards as one decision. The synthetic option keeps the pack's identity
  // (id/label/flavor/engineScore → affinity, Rival, and pack-window bookkeeping all still work);
  // a kept foil stays on `goldCard` so the store's windfall moment + Treasury hook fire as before.
  function commitKeeps(option: BrewOption) {
    if (committing || keep.size === 0) return;
    setCommitting(true);
    const keptRegular = option.cards.filter(c => keep.has(c.name));
    const reasons = keptRegular.map(c => option.reasons[option.cards.findIndex(x => x.name === c.name)] ?? []);
    const foilKept = !!option.goldCard && keep.has(option.goldCard.name);
    const synthetic: BrewOption = {
      ...option,
      cards: keptRegular,
      reasons,
      goldCard: foilKept ? option.goldCard : undefined,
      windfallTier: foilKept ? option.windfallTier : undefined,
      windfallTease: undefined,
      wagerTrade: undefined,
    };
    const allNames = options.flatMap(o => [...o.cards.map(c => c.name), ...(o.goldCard ? [o.goldCard.name] : [])]);
    const passed = allNames.filter(n => !keep.has(n));
    window.setTimeout(() => applyBrewOption(synthetic, passed), COMMIT_MS);
  }

  // ── Phase 3: the fan — the cracked pack's cards rise out of the wrapper; keep what you like. ──
  if (crackedOption) {
    const fl = (crackedOption.flavor && PACK_FLAVOR[crackedOption.flavor]) || PACK_FLAVOR.value;
    const packColor = crackedOption.flavor === 'theme' ? themeColor(routeKey(crackedOption.id) ?? '') : fl.color;
    const foil = crackedOption.goldCard;
    const fan: { card: BrewCandidate; isFoil: boolean }[] = [
      ...crackedOption.cards.map(card => ({ card, isFoil: false })),
      ...(foil ? [{ card: foil, isFoil: true }] : []),
    ];
    const isRainbow = crackedOption.windfallTier === 'rainbow';
    return (
      <div className="text-center" style={{ ['--pk' as string]: `hsl(${packColor})`, ['--pk-text' as string]: `hsl(${legibleText(packColor)})` }}>
        <div className="mb-5 inline-flex items-center gap-2 font-display text-lg font-semibold text-[color:var(--pk-text)]">
          <fl.Icon className="w-4 h-4" /> {crackedOption.label}
        </div>
        <div className="flex flex-wrap items-start justify-center gap-3 sm:gap-4" style={{ perspective: '1200px' }}>
          {fan.map(({ card, isFoil }, i) => {
            const kept = keep.has(card.name);
            const foilRing = isRainbow
              ? 'ring-2 ring-fuchsia-300/80 shadow-[0_0_26px_-4px_rgba(232,121,249,0.7),0_6px_18px_rgba(0,0,0,0.55)]'
              : 'ring-2 ring-amber-300/80 shadow-[0_0_26px_-4px_rgba(251,191,36,0.7),0_6px_18px_rgba(0,0,0,0.55)]';
            return (
              <button
                key={card.name}
                onClick={() => toggleKeep(card.name)}
                disabled={committing}
                aria-pressed={kept}
                style={committing ? undefined : { animationDelay: `${i * 80}ms` }}
                className={`relative w-[150px] sm:w-[176px] rounded-[4.8%] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pk)] ${
                  committing
                    ? (kept ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                    : 'animate-brew-fan-rise'
                }`}
              >
                {/* The foil — the windfall, sitting IN the pack like a real pull. */}
                {isFoil && (
                  <span className={`absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                    isRainbow
                      ? 'border-fuchsia-300/80 bg-[#160a2a]/90 text-fuchsia-100'
                      : 'border-amber-300/80 bg-[#241803]/90 text-amber-100'
                  }`}>
                    {isRainbow ? <Sparkles className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                    {isRainbow ? 'Rainbow foil' : 'Foil'}
                  </span>
                )}
                {kept && (
                  <span className="absolute top-1.5 right-1.5 z-20 grid place-items-center w-5 h-5 rounded-full bg-emerald-500 text-white shadow ring-1 ring-black/40">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
                <img
                  src={getCardImageUrl(card.scryfall, 'normal')}
                  alt={card.name}
                  className={`block w-full h-auto rounded-[4.8%] transition-[box-shadow,opacity,transform] duration-150 ${
                    isFoil ? foilRing
                      : kept ? 'ring-2 ring-emerald-400/90 shadow-[0_0_20px_-4px_rgba(52,211,153,0.6),0_6px_18px_rgba(0,0,0,0.55)]'
                      : 'ring-1 ring-black/60 shadow-[0_6px_18px_rgba(0,0,0,0.55)] opacity-90 hover:opacity-100'
                  } ${kept ? '' : 'hover:ring-2 hover:ring-[color:var(--pk)]'}`}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-6">
          <Button size="lg" className="btn-shimmer" disabled={keep.size === 0 || committing} onClick={() => commitKeeps(crackedOption)}>
            {keep.size === 0 ? 'Keep at least 1 card'
              : keep.size === fan.length ? `Keep all ${fan.length}`
              : `Keep ${keep.size} · pass ${fan.length - keep.size}`}
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase 2: the tear — the chosen pack center-stage; drag across the seam to rip it open. ──
  const tearOverlay = opening && (() => {
    const fl = (opening.flavor && PACK_FLAVOR[opening.flavor]) || PACK_FLAVOR.value;
    const packColor = opening.flavor === 'theme' ? themeColor(routeKey(opening.id) ?? '') : fl.color;
    return createPortal(
      <div className="fixed inset-0 z-[130] grid place-items-center bg-black/75 backdrop-blur-sm animate-fade-in">
        <div className="flex flex-col items-center gap-6" style={{ perspective: '900px' }}>
          <div className={stage === 'tear' ? 'brew-pack-float' : undefined}>
          <div
            ref={tearEl}
            onPointerDown={onTearDown}
            onPointerMove={(e) => { onTearMove(e, opening); if (!drag.current.active) trackTilt(e); }}
            onPointerUp={() => onTearUp(opening)}
            onPointerLeave={resetTilt}
            style={{
              ['--pk' as string]: `hsl(${packColor})`,
              ['--pk-hsl' as string]: packColor,
              ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
              ['--tear' as string]: 0,
              touchAction: 'none',
            }}
            className={`brew-pack3d relative w-[250px] sm:w-[280px] min-h-[430px] cursor-grab select-none overflow-visible active:cursor-grabbing ${
              stage === 'off' ? 'brew-pack-open-shake' : ''
            }`}
          >
            <PackDepth />
            {/* The tearable strip: the top crimp + a sliver of wrapper. Follows the tear progress
                (lifting and peeling as you drag), then rips away when the seam gives. */}
            <div
              aria-hidden="true"
              className={`brew-pack-strip absolute inset-x-0 top-0 z-30 h-[26px] overflow-hidden rounded-t-lg ${stage === 'off' ? 'brew-pack-strip-off' : ''}`}
            >
              <div className="brew-pack-crimp absolute inset-x-0 top-0 h-[18px]" />
              <div aria-hidden="true" className="absolute inset-x-0 top-[18px] h-[8px]"
                style={{ background: `linear-gradient(180deg, hsl(${packColor} / 0.55), hsl(${packColor} / 0.35))` }} />
            </div>
            {/* The tear edge: a glowing line that grows across the seam with your drag, with a
                bright tip where the foil is currently giving way. */}
            {stage === 'tear' && (
              <>
                <span aria-hidden="true" className="brew-tear-edge absolute left-0 top-[25px] z-40 block h-[3px] w-full" />
                <span aria-hidden="true" className="brew-tear-tip absolute top-[19px] z-40 block h-[15px] w-[15px]" />
              </>
            )}
            {/* The wrapper body below the seam — drops away once the strip is off. */}
            <div className={`brew-pack-face relative min-h-[430px] overflow-hidden rounded-b-lg rounded-t-sm shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85)] ${stage === 'off' ? 'brew-pack-body-drop' : ''}`}
              style={{ marginTop: 26 }}
            >
              <PackBody option={opening} packColor={packColor} brand={false} />
            </div>
          </div>
          </div>
          {/* The invitation — fades once the tearing starts. */}
          <p
            className="flex items-center gap-2 text-sm text-white/85 transition-opacity duration-300"
            style={{ opacity: stage === 'off' ? 0 : undefined }}
          >
            <MoveRight className="brew-tear-hint w-5 h-5 text-amber-200" />
            Tear across the seam — drag, or tap
          </p>
        </div>
      </div>,
      document.body,
    );
  })();

  // ── Phase 1: three sealed booster packs — foil wrappers that tilt and glare toward the pointer. ──
  return (
    <>
      {tearOverlay}
      <div className="flex flex-wrap items-stretch justify-center gap-6 sm:gap-9">
        {options.map((option, idx) => {
          const fl = (option.flavor && PACK_FLAVOR[option.flavor]) || PACK_FLAVOR.value;
          const packColor = option.flavor === 'theme' ? themeColor(routeKey(option.id) ?? '') : fl.color;
          const staged = opening?.id === option.id;
          const dimmed = (opening !== null || cracked !== null) && !staged;
          return (
            <button
              key={option.id}
              onClick={() => pick(option)}
              disabled={committing || !!cracked || !!opening}
              style={{ perspective: '600px' }}
              className={`group relative focus:outline-none ${dimmed || staged ? 'animate-brew-dismiss' : 'animate-brew-card-in'}`}
            >
              <div
                onPointerMove={trackTilt}
                onPointerLeave={resetTilt}
                style={{
                  ['--pk' as string]: `hsl(${packColor})`,
                  ['--pk-hsl' as string]: packColor,
                  ['--pk-soft' as string]: `hsl(${packColor} / 0.4)`,
                  ['--pk-text' as string]: `hsl(${legibleText(packColor)})`,
                  ...(dimmed || staged ? {} : { animationDelay: `${idx * 70}ms` }),
                }}
                className={`brew-pack3d relative min-h-[340px] w-[190px] text-left sm:w-[210px]`}
              >
                <PackDepth />
                <div className={`brew-pack-face relative min-h-[340px] overflow-hidden rounded-lg shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)] group-focus-visible:ring-2 group-focus-visible:ring-[color:var(--pk)] ${
                  brewNode.godPack ? 'brew-godpack-glow' : ''
                }`}>
                  {/* Top crimp + tease seam (the tear itself happens on the staged copy). */}
                  <div aria-hidden="true" className="brew-pack-crimp absolute inset-x-0 top-0 z-20 h-[18px]" />
                  {option.windfallTease && (
                    <span aria-hidden="true" className="brew-tease-seam absolute inset-x-0 top-[18px] z-10 block h-[2px]" />
                  )}
                  <PackBody option={option} packColor={packColor} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
