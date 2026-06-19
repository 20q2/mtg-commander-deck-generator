import type { ScryfallCard } from '@/types';
import type {
  BrewContext, BrewState, BrewCandidate, BrewEvent, BrewPick, BrewMoment, ComboPiece, BrewCrossroadsPath,
} from './brewTypes';
import { detectNearMissCombos } from './combos';
import { deriveReasons, shortPayoff } from './nodes';
import { applyPick } from './picks';
import { isUrgentFill } from './scoring';

/**
 * The "fun layer": framed, emotional decisions ("moments") generated from the runtime data the
 * engine already holds — no new network calls. Surfaced at steering milestones, throttled so they
 * stay special. nextEvent() picks at most one eligible, not-yet-fired event; applyEvent() resolves
 * the player's choice into a new (pure) state.
 */

// --- Tuning -----------------------------------------------------------------
/** Minimum picks between two moments, so events feel like events and not a quiz. */
export const MIN_MOMENT_GAP = 5;
/** A Strange Signal needs at least this co-play % with your picks to be worth surfacing. */
export const SIGNAL_MIN_CO = 12;
/** Don't surface Strange Signals before the deck has a little shape. */
export const SIGNAL_MIN_PICKS = 6;
/** Combo Fragments can appear early — finding combo treasure is exciting from the start. */
export const COMBO_MIN_PICKS = 4;
/** A theme counts toward a Crossroads once its affinity reaches "leaning" (≈ two themed picks). */
export const CROSSROADS_NOTICE = 20;
export const CROSSROADS_MIN_PICKS = 6;
/** Committing at a Crossroads adds this much affinity to the chosen theme — a hard bias. */
export const CROSSROADS_COMMIT = 40;
/** A Signature Pick needs the deck to have some shape (and a leaning theme) before it surfaces. */
export const SIGNATURE_MIN_PICKS = 5;
/** The gamble is a late, rare chaos beat — only once the deck can afford a wildcard. */
export const GAMBLE_MIN_PICKS = 8;

/** Sentinel choice id for the non-committal exit shared by every event kind. */
export const PASS_CHOICE = 'pass';

function gapOk(state: BrewState): boolean {
  return state.picks.length - state.lastMomentPick >= MIN_MOMENT_GAP;
}

// --- Generators -------------------------------------------------------------

/**
 * Strange Signal — the flagship "wait, why is this here?" moment. EDHREC's high-lift cards are, by
 * definition, the surprising ones: they co-occur with your picks far more than their overall play
 * rate would predict. We surface the strongest unseen lift discovery face-up, with no stat badges —
 * the intrigue is the point.
 */
export function strangeSignalEvent(_ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (state.picks.length < SIGNAL_MIN_PICKS) return null;
  const used = new Set(state.usedNames);
  const fired = new Set(state.firedEventIds);
  const candidate = state.discovered
    .filter(c => c.discoverySource === 'lift'
      && (c.coSynergy ?? 0) >= SIGNAL_MIN_CO
      && !used.has(c.name)
      && !fired.has(`signal:${c.name}`))
    .sort((a, b) => (b.coSynergy ?? 0) - (a.coSynergy ?? 0))[0];
  if (!candidate) return null;
  const via = candidate.discoveredVia ?? 'your picks';
  return {
    id: `signal:${candidate.name}`,
    kind: 'strangeSignal',
    title: 'Strange Signal',
    flavor: `This card keeps turning up alongside ${via}, yet almost nobody runs it in decks like this. The numbers say it belongs. Trust them?`,
    card: candidate,
    choices: [{ id: 'trust', label: 'Trust it', blurb: 'Add it to the deck — secret tech.', tone: 'theme' }],
    canPass: true,
    passLabel: 'Not this time',
  };
}

/**
 * Combo Fragment — reframes a near-miss combo from a plain route into treasure. You're shown the
 * payoff and the pieces you already own; you choose how hard to chase it.
 */
export function comboFragmentEvent(ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (state.picks.length < COMBO_MIN_PICKS) return null;
  const byName = new Map(ctx.candidates.map(c => [c.name, c] as const));
  const ownedArt = new Map<string, ScryfallCard>();
  ownedArt.set(ctx.commander.name, ctx.commander);
  if (ctx.partnerCommander) ownedArt.set(ctx.partnerCommander.name, ctx.partnerCommander);
  for (const p of state.picks) ownedArt.set(p.name, p.card);
  const fired = new Set(state.firedEventIds);

  for (const nm of detectNearMissCombos(ctx, state)) {
    if (fired.has(`combo:${nm.comboId}`)) continue;
    const missing = nm.missing.map(n => byName.get(n)).filter((c): c is BrewCandidate => !!c);
    if (missing.length === 0) continue;
    const have: ComboPiece[] = nm.have
      .map(n => { const scryfall = ownedArt.get(n); return scryfall ? { name: n, scryfall } : null; })
      .filter((p): p is ComboPiece => !!p)
      .slice(0, 2);
    const payoff = shortPayoff(nm.results);
    return {
      id: `combo:${nm.comboId}`,
      kind: 'comboFragment',
      title: 'Combo Fragment',
      flavor: `You're holding part of a known interaction — ${payoff.toLowerCase()}. ${missing.length === 1 ? 'One piece' : `${missing.length} pieces`} away.`,
      combo: { comboId: nm.comboId, results: nm.results, missing, have },
      choices: [
        { id: 'investigate', label: 'Investigate', blurb: 'The missing pieces start showing up more often.', tone: 'theme' },
        { id: 'exploit', label: 'Grab a piece', blurb: 'Take a missing piece right now.', tone: 'need' },
      ],
      canPass: true,
      passLabel: 'Abandon it',
    };
  }
  return null;
}

/**
 * Crossroads — when two or more themes are gaining real traction, name the pattern and ask the
 * player to commit (or stay open). Committing hard-biases every later offer toward that identity.
 */
export function crossroadsEvent(ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (state.picks.length < CROSSROADS_MIN_PICKS) return null;
  const contenders = Object.entries(state.themeAffinity)
    .filter(([slug, w]) => w >= CROSSROADS_NOTICE && ctx.themeNames[slug])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([slug]) => slug);
  if (contenders.length < 2) return null;
  const id = `crossroads:${[...contenders].sort().join('|')}`;
  if (state.firedEventIds.includes(id)) return null;

  const used = new Set(state.usedNames);
  const byName = new Map(ctx.candidates.map(c => [c.name, c] as const));
  const paths: BrewCrossroadsPath[] = contenders.map(slug => {
    const sampleCards = (ctx.themeSignatures[slug] ?? [])
      .map(n => byName.get(n))
      .filter((c): c is BrewCandidate => !!c && !used.has(c.name))
      .slice(0, 3);
    return { slug, name: ctx.themeNames[slug] ?? slug, sampleCards };
  });
  return {
    id,
    kind: 'crossroads',
    title: 'Crossroads',
    flavor: 'A pattern is emerging. Your picks are pulling in more than one direction — do you commit, or keep your options open?',
    paths,
    choices: paths.map(p => ({ id: `commit:${p.slug}`, label: `Commit to ${p.name}`, blurb: `Lean hard into ${p.name}.`, tone: 'theme' as const })),
    canPass: true,
    passLabel: 'Stay open',
  };
}

/**
 * Signature Pick — the "this is THE card" beat. When the deck is leaning a theme, surface the
 * single most-played card of that theme you haven't taken yet, and offer to make it the centerpiece.
 * Distinct from a Strange Signal (a surprising low-play-rate lift find): this is a defining staple
 * of a direction you've already chosen, and committing to it cements that identity.
 */
export function signaturePickEvent(ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (state.picks.length < SIGNATURE_MIN_PICKS) return null;
  const leaning = new Set(
    Object.entries(state.themeAffinity).filter(([s, w]) => w > 0 && ctx.themeNames[s]).map(([s]) => s),
  );
  if (leaning.size === 0) return null;
  const used = new Set(state.usedNames);
  const fired = new Set(state.firedEventIds);
  const pick = [...ctx.candidates, ...state.discovered]
    .filter(c => !c.isLand && !used.has(c.name) && !fired.has(`signature:${c.name}`)
      && c.themeTags.some(t => leaning.has(t)))
    .sort((a, b) => b.inclusion - a.inclusion)[0];
  if (!pick) return null;
  const slug = pick.themeTags.find(t => leaning.has(t))!;
  const themeName = ctx.themeNames[slug] ?? slug;
  return {
    id: `signature:${pick.name}`,
    kind: 'signaturePick',
    title: 'Signature Card',
    flavor: `Your ${themeName} build keeps pointing back to one card. Make it the centerpiece?`,
    card: pick,
    choices: [{ id: 'build', label: 'Build around it', blurb: `Add it and lean hard into ${themeName}.`, tone: 'theme' }],
    canPass: true,
    passLabel: 'Not the centerpiece',
  };
}

/**
 * Uncharted Territory — the chaos beat. Late in the run, surface the deepest cut in the pool (the
 * card almost no one plays in decks like this) and dare the player to take the leap. Non-destructive:
 * it adds an off-meta card and the store seeds fresh discoveries from it, so the gamble opens new
 * paths rather than punishing. Last in the priority chain — it fills a quiet moment, never crowds out
 * a combo or a signature card.
 */
export function gambleEvent(ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (state.picks.length < GAMBLE_MIN_PICKS) return null;
  const used = new Set(state.usedNames);
  const fired = new Set(state.firedEventIds);
  const card = [...ctx.candidates, ...state.discovered]
    .filter(c => !c.isLand && !used.has(c.name) && !fired.has(`gamble:${c.name}`))
    .sort((a, b) => a.inclusion - b.inclusion)[0];   // the deepest cut — least-played in the pool
  if (!card) return null;
  return {
    id: `gamble:${card.name}`,
    kind: 'gamble',
    title: 'Uncharted Territory',
    flavor: `Almost no one runs this card in decks like yours. There's no map here — take the leap and see what it pulls in?`,
    card,
    choices: [{ id: 'leap', label: 'Take the leap', blurb: 'Add it and chase the synergies it opens up.', tone: 'theme' }],
    canPass: true,
    passLabel: 'Play it safe',
  };
}

/**
 * Pick at most one moment to surface, respecting the inter-moment gap. Combo treasure first (rare
 * and exciting), then the identity-cementing Signature Pick, then the flagship Strange Signal, then
 * a Crossroads — and a Gamble fills a quiet moment when nothing else fires. Pure: reads (ctx, state).
 */
export function nextEvent(ctx: BrewContext, state: BrewState): BrewEvent | null {
  if (!gapOk(state)) return null;
  return comboFragmentEvent(ctx, state)
    ?? signaturePickEvent(ctx, state)
    ?? strangeSignalEvent(ctx, state)
    ?? crossroadsEvent(ctx, state)
    ?? gambleEvent(ctx, state);
}

// --- Resolution -------------------------------------------------------------

function candidateToPick(ctx: BrewContext, state: BrewState, c: BrewCandidate, viaRouteId: string): BrewPick {
  return {
    name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype, inclusion: c.inclusion,
    viaRouteId, reasons: deriveReasons(ctx, state, c),
  };
}

function affinityTags(c: BrewCandidate): string[] {
  const tags = [...c.themeTags];
  if (c.subtype) tags.push(c.subtype);
  return tags;
}

/** Stamp the bookkeeping every resolved event shares: dedupe id, gap marker, and a story moment. */
function recordMoment(state: BrewState, event: BrewEvent, moment: BrewMoment): BrewState {
  return {
    ...state,
    firedEventIds: state.firedEventIds.includes(event.id) ? state.firedEventIds : [...state.firedEventIds, event.id],
    lastMomentPick: state.picks.length,
    moments: [...state.moments, moment],
  };
}

/**
 * Resolve the player's choice into a new state. Pure. `choiceId === PASS_CHOICE` is the
 * non-committal exit. Card-adding choices go through applyPick with a `moment` tag, which locks
 * that pick from undo (the "accept fate" beat).
 */
export function applyEvent(ctx: BrewContext, state: BrewState, event: BrewEvent, choiceId: string): BrewState {
  const atPick = state.picks.length;

  if (event.kind === 'strangeSignal' && event.card) {
    if (choiceId === 'trust') {
      const c = event.card;
      const withPick = applyPick(state, [candidateToPick(ctx, state, c, event.id)], {
        routeType: 'gamble', passed: [], tags: { [c.name]: affinityTags(c) },
        moment: { kind: 'strangeSignal', label: c.name },
      });
      return recordMoment(withPick, event, { atPick: atPick + 1, kind: 'strangeSignal', label: `Trusted ${c.name}`, detail: 'Secret tech' });
    }
    return recordMoment(state, event, { atPick, kind: 'strangeSignal', label: `Passed on ${event.card.name}` });
  }

  if (event.kind === 'comboFragment' && event.combo) {
    const payoff = shortPayoff(event.combo.results);
    if (choiceId === 'investigate') {
      const watch = [...new Set([...state.comboWatch, ...event.combo.missing.map(c => c.name)])];
      return recordMoment({ ...state, comboWatch: watch }, event,
        { atPick, kind: 'comboFragment', label: `Chasing ${payoff}`, detail: event.combo.missing.map(c => c.name).join(' + ') });
    }
    if (choiceId === 'exploit') {
      // Take the most-available (cheapest) missing piece now; watch the rest so the combo closes itself.
      const sorted = [...event.combo.missing].sort((a, b) =>
        (parseFloat(a.scryfall.prices?.usd ?? '') || 0) - (parseFloat(b.scryfall.prices?.usd ?? '') || 0));
      const piece = sorted[0];
      const rest = sorted.slice(1).map(c => c.name);
      const withPick = applyPick(state, [candidateToPick(ctx, state, piece, event.id)], {
        routeType: 'combo', passed: [], tags: { [piece.name]: affinityTags(piece) },
        moment: { kind: 'comboFragment', label: piece.name },
      });
      const watched = { ...withPick, comboWatch: [...new Set([...withPick.comboWatch, ...rest])] };
      return recordMoment(watched, event, { atPick: atPick + 1, kind: 'comboFragment', label: `Grabbed ${piece.name}`, detail: payoff });
    }
    return recordMoment(state, event, { atPick, kind: 'comboFragment', label: `Abandoned ${payoff}` });
  }

  if (event.kind === 'gamble' && event.card) {
    const c = event.card;
    if (choiceId === 'leap') {
      // Add the off-meta card (locked). The store seeds fresh discoveries from it — the payoff.
      const withPick = applyPick(state, [candidateToPick(ctx, state, c, event.id)], {
        routeType: 'gamble', passed: [], tags: { [c.name]: affinityTags(c) },
        moment: { kind: 'gamble', label: c.name },
      });
      return recordMoment(withPick, event, { atPick: atPick + 1, kind: 'gamble', label: `Took the leap on ${c.name}`, detail: 'Uncharted territory' });
    }
    return recordMoment(state, event, { atPick, kind: 'gamble', label: `Played it safe — passed on ${c.name}` });
  }

  if (event.kind === 'signaturePick' && event.card) {
    const c = event.card;
    if (choiceId === 'build') {
      const withPick = applyPick(state, [candidateToPick(ctx, state, c, event.id)], {
        routeType: 'draft', passed: [], tags: { [c.name]: affinityTags(c) },
        moment: { kind: 'signaturePick', label: c.name },
      });
      // Cement the identity: bump the card's leading (leaning) theme like a soft commit, on top of
      // the normal per-pick affinity applyPick already added.
      const slug = c.themeTags.find(t => (state.themeAffinity[t] ?? 0) > 0 && ctx.themeNames[t]) ?? c.themeTags[0];
      const themeAffinity = slug
        ? { ...withPick.themeAffinity, [slug]: (withPick.themeAffinity[slug] ?? 0) + CROSSROADS_COMMIT }
        : withPick.themeAffinity;
      const themeName = slug ? ctx.themeNames[slug] : undefined;
      return recordMoment({ ...withPick, themeAffinity }, event,
        { atPick: atPick + 1, kind: 'signaturePick', label: `Built around ${c.name}`, detail: themeName ? `Leaning ${themeName}` : undefined });
    }
    return recordMoment(state, event, { atPick, kind: 'signaturePick', label: `Passed on ${c.name}` });
  }

  if (event.kind === 'crossroads' && choiceId.startsWith('commit:')) {
    const slug = choiceId.slice('commit:'.length);
    const name = ctx.themeNames[slug] ?? slug;
    const themeAffinity = { ...state.themeAffinity, [slug]: (state.themeAffinity[slug] ?? 0) + CROSSROADS_COMMIT };
    // committedTheme drives the off-theme soft-remove in scoring and the meter's committed marker.
    return recordMoment({ ...state, themeAffinity, committedTheme: slug }, event, { atPick, kind: 'crossroads', label: `Committed to ${name}` });
  }

  // Pass / unrecognized choice: record the non-committal exit.
  const passDetail = event.kind === 'crossroads' ? 'Stayed open'
    : event.kind === 'comboFragment' ? 'Walked away'
    : 'Let it pass';
  return recordMoment(state, event, { atPick, kind: event.kind, label: passDetail });
}

/** Number of seed cards to fan a commit injection from (the theme's most-defining cards). */
const COMMIT_SEED_CAP = 4;

/** The cards that define a theme — used to seed the on-commit discovery injection. */
export function commitSeeds(ctx: BrewContext, slug: string): string[] {
  return (ctx.themeSignatures[slug] ?? []).slice(0, COMMIT_SEED_CAP);
}

/**
 * How many draftable candidates a commit would set aside: off-theme cards that aren't urgent role
 * fills (those break through the penalty). Drives the "N set aside" half of the commit readout.
 */
export function commitImpact(ctx: BrewContext, state: BrewState, slug: string): { suppressed: number } {
  const used = new Set(state.usedNames);
  const suppressed = ctx.candidates.filter(c =>
    !used.has(c.name) && !c.isLand && !c.themeTags.includes(slug) && !isUrgentFill(ctx, state, c)).length;
  return { suppressed };
}
