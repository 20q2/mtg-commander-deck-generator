import { describe, it, expect } from 'vitest';
import { buildPackNode } from '../nodes';
import { makeContext, makeState, makeCandidate } from './fixtures';

describe('named bundles + closing line', () => {
  const ctx = makeContext({
    themeNames: { tokens: 'Tokens', artifacts: 'Artifacts' },
    roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
    typeTargets: {},   // no type deficits, so the steering bundle is the removal role
    candidates: [
      makeCandidate('Token A', { themeTags: ['tokens'] }),
      makeCandidate('Token B', { themeTags: ['tokens'] }),
      makeCandidate('Arti A', { themeTags: ['artifacts'] }),
      makeCandidate('Arti B', { themeTags: ['artifacts'] }),
      makeCandidate('Removal A', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' }),
      makeCandidate('Removal B', { role: 'removal', type_line: 'Instant', primary_type: 'Instant' }),
    ],
  });

  it('names a theme bundle from the flavor map and lists the other bundles in closing', () => {
    const node = buildPackNode(ctx, makeState());
    expect(node).not.toBeNull();
    const tokens = node!.options.find(o => o.label === 'Raise an Army');
    expect(tokens).toBeTruthy();
    expect(tokens!.closing).toEqual(expect.arrayContaining(['Removal', 'Artifacts']));
    expect(tokens!.closing).not.toContain('Tokens');   // never lists itself

    const removal = node!.options.find(o => o.label === 'Clean Sweep');
    expect(removal).toBeTruthy();
    expect(removal!.closing).toEqual(expect.arrayContaining(['Tokens', 'Artifacts']));
  });
});
