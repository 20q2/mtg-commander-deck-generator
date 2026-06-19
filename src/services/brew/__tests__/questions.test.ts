import { describe, it, expect } from 'vitest';
import { nextQuestion, applyAnswer, openingThemeQuestion, QUESTION_LEAN, MAX_QUESTIONS } from '../questions';
import { makeContext, makeState, makeCandidate } from './fixtures';
import type { BrewAnswer } from '../brewTypes';

const THEMES = { tokens: 'Tokens', sacrifice: 'Sacrifice', counters: '+1/+1 Counters', mill: 'Mill' };

describe('nextQuestion', () => {
  it('builds a question with up to 3 playstyle answers from the commander themes', () => {
    const ctx = makeContext({ themeNames: THEMES });
    const q = nextQuestion(ctx, makeState());
    expect(q).not.toBeNull();
    expect(q!.answers.length).toBe(3);
    expect(q!.prompt.length).toBeGreaterThan(0);
    // each answer leans exactly one of the commander's theme slugs
    for (const a of q!.answers) {
      expect(a.themeSlugs).toHaveLength(1);
      expect(Object.keys(THEMES)).toContain(a.themeSlugs[0]);
    }
  });

  it('uses the playstyle map label for known archetypes', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens', mill: 'Mill' } });
    const q = nextQuestion(ctx, makeState());
    const tokens = q!.answers.find(a => a.themeSlugs[0] === 'tokens')!;
    expect(tokens.label).toBe('Go wide');
  });

  it('falls back to the theme display name for unmapped themes', () => {
    const ctx = makeContext({ themeNames: { 'weird-niche': 'Weird Niche', mill: 'Mill' } });
    const q = nextQuestion(ctx, makeState());
    const odd = q!.answers.find(a => a.themeSlugs[0] === 'weird-niche')!;
    expect(odd.label).toBe('Weird Niche');
    expect(odd.blurb).toContain('Weird Niche');
  });

  it('excludes themes already strongly leaned', () => {
    const ctx = makeContext({ themeNames: THEMES });
    // tokens is past the leaning threshold (20) — it should not be offered again
    const q = nextQuestion(ctx, makeState({ themeAffinity: { tokens: 30 } }));
    expect(q!.answers.some(a => a.themeSlugs[0] === 'tokens')).toBe(false);
  });

  it('returns null when fewer than 2 un-leaned themes are available', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens' } });
    expect(nextQuestion(ctx, makeState())).toBeNull();
  });

  it('returns null once the question cap is reached', () => {
    const ctx = makeContext({ themeNames: THEMES });
    expect(nextQuestion(ctx, makeState({ questionsAsked: MAX_QUESTIONS }))).toBeNull();
  });
});

describe('applyAnswer', () => {
  it('adds QUESTION_LEAN to each leaned slug and increments questionsAsked', () => {
    const ctx = makeContext({ themeNames: THEMES });
    const q = nextQuestion(ctx, makeState())!;
    const answer = q.answers[0];
    const next = applyAnswer(makeState(), answer);
    expect(next.themeAffinity[answer.themeSlugs[0]]).toBe(QUESTION_LEAN);
    expect(next.questionsAsked).toBe(1);
  });

  it('stacks onto existing affinity', () => {
    const answer = { id: 'a', label: 'Go wide', blurb: '', themeSlugs: ['tokens'] };
    const next = applyAnswer(makeState({ themeAffinity: { tokens: 5 } }), answer);
    expect(next.themeAffinity.tokens).toBe(5 + QUESTION_LEAN);
  });

  it('a null answer (skip) only bumps the counter', () => {
    const next = applyAnswer(makeState({ themeAffinity: { tokens: 5 } }), null);
    expect(next.questionsAsked).toBe(1);
    expect(next.themeAffinity.tokens).toBe(5);
  });

  it('uses answer.lean when present (commit), else QUESTION_LEAN (nudge)', () => {
    const commit: BrewAnswer = { id: 'a', label: 'Tokens', blurb: '', themeSlugs: ['tokens'], lean: 24 };
    const nudge: BrewAnswer = { id: 'b', label: 'Sacrifice', blurb: '', themeSlugs: ['sacrifice'] };
    expect(applyAnswer(makeState(), commit).themeAffinity.tokens).toBe(24);
    expect(applyAnswer(makeState(), nudge).themeAffinity.sacrifice).toBe(QUESTION_LEAN);
  });
});

describe('openingThemeQuestion', () => {
  it('picks the most distinctive card per theme, dedupes, carries card + commit lean', () => {
    const distinctTokens = makeCandidate('Bitterblossom', { inclusion: 30, themeTags: ['tokens'] });
    const crossStaple = makeCandidate('Sol Ring', { inclusion: 90, themeTags: ['tokens', 'sacrifice', 'ramp'] });
    const sacrifice = makeCandidate('Viscera Seer', { inclusion: 40, themeTags: ['sacrifice'] });
    const ctx = makeContext({
      themeNames: { tokens: 'Tokens', sacrifice: 'Sacrifice' },
      candidates: [crossStaple, distinctTokens, sacrifice],
    });

    const q = openingThemeQuestion(ctx)!;
    const byTheme = Object.fromEntries(q.answers.map(a => [a.themeSlugs[0], a]));
    expect(byTheme.tokens.card?.name).toBe('Bitterblossom');   // distinctive beats the cross-theme staple
    expect(byTheme.sacrifice.card?.name).toBe('Viscera Seer');
    expect(byTheme.tokens.lean).toBe(24);
    expect(q.answers.length).toBe(2);
  });

  it('prefers theme-synergy signatures over inclusion staples', () => {
    const sacSignature = makeCandidate('Viscera Seer', { inclusion: 40, themeTags: ['sacrifice', 'aristocrats'] });
    const staple = makeCandidate('Sol Ring', { inclusion: 95, themeTags: ['sacrifice', 'aristocrats', 'ramp'] });
    const aristoSignature = makeCandidate('Blood Artist', { inclusion: 35, themeTags: ['aristocrats'] });
    const ctx = makeContext({
      themeNames: { sacrifice: 'Sacrifice', aristocrats: 'Aristocrats' },
      themeSignatures: { sacrifice: ['Viscera Seer', 'Sol Ring'], aristocrats: ['Blood Artist', 'Sol Ring'] },
      candidates: [staple, sacSignature, aristoSignature],
    });
    const byTheme = Object.fromEntries(openingThemeQuestion(ctx)!.answers.map(a => [a.themeSlugs[0], a]));
    expect(byTheme.sacrifice.card?.name).toBe('Viscera Seer'); // synergy signature beats the higher-inclusion Sol Ring
    expect(byTheme.aristocrats.card?.name).toBe('Blood Artist');
  });

  it('returns null when fewer than two themes have a signature card', () => {
    const ctx = makeContext({ themeNames: { tokens: 'Tokens' }, candidates: [makeCandidate('X', { themeTags: ['tokens'] })] });
    expect(openingThemeQuestion(ctx)).toBeNull();
  });
});
