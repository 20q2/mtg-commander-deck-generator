export interface ParsedCard {
  name: string;
  quantity: number;
  isCommander?: boolean;
}

export interface ParsedCollectionResult {
  cards: ParsedCard[];
  meta?: {
    deckName?: string;
  };
}

/**
 * Parse a collection list from text input.
 * Supports:
 * - One card per line: "Sol Ring"
 * - Quantity prefix: "4 Lightning Bolt" or "4x Lightning Bolt"
 * - MTGA format: "4 Lightning Bolt (M21) 123" (set + collector number stripped)
 * - CSV with headers: detects "Name" and "Quantity" columns
 * - Comma-separated: "Sol Ring, Mana Crypt"
 * - Comments: lines starting with // or #
 */
export function parseCollectionList(input: string): ParsedCollectionResult {
  const trimmed = input.trim();
  if (!trimmed) return { cards: [] };

  // Detect CSV with headers (first line contains "name" column)
  const lines = trimmed.split('\n');
  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes(',') && (firstLine.includes('name') || firstLine.includes('card'))) {
    return { cards: parseCSV(lines) };
  }

  // Detect MTGGoldfish / section-based format (has "Commander" + "Deck" headers)
  if (isGoldfishSectionFormat(lines)) {
    return parseGoldfishSections(lines);
  }

  // Standard text parsing
  const result: ParsedCard[] = [];
  const seen = new Set<string>();

  // Split by newlines; only comma-split if the entire input is a single line
  const rawLines = trimmed.split('\n');
  const isMultiLine = rawLines.filter(l => l.trim()).length > 1;

  for (const rawLine of rawLines) {
    // Only treat commas as separators for single-line input with no quantity prefix
    // Multi-line input always uses newlines (card names like "Lutri, the Spellchaser" have commas)
    let segments: string[];
    if (!isMultiLine && rawLine.includes(',') && !/^\d/.test(rawLine.trim())) {
      // Only comma-split when there are 2+ commas (3+ parts), since MTG card names
      // can contain one comma (e.g. "Korvold, Fae-Cursed King") but never two.
      const parts = rawLine.split(',');
      if (parts.length >= 3) {
        segments = [];
        for (const part of parts) {
          const t = part.trim();
          if (segments.length > 0 && t && /^[a-z]/.test(t)) {
            segments[segments.length - 1] += ', ' + t;
          } else {
            segments.push(part);
          }
        }
      } else {
        // 1 comma = likely a card name with a comma (e.g. "Lutri, the Spellchaser")
        segments = [rawLine];
      }
    } else {
      segments = [rawLine];
    }

    for (const segment of segments) {
      const line = segment.trim();
      if (!line || line.startsWith('//') || line.startsWith('#')) continue;

      // Strip quantity prefix: "4x ", "4 ", "1x"
      const match = line.match(/^(\d+)x?\s+(.+)/i);
      let quantity = 1;
      let cardName: string;

      if (match) {
        quantity = parseInt(match[1], 10) || 1;
        cardName = match[2];
      } else {
        cardName = line;
      }

      // Detect and strip *CMDR* marker
      const isCommander = /\*CMDR\*/i.test(cardName);
      cardName = cardName.replace(/\s*\*CMDR\*\s*/gi, '').trim();

      cardName = stripSuffixes(cardName);

      if (cardName && !seen.has(cardName.toLowerCase())) {
        seen.add(cardName.toLowerCase());
        result.push({ name: cardName, quantity, ...(isCommander && { isCommander: true }) });
      }
    }
  }

  return { cards: result };
}

function isGoldfishSectionFormat(lines: string[]): boolean {
  let hasCommander = false;
  let hasDeck = false;
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (t === 'commander') hasCommander = true;
    if (t === 'deck') hasDeck = true;
    if (hasCommander && hasDeck) return true;
  }
  return false;
}

function parseGoldfishSections(lines: string[]): ParsedCollectionResult {
  let deckName: string | undefined;
  let currentSection: string | null = null;
  const cards: ParsedCard[] = [];
  const seen = new Set<string>();
  const sectionHeaders = new Set(['about', 'commander', 'deck', 'sideboard', 'maybeboard']);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();

    // Check for section header
    if (sectionHeaders.has(lower)) {
      currentSection = lower;
      continue;
    }

    // Extract deck name from "Name ..." in about section
    if (currentSection === 'about' && lower.startsWith('name ')) {
      deckName = line.slice(5).trim();
      continue;
    }

    // Skip other about section lines or lines before any section
    if (currentSection === 'about' || !currentSection) continue;

    const isCommander = currentSection === 'commander';

    // Parse quantity + card name
    const match = line.match(/^(\d+)x?\s+(.+)/i);
    let quantity = 1;
    let cardName: string;

    if (match) {
      quantity = parseInt(match[1], 10) || 1;
      cardName = match[2];
    } else {
      cardName = line;
    }

    cardName = stripSuffixes(cardName);

    if (cardName && !seen.has(cardName.toLowerCase())) {
      seen.add(cardName.toLowerCase());
      cards.push({ name: cardName, quantity, ...(isCommander && { isCommander: true }) });
    }
  }

  return {
    cards,
    ...(deckName && { meta: { deckName } }),
  };
}

function parseCSV(lines: string[]): ParsedCard[] {
  if (lines.length < 2) return [];

  // Parse header to find name and quantity columns
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  const headerCount = headers.length;
  const nameIdx = headers.findIndex(h => h === 'name' || h === 'card' || h === 'card name');
  const qtyIdx = headers.findIndex(h => h === 'quantity' || h === 'qty' || h === 'count');

  if (nameIdx === -1) return [];

  const result: ParsedCard[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (handles quoted fields with commas)
    const cols = splitCSVLine(line);

    let name: string;
    let quantity: number;

    const extraCols = cols.length - headerCount;
    if (extraCols > 0) {
      // Card name contains unquoted commas — merge extra columns back into the name
      name = cols.slice(nameIdx, nameIdx + 1 + extraCols).join(',').replace(/"/g, '').trim();
      // Adjust indices for columns that come after the name
      const adjustedQtyIdx = qtyIdx > nameIdx ? qtyIdx + extraCols : qtyIdx;
      quantity = qtyIdx >= 0 ? parseInt(cols[adjustedQtyIdx]?.replace(/"/g, '').trim(), 10) || 1 : 1;
    } else {
      name = cols[nameIdx]?.replace(/"/g, '').trim();
      quantity = qtyIdx >= 0 ? parseInt(cols[qtyIdx]?.replace(/"/g, '').trim(), 10) || 1 : 1;
    }

    name = stripSuffixes(name);

    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      result.push({ name, quantity });
    }
  }

  return result;
}

/** Strip common card name suffixes: tags (*f*, *F*), set/collector codes, trailing IDs */
function stripSuffixes(cardName: string): string {
  // Strip tags like *f* (foil), *e* (etched), *s* (showcase), *F*, *Foil*, etc.
  cardName = cardName.replace(/\s*\*[a-zA-Z]+\*\s*/g, '').trim();
  // Strip set/collector suffix: "(M21) 123", "(cmr) 45", or just "(JMP)"
  cardName = cardName.replace(/\s*\([A-Za-z0-9]+\)\s*\d*\s*$/, '').trim();
  // Strip trailing collector number alone: "Sol Ring 472"
  cardName = cardName.replace(/\s+#?\d{2,}$/, '').trim();
  return cardName;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
