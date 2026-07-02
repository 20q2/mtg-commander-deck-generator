import { describe, it, expect } from 'vitest';
import { parseCardDropUrl } from './parseCardDropUrl';

describe('parseCardDropUrl', () => {
  it('parses an EDHREC card URL into a de-hyphenated name query', () => {
    expect(parseCardDropUrl('https://edhrec.com/cards/claim-the-kingdom'))
      .toEqual({ kind: 'name', query: 'claim the kingdom' });
  });

  it('accepts www. and other subdomains', () => {
    expect(parseCardDropUrl('https://www.edhrec.com/cards/sol-ring'))
      .toEqual({ kind: 'name', query: 'sol ring' });
  });

  it('parses a Scryfall card page URL from its slug segment', () => {
    expect(parseCardDropUrl('https://scryfall.com/card/isd/236/witchbane-orb'))
      .toEqual({ kind: 'name', query: 'witchbane orb' });
  });

  it('parses a Scryfall card image URL into a scryfall id', () => {
    expect(parseCardDropUrl('https://cards.scryfall.io/large/front/1/d/1dcc1e46-96f9-4918-9e6a-999999999999.jpg?1562404626'))
      .toEqual({ kind: 'scryfallId', id: '1dcc1e46-96f9-4918-9e6a-999999999999' });
  });

  it('returns null for a Scryfall symbol SVG (non-UUID filename)', () => {
    expect(parseCardDropUrl('https://svgs.scryfall.io/card-symbols/W.svg')).toBeNull();
  });

  it('parses a Moxfield card URL (best-effort)', () => {
    expect(parseCardDropUrl('https://www.moxfield.com/cards/arcane-signet'))
      .toEqual({ kind: 'name', query: 'arcane signet' });
  });

  it('takes the first non-comment line of a text/uri-list payload', () => {
    const uriList = '# comment line\r\nhttps://edhrec.com/cards/rhystic-study\r\n';
    expect(parseCardDropUrl(uriList)).toEqual({ kind: 'name', query: 'rhystic study' });
  });

  it('returns null for an EDHREC commander page', () => {
    expect(parseCardDropUrl('https://edhrec.com/commanders/atraxa-praetors-voice')).toBeNull();
  });

  it('returns null for an unrelated URL', () => {
    expect(parseCardDropUrl('https://example.com/whatever')).toBeNull();
  });

  it('returns null for malformed / empty input', () => {
    expect(parseCardDropUrl('not a url')).toBeNull();
    expect(parseCardDropUrl('')).toBeNull();
    expect(parseCardDropUrl(null)).toBeNull();
    expect(parseCardDropUrl(undefined)).toBeNull();
  });

  it('decodes percent-encoded slugs', () => {
    expect(parseCardDropUrl('https://scryfall.com/card/dmu/1/sample%20card'))
      .toEqual({ kind: 'name', query: 'sample card' });
  });
});
