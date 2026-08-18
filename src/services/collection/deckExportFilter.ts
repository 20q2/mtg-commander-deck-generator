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

export interface ExportChip {
  target: ExportTarget;
  label: string;
  /** Sum of deck quantities matching this target. */
  count: number;
}

/** Collection chips sorted by count desc (matching the stats-bar Owned popover order),
 *  then the missing chip. Zero-count chips are omitted. Returns [] outright when no
 *  collection chip survives, so a lone missing chip — which would just be the whole deck
 *  under a confusing label — never renders. Does NOT include the "Full deck" chip; the
 *  caller prepends that. */
export function buildExportChips(lines: DeckLine[], entries: BinderEntries | null): ExportChip[] {
  if (!entries || entries.size === 0) return [];

  const counts = new Map<string, { id: string; name: string; count: number }>();
  let missing = 0;

  for (const line of lines) {
    const holders = bindersFor(line.name, entries);
    if (holders.length > 0) {
      for (const h of holders) {
        const cur = counts.get(h.id);
        if (cur) cur.count += line.quantity;
        else counts.set(h.id, { id: h.id, name: h.name, count: line.quantity });
      }
    } else if (!isBasic(line.name)) {
      missing += line.quantity;
    }
  }

  const collections = [...counts.values()].sort((a, b) => b.count - a.count);
  if (collections.length === 0) return [];

  const chips: ExportChip[] = collections.map(c => ({
    target: { kind: 'collection', binderId: c.id },
    label: c.name,
    count: c.count,
  }));
  if (missing > 0) {
    chips.push({ target: { kind: 'missing' }, label: 'Not in a collection', count: missing });
  }
  return chips;
}
