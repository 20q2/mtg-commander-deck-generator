/** Decklist text in the shapes other deckbuilders expect. Each formatter rewrites the plain
 *  `<qty> <name>` list `generateDeckList` produces, so every format shows the same cards.
 *
 *  ── MTG Arena ──
 *  Arena's importer reads keyword section lines — an optional `About` / `Name <deck>` block,
 *  then `Commander`, then `Deck` — followed by `<qty> <name>` rows. Without the `Commander`
 *  section Arena treats the commander as one of the 99 and rejects the deck, which is why a
 *  plain list has to be hand-edited after every copy.
 *
 *  Set codes and collector numbers are deliberately omitted. Arena accepts
 *  `1 Fabled Passage (M21) 246`, but supplying a printing pins the import to that exact
 *  printing: Arena then stops matching the copies the player already owns from another set
 *  and reports them as missing, asking for wildcards it doesn't need. Name-only lets Arena
 *  take the newest printing, then fall back to older ones in the collection. Moxfield's
 *  "Copy for MTGA" omits them for the same reason.
 *
 *  ── Moxfield ──
 *  The mirror image: every line carries `(SET) <collector number>`, which is how Moxfield
 *  exports and what makes a paste land on the exact printings rather than whatever Moxfield
 *  picks by default. Here that is a feature, not the Arena trap — it pins the printings this
 *  deck was actually costed with, so the price in Moxfield matches the price we quoted.
 */

import { parseDeckLines, type DeckLine } from '@/services/collection/deckExportFilter';
import { frontFaceName } from '@/services/scryfall/client';

export interface ArenaExportOptions {
  /** Becomes the `Name` line so the deck arrives in Arena already named. Omitted → no About block. */
  deckName?: string;
  /** Names routed to the `Commander` section. Paper names are fine — matching is front-face. */
  commanderNames?: string[];
}

/** Sum duplicate rows, under each format's spelling of the name, so a card never occupies
 *  two lines. Moxfield's own exports emit one line per printing — `43 Forest` + `4 Forest` —
 *  and we don't inherit that. `toName` is the per-format rewrite: Arena knows a DFC only by
 *  its front face ("Agadeem's Awakening"), Moxfield writes both ("A / B"). */
function mergeRows(lines: DeckLine[], toName: (name: string) => string): DeckLine[] {
  const merged = new Map<string, DeckLine>();
  for (const line of lines) {
    const name = toName(line.name);
    const existing = merged.get(name);
    if (existing) existing.quantity += line.quantity;
    else merged.set(name, { quantity: line.quantity, name });
  }
  return [...merged.values()];
}

/** Moxfield separates DFC faces with a single slash, Scryfall with a double. */
function moxfieldName(name: string): string {
  return name.replace(' // ', ' / ');
}

/** Rewrites deck text (the `<qty> <name>` form `generateDeckList` produces) as an Arena
 *  import block. Pure — the Arena card pool is not consulted here; callers that want to warn
 *  about cards Arena doesn't have check `getArenaLegalNames` separately. */
export function formatForArena(deckListText: string, options: ArenaExportOptions = {}): string {
  const { deckName, commanderNames = [] } = options;
  const commanderKeys = new Set(commanderNames.map(frontFaceName));

  const rows = mergeRows(parseDeckLines(deckListText), frontFaceName);
  const commanders = rows.filter(r => commanderKeys.has(r.name));
  const deck = rows.filter(r => !commanderKeys.has(r.name));

  const render = (rs: DeckLine[]) => rs.map(r => `${r.quantity} ${r.name}`).join('\n');

  const sections: string[] = [];
  if (deckName?.trim()) sections.push(`About\nName ${deckName.trim()}`);
  if (commanders.length > 0) sections.push(`Commander\n${render(commanders)}`);
  if (deck.length > 0) sections.push(`Deck\n${render(deck)}`);
  return sections.join('\n\n');
}

/** The printing a card is being shown and priced as: Scryfall's `set` and `collector_number`
 *  for the copy in the deck, keyed by card name. */
export type PrintingMap = Map<string, { set: string; collectorNumber: string }>;

/** Rewrites deck text as a Moxfield paste, every line pinned to its printing:
 *  `1 Bloodstained Mire (MH3) 216`. A card whose printing we don't have falls back to a bare
 *  `<qty> <name>` line — Moxfield still imports it, just at its own default printing, which
 *  beats dropping the card or inventing a set code. */
export function formatForMoxfield(deckListText: string, printings: PrintingMap = new Map()): string {
  return mergeRows(parseDeckLines(deckListText), moxfieldName)
    .map(row => {
      // The map is keyed by the Scryfall name, so undo the single-slash rewrite to look up.
      const printing = printings.get(row.name.replace(' / ', ' // ')) ?? printings.get(row.name);
      return printing
        ? `${row.quantity} ${row.name} (${printing.set.toUpperCase()}) ${printing.collectorNumber}`
        : `${row.quantity} ${row.name}`;
    })
    .join('\n');
}
