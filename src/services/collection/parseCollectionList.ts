export interface ParsedCard {
  name: string;
  quantity: number;
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
export function parseCollectionList(input: string): ParsedCard[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Detect CSV with headers (first line contains "name" column)
  const lines = trimmed.split('\n');
  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes(',') && (firstLine.includes('name') || firstLine.includes('card'))) {
    return parseCSV(lines);
  }

  // Standard text parsing
  const result: ParsedCard[] = [];
  const seen = new Set<string>();

  // Split by newlines; also handle comma-separated on single lines
  const rawLines = trimmed.split('\n');
  for (const rawLine of rawLines) {
    // If a line has commas and no quantity prefix, treat commas as separators
    const segments = rawLine.includes(',') && !/^\d/.test(rawLine.trim())
      ? rawLine.split(',')
      : [rawLine];

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

      // Strip MTGA set/collector suffix: "(M21) 123" or "(DMU) 45"
      cardName = cardName.replace(/\s*\([A-Z0-9]+\)\s*\d+\s*$/, '').trim();

      if (cardName && !seen.has(cardName.toLowerCase())) {
        seen.add(cardName.toLowerCase());
        result.push({ name: cardName, quantity });
      }
    }
  }

  return result;
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

    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      result.push({ name, quantity });
    }
  }

  return result;
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
