/** Filtering rules behind the Export Deck modal's per-collection chips. Operates on the
 *  deck text `generateDeckList` produces, so the chip counts and the exported text can
 *  never disagree. Pure and React-free — see deckExportFilter.test.ts. */

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
