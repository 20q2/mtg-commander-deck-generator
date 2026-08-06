import { describe, it, expect } from 'vitest';
import {
  readExternalDecklist,
  buildCreateDeckUrl,
  buildAnalyzeDeckUrl,
  formatExternalDecklist,
} from './externalDeckUrl';

const SAMPLE = '1 Pantlaza, Sun-Favored\n1 Sol Ring\n1 Cultivate';

describe('readExternalDecklist', () => {
  it('returns null when c is missing', () => {
    expect(readExternalDecklist(new URLSearchParams())).toBeNull();
  });

  it('returns null when c is blank', () => {
    expect(readExternalDecklist(new URLSearchParams('c=%20%0A'))).toBeNull();
    expect(readExternalDecklist(new URLSearchParams('c='))).toBeNull();
  });

  it('reads c alone', () => {
    const params = new URLSearchParams();
    params.set('c', SAMPLE);
    expect(readExternalDecklist(params)).toEqual({ decklist: SAMPLE });
  });

  it('reads c + name + commander', () => {
    const params = new URLSearchParams();
    params.set('c', SAMPLE);
    params.set('name', '  Dino Tribal  ');
    params.set('commander', '  Pantlaza, Sun-Favored  ');
    expect(readExternalDecklist(params)).toEqual({
      decklist: SAMPLE,
      name: 'Dino Tribal',
      commander: 'Pantlaza, Sun-Favored',
    });
  });

  it('ignores blank name and commander', () => {
    const params = new URLSearchParams();
    params.set('c', '1 Sol Ring');
    params.set('name', '   ');
    params.set('commander', '  ');
    expect(readExternalDecklist(params)).toEqual({ decklist: '1 Sol Ring' });
  });
});

describe('buildCreateDeckUrl / buildAnalyzeDeckUrl', () => {
  it('builds create URL with encoded c, commander, and optional name', () => {
    const url = buildCreateDeckUrl(SAMPLE, {
      name: 'Dino Tribal',
      commander: 'Pantlaza, Sun-Favored',
      origin: 'https://manafoundry.gg',
    });
    expect(url.startsWith('https://manafoundry.gg/decks/create?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('c')).toBe(SAMPLE);
    expect(q.get('commander')).toBe('Pantlaza, Sun-Favored');
    expect(q.get('name')).toBe('Dino Tribal');
  });

  it('omits name/commander when not provided', () => {
    const url = buildCreateDeckUrl('1 Sol Ring', { origin: 'https://manafoundry.gg' });
    const q = new URL(url).searchParams;
    expect(q.has('name')).toBe(false);
    expect(q.has('commander')).toBe(false);
  });

  it('builds analyze URL with commander', () => {
    const url = buildAnalyzeDeckUrl(SAMPLE, {
      commander: 'Pantlaza, Sun-Favored',
      origin: 'https://manafoundry.gg',
    });
    expect(url.startsWith('https://manafoundry.gg/analyze?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('c')).toBe(SAMPLE);
    expect(q.get('commander')).toBe('Pantlaza, Sun-Favored');
  });

  it('round-trips through readExternalDecklist', () => {
    const url = buildCreateDeckUrl(SAMPLE, {
      name: 'Test Deck',
      commander: 'Pantlaza, Sun-Favored',
      origin: 'https://example.com',
    });
    const payload = readExternalDecklist(new URL(url).searchParams);
    expect(payload).toEqual({
      decklist: SAMPLE,
      name: 'Test Deck',
      commander: 'Pantlaza, Sun-Favored',
    });
  });
});

describe('formatExternalDecklist', () => {
  it('merges quantities by name', () => {
    expect(
      formatExternalDecklist([
        { name: 'Sol Ring', quantity: 1 },
        { name: 'Sol Ring', quantity: 2 },
        { name: 'Forest', quantity: 10 },
      ]),
    ).toBe('3 Sol Ring\n10 Forest');
  });

  it('places commander first without *CMDR* (use commander= query param)', () => {
    expect(
      formatExternalDecklist(
        [
          { name: 'Sol Ring', quantity: 1 },
          { name: 'Pantlaza, Sun-Favored', quantity: 1 },
        ],
        'Pantlaza, Sun-Favored',
      ),
    ).toBe('1 Pantlaza, Sun-Favored\n1 Sol Ring');
  });

  it('adds commander line even when missing from entries', () => {
    expect(
      formatExternalDecklist([{ name: 'Sol Ring', quantity: 1 }], 'Atraxa, Praetors\' Voice'),
    ).toBe("1 Atraxa, Praetors' Voice\n1 Sol Ring");
  });

  it('skips blank names and non-positive quantities', () => {
    expect(
      formatExternalDecklist([
        { name: '  ', quantity: 1 },
        { name: 'Sol Ring', quantity: 0 },
        { name: 'Cultivate', quantity: 1 },
      ]),
    ).toBe('1 Cultivate');
  });
});
