import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScryfallCard } from '@/types';
import { isExtraPrinting } from './extras';

/**
 * Regression: an eternalize token is a name-identical copy of its parent card, but the
 * copy is a BLACK Zombie. The playtest token spawner fetches tokens by id through
 * getCardsByIds, which used to write every result into the name-keyed card caches — so
 * "Fanatic of Rhonas" started resolving to a {B,G} token instead of the {G} creature,
 * and Xyris (URG) decks holding it reported a color-identity violation.
 */

const CREATURE = {
  id: 'creature-id',
  oracle_id: 'oracle-1',
  name: 'Fanatic of Rhonas',
  cmc: 4,
  type_line: 'Creature — Snake Druid',
  color_identity: ['G'],
  colors: ['G'],
  keywords: ['Eternalize'],
  rarity: 'rare',
  layout: 'normal',
  set: 'mh3',
  set_name: 'Modern Horizons 3',
  prices: { usd: '19.65' },
} as unknown as ScryfallCard;

const TOKEN = {
  id: 'token-id',
  oracle_id: 'oracle-2',
  name: 'Fanatic of Rhonas',
  cmc: 0,
  type_line: 'Token Creature — Zombie Snake Druid',
  color_identity: ['B', 'G'],
  colors: ['B'],
  keywords: [],
  rarity: 'common',
  layout: 'token',
  set: 'tmh3',
  set_name: 'Modern Horizons 3 Tokens',
  prices: { usd: null },
} as unknown as ScryfallCard;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Serves the token for id lookups and the creature for name lookups — i.e. exactly what
 *  Scryfall does, since /cards/collection by name never returns an extra. */
function scryfallStub() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/cards/collection')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        identifiers: Array<{ id?: string; name?: string }>;
      };
      return json({
        data: body.identifiers.map(i => (i.id ? TOKEN : CREATURE)),
        not_found: [],
      });
    }
    if (url.includes('/cards/search')) {
      return json({ object: 'list', total_cards: 1, has_more: false, data: [CREATURE] });
    }
    return json({ object: 'error' }, 404);
  });
}

describe('isExtraPrinting', () => {
  it('flags token and emblem layouts', () => {
    expect(isExtraPrinting(TOKEN)).toBe(true);
    expect(isExtraPrinting({ layout: 'emblem', type_line: 'Emblem — Ajani Goldmane' })).toBe(true);
  });

  it('falls back to the type line when layout is absent (older cached entries)', () => {
    expect(isExtraPrinting({ type_line: 'Token Creature — Zombie Snake Druid' })).toBe(true);
  });

  it('leaves real cards alone', () => {
    expect(isExtraPrinting(CREATURE)).toBe(false);
    expect(isExtraPrinting({ layout: 'modal_dfc', type_line: 'Creature — Elf // Land' })).toBe(false);
    expect(isExtraPrinting(undefined)).toBe(false);
  });
});

describe('token/card name collision', () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    vi.resetModules(); // module-level card cache must start empty for each case
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('does not let a token fetched by id shadow the real card by name', async () => {
    globalThis.fetch = scryfallStub() as unknown as typeof globalThis.fetch;
    const { getCardsByIds, getCardsByNames } = await import('./client');

    // The playtest token spawner resolving all_parts — this is what poisoned the cache.
    const byId = await getCardsByIds(['token-id']);
    expect(byId.get('token-id')?.layout).toBe('token');

    const byName = await getCardsByNames(['Fanatic of Rhonas']);
    const resolved = byName.get('Fanatic of Rhonas');
    expect(resolved?.layout).toBe('normal');
    expect(resolved?.color_identity).toEqual(['G']);
  });

  it('drops a token the collection endpoint returns for a pinned token set', async () => {
    // {name, set:'tmh3'} really does resolve to the token, so the preferred-set path has
    // to fall back to the unconstrained lookup rather than accept it.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/cards/collection')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          identifiers: Array<{ name?: string; set?: string }>;
        };
        return json({
          data: body.identifiers.map(i => (i.set ? TOKEN : CREATURE)),
          not_found: [],
        });
      }
      if (url.includes('/cards/search')) {
        return json({ object: 'list', total_cards: 1, has_more: false, data: [CREATURE] });
      }
      return json({ object: 'error' }, 404);
    }) as unknown as typeof globalThis.fetch;

    const { getCardsByNames } = await import('./client');
    const byName = await getCardsByNames(['Fanatic of Rhonas'], undefined, 'tmh3');
    const resolved = byName.get('Fanatic of Rhonas');
    expect(resolved?.layout).toBe('normal');
    expect(resolved?.color_identity).toEqual(['G']);
  });
});
