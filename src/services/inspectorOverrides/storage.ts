import type { Pacing } from '@/types';
import type { ThemeRef } from '@/services/lists/listThemes';

// The four Inspector "Adjust" controls — themes, tempo, land target, deck size —
// persisted per deck so a reload (or a trip through another page) doesn't drop
// them back to whatever auto-detection guessed.
//
// Keyed by `inspectorOverrideRef`: the user list's id when the deck is saved,
// otherwise a commander-scoped key. Themes in particular are commander-specific,
// so a single shared "generated" slot would leak one build's picks onto the next.
//
// Saved decks keep `list.themes` as the source of truth for the theme pair (the
// deck view writes it too, via persistListThemes). The copy stored here is only
// consulted for unsaved decks — but `themesTouched` is authoritative for BOTH,
// because it is the only record that a user who cleared every theme meant it.

const STORAGE_KEY = 'mtg-inspector-overrides-v1';

/** Bounds total storage — least-recently-touched decks are evicted first. */
const MAX_DECKS = 25;

const PACING_VALUES: readonly Pacing[] = ['aggressive-early', 'fast-tempo', 'balanced', 'midrange', 'late-game'];

export interface InspectorOverrides {
  /** True once the user has touched the theme picker, INCLUDING clearing it to
   *  none. Without it, "I want no themes" is indistinguishable from "I never
   *  chose", and a re-analysis re-applies the auto-detected guess. */
  themesTouched?: boolean;
  /** [0] = primary, [1] = secondary. Only read for decks with no saved list. */
  themes?: ThemeRef[];
  pacing?: Pacing | null;
  landTarget?: number | null;
  deckSize?: number | null;
  /** Eviction ordering only. */
  updatedAt?: number;
}

type OverridesMap = Record<string, InspectorOverrides>;

/** Stable per-deck key. Saved decks use their list id; unsaved (generated or
 *  pasted) decks fall back to their commander, which is the granularity that
 *  actually matters for themes. */
export function inspectorOverrideRef(
  sourceListId: string | undefined,
  commanderName: string,
  partnerCommanderName?: string,
): string {
  if (sourceListId) return sourceListId;
  return `unsaved:${[commanderName, partnerCommanderName].filter(Boolean).join('+')}`;
}

function isThemeRef(value: unknown): value is ThemeRef {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<ThemeRef>;
  return typeof t.name === 'string' && typeof t.slug === 'string';
}

/** Coerces one stored record to the current shape, dropping anything that
 *  doesn't fit. A malformed blob costs the user their overrides, not a crash. */
function sanitize(value: unknown): InspectorOverrides | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: InspectorOverrides = {};

  if (v.themesTouched === true) out.themesTouched = true;
  if (Array.isArray(v.themes)) {
    const themes = v.themes.filter(isThemeRef).slice(0, 2);
    if (themes.length > 0) out.themes = themes;
  }
  if (typeof v.pacing === 'string' && (PACING_VALUES as readonly string[]).includes(v.pacing)) {
    out.pacing = v.pacing as Pacing;
  }
  if (typeof v.landTarget === 'number' && Number.isFinite(v.landTarget)) out.landTarget = v.landTarget;
  if (typeof v.deckSize === 'number' && Number.isFinite(v.deckSize)) out.deckSize = v.deckSize;
  if (typeof v.updatedAt === 'number') out.updatedAt = v.updatedAt;

  return out;
}

/** A record with nothing but bookkeeping left is dropped rather than stored, so
 *  resetting every control back to auto leaves no trace behind. */
function isEmpty(o: InspectorOverrides): boolean {
  return !o.themesTouched && o.pacing == null && o.landTarget == null && o.deckSize == null;
}

function readMap(): OverridesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const out: OverridesMap = {};
    for (const [ref, record] of Object.entries(parsed as Record<string, unknown>)) {
      const clean = sanitize(record);
      if (clean && !isEmpty(clean)) out[ref] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: OverridesMap): void {
  try {
    const refs = Object.keys(map);
    let pruned = map;

    if (refs.length > MAX_DECKS) {
      const keep = refs
        .sort((a, b) => (map[b].updatedAt ?? 0) - (map[a].updatedAt ?? 0))
        .slice(0, MAX_DECKS);
      pruned = Object.fromEntries(keep.map(ref => [ref, map[ref]]));
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Quota exceeded or storage unavailable (private mode). The overrides are a
    // convenience — degrade to in-memory rather than surfacing an error.
  }
}

export function loadInspectorOverrides(ref: string): InspectorOverrides {
  return readMap()[ref] ?? {};
}

/** False when every control is still on auto — i.e. nothing worth carrying. */
export function hasInspectorOverrides(o: InspectorOverrides): boolean {
  return !isEmpty(o);
}

/** Merges `patch` over whatever is stored. Pass an explicit null to clear one
 *  control back to auto without disturbing the others. */
export function saveInspectorOverrides(ref: string, patch: Partial<InspectorOverrides>): void {
  const map = readMap();
  const next: InspectorOverrides = { ...(map[ref] ?? {}), ...patch, updatedAt: Date.now() };

  if (isEmpty(next)) {
    if (!(ref in map)) return;
    delete map[ref];
  } else {
    map[ref] = next;
  }
  writeMap(map);
}

export function dropInspectorOverrides(ref: string): void {
  const map = readMap();
  if (!(ref in map)) return;
  delete map[ref];
  writeMap(map);
}
