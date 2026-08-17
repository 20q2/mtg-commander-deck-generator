import { describe, it, expect } from 'vitest';
import {
  encodeDeckPayload,
  decodeDeckPayload,
  readDeckHash,
  DeckLinkError,
  type SharedDeckPayload,
} from '../deckLink';

describe('deckLink codec', () => {
  it('round-trips a simple payload', async () => {
    const payload: SharedDeckPayload = {
      commanderName: 'Atraxa, Praetors\' Voice',
      cardNames: ['Sol Ring', 'Cultivate', 'Forest', 'Forest'],
    };
    const encoded = await encodeDeckPayload(payload);
    expect(await decodeDeckPayload(encoded)).toEqual(payload);
  });

  it('emits a version-1 prefix', async () => {
    const encoded = await encodeDeckPayload({ cardNames: ['Sol Ring'] });
    expect(encoded.startsWith('1.')).toBe(true);
  });

  it('preserves apostrophes, accents, and double-faced names', async () => {
    const payload: SharedDeckPayload = {
      commanderName: 'Lim-Dûl the Necromancer',
      partnerCommanderName: 'Kydele, Chosen of Kruphix',
      cardNames: ['Lim-Dûl\'s Vault', 'Wear // Tear', 'Æther Vial', 'Juzám Djinn'],
    };
    const encoded = await encodeDeckPayload(payload);
    expect(await decodeDeckPayload(encoded)).toEqual(payload);
  });

  it('preserves duplicate basics as separate entries', async () => {
    const cardNames = ['Forest', 'Forest', 'Forest', 'Island'];
    const encoded = await encodeDeckPayload({ cardNames });
    const decoded = await decodeDeckPayload(encoded);
    expect(decoded.cardNames).toEqual(cardNames);
  });

  it('omits commander and partner when absent', async () => {
    const encoded = await encodeDeckPayload({ cardNames: ['Sol Ring'] });
    const decoded = await decodeDeckPayload(encoded);
    expect(decoded.commanderName).toBeUndefined();
    expect(decoded.partnerCommanderName).toBeUndefined();
  });

  it('accepts an uncompressed version-0 payload', async () => {
    // "\n\nSol Ring" = no commander, no partner, one card.
    // btoa rather than Buffer: @types/node isn't in this project's type scope.
    const body = btoa('\n\nSol Ring')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decoded = await decodeDeckPayload(`0.${body}`);
    expect(decoded.cardNames).toEqual(['Sol Ring']);
  });

  it('rejects an unknown version', async () => {
    await expect(decodeDeckPayload('9.AAAA')).rejects.toMatchObject({
      reason: 'unsupported-version',
    });
  });

  it('rejects a truncated payload', async () => {
    const encoded = await encodeDeckPayload({ cardNames: ['Sol Ring', 'Cultivate'] });
    const truncated = encoded.slice(0, encoded.length - 6);
    await expect(decodeDeckPayload(truncated)).rejects.toBeInstanceOf(DeckLinkError);
  });

  it('rejects a payload with no cards', async () => {
    await expect(encodeDeckPayload({ cardNames: [] })).rejects.toMatchObject({
      reason: 'malformed',
    });
  });

  it('rejects an oversized deck', async () => {
    // 20k distinct long names will not compress under the 7500-char cap.
    const cardNames = Array.from({ length: 20000 }, (_, i) => `Unique Card Name Number ${i}`);
    await expect(encodeDeckPayload({ cardNames })).rejects.toMatchObject({
      reason: 'too-large',
    });
  });
});

describe('readDeckHash', () => {
  it('extracts the payload from a hash', () => {
    expect(readDeckHash('#d=1.AAAA')).toBe('1.AAAA');
  });

  it('returns null when there is no deck hash', () => {
    expect(readDeckHash('')).toBeNull();
    expect(readDeckHash('#')).toBeNull();
    expect(readDeckHash('#other=thing')).toBeNull();
  });

  it('tolerates a missing leading hash', () => {
    expect(readDeckHash('d=1.AAAA')).toBe('1.AAAA');
  });
});
