/** Filtering rules behind the Export Deck modal's per-collection chips. Operates on the
 *  deck text `generateDeckList` produces, so the chip counts and the exported text can
 *  never disagree. Pure and React-free — see deckExportFilter.test.ts. */

import { BASIC_LAND_NAMES } from '@/services/scryfall/client';

export interface DeckLine {
  quantity: number;
  name: string;
}

/** Parses `"9 Nazgûl"` lines. A line with no leading count is quantity 1, matching the
 *  card-count behaviour ExportModal already uses. Blank lines are dropped. */
export function parseDeckLines(text: string): DeckLine[] {
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      const match = line.match(/^(\d+)\s+(.+)/);
      if (!match) return { quantity: 1, name: line.trim() };
      return { quantity: parseInt(match[1], 10), name: match[2].trim() };
    });
}

/** Card name → the collections holding it, across every binder. Same shape as
 *  getCollectionBinderEntries returns. */
export type BinderEntries = Map<string, { id: string; name: string }[]>;

export type ExportTarget =
  | { kind: 'all' }
  | { kind: 'collection'; binderId: string }
  | { kind: 'missing' };

/** Stable identity for a target — for React keys and active-chip comparison. */
export function targetKey(target: ExportTarget): string {
  return target.kind === 'collection' ? `collection:${target.binderId}` : target.kind;
}

function frontFace(name: string): string {
  return name.includes(' // ') ? name.split(' // ')[0] : name;
}

/** The collections holding this card. Falls back to the front face so EDHREC-style
 *  front-face-only names match, the same rule getCollectionNameSet uses. */
function bindersFor(name: string, entries: BinderEntries): { id: string; name: string }[] {
  return entries.get(name) ?? entries.get(frontFace(name)) ?? [];
}

/** Basics are owned-by-default in the deck view (see isCardOwned in DeckDisplay), so they
 *  belong to neither a collection chip nor the missing chip. */
function isBasic(name: string): boolean {
  return BASIC_LAND_NAMES.has(frontFace(name));
}

export function matchesTarget(line: DeckLine, target: ExportTarget, entries: BinderEntries): boolean {
  if (target.kind === 'all') return true;
  const holders = bindersFor(line.name, entries);
  if (target.kind === 'collection') return holders.some(h => h.id === target.binderId);
  return holders.length === 0 && !isBasic(line.name);
}
