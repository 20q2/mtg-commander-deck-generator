import { describe, it, expect } from 'vitest';
import {
  nextEvent, applyEvent, strangeSignalEvent, comboFragmentEvent, crossroadsEvent, signaturePickEvent, gambleEvent,
  PASS_CHOICE, CROSSROADS_COMMIT, SIGNAL_MIN_PICKS, SIGNATURE_MIN_PICKS, GAMBLE_MIN_PICKS, commitSeeds, commitImpact,
} from '../events';
import { isLastPickLocked, undoLast } from '../picks';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewPick, BrewState } from '../brewTypes';
import type { EDHRECCombo } from '@/types';

function combo(id: string, names: string[]): EDHRECCombo {
  return { comboId: id, cards: names.map(n => ({ name: n, id: n })), results: ['Infinite tokens'],
    deckCount: 1000, rank: 1, bracket: '3', prereqCount: 0 };
}

/** N filler picks so the deck clears the per-event pick floors. */
function makePicks(n: number): BrewPick[] {
  return Array.from({ length: n }, (_, i) => {
    const c = makeCandidate(`Pick ${i}`, { inclusion: 40 });
    return { name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype, inclusion: c.inclusion, viaRouteId: 'seed', reasons: [] };
  });
}

function withPicks(n: number, over: Partial<BrewState> = {}): BrewState {
  const picks = makePicks(n);
  return makeState({ picks, usedNames: picks.map(p => p.name), ...over });
}

describe('strangeSignalEvent', () => {
  const signal = makeCandidate('Mystery Card', { discoverySource: 'lift', coSynergy: 35, discoveredVia: 'Skullclamp' });

  it('surfaces the strongest unseen lift discovery as a Strange Signal', () => {
    const weaker = makeCandidate('Weaker Card', { discoverySource: 'lift', coSynergy: 20, discoveredVia: 'Skullclamp' });
    const ev = strangeSignalEvent(makeContext(), withPicks(SIGNAL_MIN_PICKS, { discovered: [weaker, signal] }));
    expect(ev?.kind).toBe('strangeSignal');
    expect(ev?.card?.name).toBe('Mystery Card');     // higher coSynergy wins
    expect(ev?.canPass).toBe(true);
  });

  it('ignores co-play / similar discoveries (only lift is "strange")', () => {
    const coplay = makeCandidate('Coplay Card', { discoverySource: 'coplay', coSynergy: 90, discoveredVia: 'x' });
    expect(strangeSignalEvent(makeContext(), withPicks(SIGNAL_MIN_PICKS, { discovered: [coplay] }))).toBeNull();
  });

  it('holds until the deck has some shape', () => {
    expect(strangeSignalEvent(makeContext(), withPicks(SIGNAL_MIN_PICKS - 1, { discovered: [signal] }))).toBeNull();
  });

  it('does not re-offer a signal already fired or a card already in the deck', () => {
    expect(strangeSignalEvent(makeContext(), withPicks(SIGNAL_MIN_PICKS, { discovered: [signal], firedEventIds: ['signal:Mystery Card'] }))).toBeNull();
    expect(strangeSignalEvent(makeContext(), withPicks(SIGNAL_MIN_PICKS, { discovered: [signal], usedNames: ['Mystery Card'] }))).toBeNull();
  });
});

describe('comboFragmentEvent', () => {
  function comboCtx() {
    return makeContext({
      candidates: [makeCandidate('Cathars Crusade', {})],
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Cathars Crusade'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
  }

  it('reframes a near-miss combo into a fragment with payoff, missing and owned pieces', () => {
    const ev = comboFragmentEvent(comboCtx(), withPicks(4));
    expect(ev?.kind).toBe('comboFragment');
    expect(ev?.combo?.missing.map(c => c.name)).toEqual(['Cathars Crusade']);
    expect(ev?.combo?.have.map(p => p.name)).toEqual(['Ghave, Guru of Spores']);
    expect(ev?.choices.map(c => c.id)).toEqual(['investigate', 'exploit']);
  });

  it('does not re-offer a combo already fired', () => {
    expect(comboFragmentEvent(comboCtx(), withPicks(4, { firedEventIds: ['combo:c1'] }))).toBeNull();
  });
});

describe('crossroadsEvent', () => {
  function crossCtx() {
    return makeContext({ themeNames: { tokens: 'Go Wide', aristocrats: 'Aristocrats' } });
  }

  it('fires when two themes reach the noticing threshold', () => {
    const ev = crossroadsEvent(crossCtx(), withPicks(6, { themeAffinity: { tokens: 30, aristocrats: 20 } }));
    expect(ev?.kind).toBe('crossroads');
    expect(ev?.paths?.map(p => p.slug).sort()).toEqual(['aristocrats', 'tokens']);
    expect(ev?.choices.map(c => c.id)).toContain('commit:tokens');
  });

  it('stays quiet with only one leaning theme', () => {
    expect(crossroadsEvent(crossCtx(), withPicks(6, { themeAffinity: { tokens: 40 } }))).toBeNull();
  });

  it('only counts themes that have a display name (not subtype affinity)', () => {
    const ev = crossroadsEvent(crossCtx(), withPicks(6, { themeAffinity: { tokens: 30, 'spot-removal': 30 } }));
    expect(ev).toBeNull(); // only one *named* theme
  });
});

describe('nextEvent', () => {
  it('respects the inter-moment gap', () => {
    const signal = makeCandidate('Mystery Card', { discoverySource: 'lift', coSynergy: 35 });
    const state = withPicks(SIGNAL_MIN_PICKS, { discovered: [signal], lastMomentPick: SIGNAL_MIN_PICKS });
    expect(nextEvent(makeContext(), state)).toBeNull();          // 0 picks since last moment
  });

  it('prefers combo treasure over a strange signal', () => {
    const ctx = makeContext({
      candidates: [makeCandidate('Cathars Crusade', {})],
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Cathars Crusade'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    const signal = makeCandidate('Mystery Card', { discoverySource: 'lift', coSynergy: 35 });
    const ev = nextEvent(ctx, withPicks(SIGNAL_MIN_PICKS, { discovered: [signal] }));
    expect(ev?.kind).toBe('comboFragment');
  });
});

describe('applyEvent', () => {
  const ctx = makeContext({ themeNames: { tokens: 'Go Wide' } });

  it('Trust adds the card, locks it from undo, and logs a moment', () => {
    const signal = makeCandidate('Mystery Card', { discoverySource: 'lift', coSynergy: 35, subtype: 'card-draw' });
    const state = withPicks(SIGNAL_MIN_PICKS, { discovered: [signal] });
    const ev = strangeSignalEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, 'trust');

    expect(next.picks.map(p => p.name)).toContain('Mystery Card');
    expect(next.firedEventIds).toContain('signal:Mystery Card');
    expect(next.lastMomentPick).toBe(next.picks.length);
    expect(next.moments[next.moments.length - 1]?.label).toBe('Trusted Mystery Card');
    expect(isLastPickLocked(next)).toBe(true);
    expect(undoLast(next)).toBe(next);                            // committed — undo refuses
  });

  it('Pass records the moment without adding a card', () => {
    const signal = makeCandidate('Mystery Card', { discoverySource: 'lift', coSynergy: 35 });
    const state = withPicks(SIGNAL_MIN_PICKS, { discovered: [signal] });
    const ev = strangeSignalEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, PASS_CHOICE);
    expect(next.picks.length).toBe(state.picks.length);
    expect(next.firedEventIds).toContain('signal:Mystery Card');
  });

  it('Investigate adds the missing pieces to comboWatch', () => {
    const comboCtx = makeContext({
      candidates: [makeCandidate('Cathars Crusade', {})],
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Cathars Crusade'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    const state = withPicks(4);
    const ev = comboFragmentEvent(comboCtx, state)!;
    const next = applyEvent(comboCtx, state, ev, 'investigate');
    expect(next.comboWatch).toContain('Cathars Crusade');
    expect(next.picks.length).toBe(state.picks.length);          // no card added
  });

  it('Exploit takes the cheapest missing piece and watches the rest', () => {
    const comboCtx = makeContext({
      candidates: [makeCandidate('Cheap Piece', { price: '0.50' }), makeCandidate('Pricey Piece', { price: '9.00' })],
      combos: [combo('c1', ['Ghave, Guru of Spores', 'Cheap Piece', 'Pricey Piece'])],
      commander: makeCandidate('Ghave, Guru of Spores', {}).scryfall,
    });
    const state = withPicks(4);
    const ev = comboFragmentEvent(comboCtx, state)!;
    const next = applyEvent(comboCtx, state, ev, 'exploit');
    expect(next.picks[next.picks.length - 1]?.name).toBe('Cheap Piece');
    expect(next.comboWatch).toContain('Pricey Piece');
    expect(isLastPickLocked(next)).toBe(true);
  });

  it('Commit bumps the chosen theme affinity hard and sets committedTheme', () => {
    const state = withPicks(6, { themeAffinity: { tokens: 30, aristocrats: 20 } });
    const crossCtx = makeContext({ themeNames: { tokens: 'Go Wide', aristocrats: 'Aristocrats' } });
    const ev = crossroadsEvent(crossCtx, state)!;
    const next = applyEvent(crossCtx, state, ev, 'commit:tokens');
    expect(next.themeAffinity.tokens).toBe(30 + CROSSROADS_COMMIT);
    expect(next.committedTheme).toBe('tokens');
    expect(next.moments[next.moments.length - 1]?.label).toBe('Committed to Go Wide');
  });
});

describe('signaturePickEvent', () => {
  const ctx = makeContext({
    themeNames: { tokens: 'Tokens' },
    candidates: [
      makeCandidate('Defining Staple', { themeTags: ['tokens'], inclusion: 85 }),
      makeCandidate('Lesser Token Card', { themeTags: ['tokens'], inclusion: 40 }),
      makeCandidate('Off Theme', { themeTags: ['artifacts'], inclusion: 95 }),
    ],
  });

  it('surfaces the highest-inclusion card on a leaning theme', () => {
    const ev = signaturePickEvent(ctx, withPicks(SIGNATURE_MIN_PICKS, { themeAffinity: { tokens: 30 } }));
    expect(ev?.kind).toBe('signaturePick');
    expect(ev?.card?.name).toBe('Defining Staple');   // higher inclusion than the lesser token card
    expect(ev?.choices.map(c => c.id)).toEqual(['build']);
  });

  it('stays quiet when no theme is leaning', () => {
    expect(signaturePickEvent(ctx, withPicks(SIGNATURE_MIN_PICKS))).toBeNull();
  });

  it('does not re-offer a fired signature or an already-used card', () => {
    expect(signaturePickEvent(ctx, withPicks(SIGNATURE_MIN_PICKS, { themeAffinity: { tokens: 30 }, firedEventIds: ['signature:Defining Staple'] }))?.card?.name).toBe('Lesser Token Card');
    expect(signaturePickEvent(ctx, withPicks(SIGNATURE_MIN_PICKS, { themeAffinity: { tokens: 30 }, usedNames: ['Defining Staple'] }))?.card?.name).toBe('Lesser Token Card');
  });

  it('Build around it adds the locked card and cements its theme', () => {
    const state = withPicks(SIGNATURE_MIN_PICKS, { themeAffinity: { tokens: 30 } });
    const ev = signaturePickEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, 'build');
    expect(next.picks.map(p => p.name)).toContain('Defining Staple');
    // +10 from the per-pick affinity, +CROSSROADS_COMMIT (40) from the cement = +50 over the prior 30.
    expect(next.themeAffinity.tokens).toBe(30 + 10 + CROSSROADS_COMMIT);
    expect(next.moments[next.moments.length - 1]?.label).toBe('Built around Defining Staple');
  });

  it('Pass records the moment without adding a card', () => {
    const state = withPicks(SIGNATURE_MIN_PICKS, { themeAffinity: { tokens: 30 } });
    const ev = signaturePickEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, PASS_CHOICE);
    expect(next.picks.length).toBe(state.picks.length);
    expect(next.moments[next.moments.length - 1]?.label).toBe('Passed on Defining Staple');
  });
});

describe('gambleEvent (Uncharted Territory)', () => {
  const ctx = makeContext({
    candidates: [
      makeCandidate('Deep Cut', { inclusion: 3 }),
      makeCandidate('Mid Card', { inclusion: 40 }),
      makeCandidate('Staple', { inclusion: 90 }),
    ],
  });

  it('surfaces the lowest-inclusion (deepest-cut) unused card once late enough', () => {
    const ev = gambleEvent(ctx, withPicks(GAMBLE_MIN_PICKS));
    expect(ev?.kind).toBe('gamble');
    expect(ev?.card?.name).toBe('Deep Cut');
    expect(ev?.choices.map(c => c.id)).toEqual(['leap']);
  });

  it('holds until the deck can afford a wildcard', () => {
    expect(gambleEvent(ctx, withPicks(GAMBLE_MIN_PICKS - 1))).toBeNull();
  });

  it('does not re-offer a fired gamble or an already-used card', () => {
    expect(gambleEvent(ctx, withPicks(GAMBLE_MIN_PICKS, { firedEventIds: ['gamble:Deep Cut'] }))?.card?.name).toBe('Mid Card');
    expect(gambleEvent(ctx, withPicks(GAMBLE_MIN_PICKS, { usedNames: ['Deep Cut'] }))?.card?.name).toBe('Mid Card');
  });

  it('Take the leap adds the off-meta card, locked, and logs the moment', () => {
    const state = withPicks(GAMBLE_MIN_PICKS);
    const ev = gambleEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, 'leap');
    expect(next.picks.map(p => p.name)).toContain('Deep Cut');
    expect(next.moments[next.moments.length - 1]?.label).toBe('Took the leap on Deep Cut');
  });

  it('Play it safe records the moment without adding a card', () => {
    const state = withPicks(GAMBLE_MIN_PICKS);
    const ev = gambleEvent(ctx, state)!;
    const next = applyEvent(ctx, state, ev, PASS_CHOICE);
    expect(next.picks.length).toBe(state.picks.length);
    expect(next.moments[next.moments.length - 1]?.label).toContain('Played it safe');
  });
});

describe('commit injection helpers', () => {
  const ctx = makeContext({
    themeNames: { tokens: 'Tokens', artifacts: 'Artifacts' },
    themeSignatures: { tokens: ['Token A', 'Token B', 'Token C', 'Token D', 'Token E'] },
    typeTargets: {},
    candidates: [
      makeCandidate('Token A', { themeTags: ['tokens'] }),
      makeCandidate('Arti A', { themeTags: ['artifacts'] }),
      makeCandidate('Arti B', { themeTags: ['artifacts'] }),
    ],
  });

  it('commitSeeds returns the committed theme signature cards (capped)', () => {
    expect(commitSeeds(ctx, 'tokens')).toEqual(['Token A', 'Token B', 'Token C', 'Token D']);
  });

  it('commitImpact counts off-theme, non-urgent candidates that would be set aside', () => {
    // typeTargets {} and no role on candidates → nothing is urgent; both artifacts are off-theme.
    expect(commitImpact(ctx, makeState(), 'tokens').suppressed).toBe(2);
  });
});
