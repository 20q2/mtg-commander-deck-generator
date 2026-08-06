/**
 * Inbound deck URLs for external sites ("Export to ManaFoundry").
 *
 *   /decks/create?c=<list>&commander=<name>&name=<optional>
 *   /analyze?c=<list>&commander=<name>
 *
 * `c` is a plain qty-Name decklist. Prefer `commander=` for the commander;
 * `*CMDR*` / Goldfish section headers in the list still work as fallbacks.
 */

export interface ExternalDecklistPayload {
  decklist: string;
  name?: string;
  commander?: string;
}

export interface FormatExternalEntry {
  name: string;
  quantity: number;
}

function trimParam(value: string | null): string | undefined {
  const t = value?.trim();
  return t || undefined;
}

/** Parse `?c=` (+ optional `commander` / `name`). Null if `c` is missing or blank. */
export function readExternalDecklist(
  params: URLSearchParams,
): ExternalDecklistPayload | null {
  const decklist = params.get('c')?.trim();
  if (!decklist) return null;
  const name = trimParam(params.get('name'));
  const commander = trimParam(params.get('commander'));
  return {
    decklist,
    ...(name ? { name } : {}),
    ...(commander ? { commander } : {}),
  };
}

export interface BuildExternalUrlOptions {
  name?: string;
  commander?: string;
  /** Defaults to `window.location.origin` when available. */
  origin?: string;
}

function resolveOrigin(origin?: string): string {
  if (origin != null) return origin.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

function buildUrl(
  path: string,
  decklist: string,
  opts: { name?: string; commander?: string },
): string {
  const q = new URLSearchParams();
  q.set('c', decklist);
  if (opts.commander?.trim()) q.set('commander', opts.commander.trim());
  if (opts.name?.trim()) q.set('name', opts.name.trim());
  return `${path}?${q.toString()}`;
}

export function buildCreateDeckUrl(
  decklist: string,
  opts: BuildExternalUrlOptions = {},
): string {
  return `${resolveOrigin(opts.origin)}${buildUrl('/decks/create', decklist, opts)}`;
}

export function buildAnalyzeDeckUrl(
  decklist: string,
  opts: BuildExternalUrlOptions = {},
): string {
  return `${resolveOrigin(opts.origin)}${buildUrl('/analyze', decklist, { commander: opts.commander })}`;
}

/** Merge qty by name; optional commander is listed first (for the `c` body only). */
export function formatExternalDecklist(
  entries: FormatExternalEntry[],
  commanderName?: string,
): string {
  const byName = new Map<string, number>();
  for (const { name, quantity } of entries) {
    const trimmed = name.trim();
    if (!trimmed || quantity <= 0) continue;
    byName.set(trimmed, (byName.get(trimmed) ?? 0) + quantity);
  }

  const commander = commanderName?.trim();
  const lines: string[] = [];

  if (commander) {
    const qty = byName.get(commander) ?? 1;
    byName.delete(commander);
    lines.push(`${qty} ${commander}`);
  }

  for (const [name, quantity] of byName) {
    lines.push(`${quantity} ${name}`);
  }

  return lines.join('\n');
}
