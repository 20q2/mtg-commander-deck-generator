// Maps a WUBRG-sorted color-identity string to its guild/shard/wedge background
// name. Ported from the original SpellChroma; art lives in public/spellchroma-backgrounds/.
const GUILD_BY_IDENTITY: Record<string, string> = {
  WBG: 'abzan', WU: 'azorius', WUG: 'bant', WR: 'boros', UB: 'dimir',
  WBRG: 'dune-brood', WUB: 'esper', G: 'forest', UBRG: 'glint-eye',
  BG: 'golgari', UBR: 'grixis', RG: 'gruul', WURG: 'ink-treader',
  U: 'island', UR: 'izzet', WUR: 'jeskai', BRG: 'jund', WBR: 'mardu',
  R: 'mountain', WRG: 'naya', WB: 'orzhov', W: 'plains', BR: 'rakdos',
  WG: 'selesnya', UG: 'simic', UBG: 'sultai', B: 'swamp', URG: 'temur',
  WUBG: 'witch-maw', WUBR: 'yore-tiller', WUBRG: 'wubrg', '': 'wastes',
};

const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'];

/** Public URL of a SpellChroma backdrop art by its file name (no extension). */
export function artUrl(name: string): string {
  return `${import.meta.env.BASE_URL}spellchroma-backgrounds/${name}.webp`;
}

/** Public URL of the backdrop art for a color identity (falls back to wastes). */
export function backgroundUrlForIdentity(colors: string[]): string {
  const set = new Set(colors);
  const key = WUBRG_ORDER.filter(c => set.has(c)).join('');
  const name = GUILD_BY_IDENTITY[key] ?? 'wastes';
  return artUrl(name);
}

export interface ArtBackground {
  name: string;
  label: string;
}

/**
 * All SpellChroma art backgrounds in a browsable order: colorless → mono →
 * guilds (2c) → shards & wedges (3c) → nephilim (4c) → 5-color. Shared by the
 * settings picker and the background resolver so there's one source of truth.
 */
export const ART_BACKGROUNDS: ArtBackground[] = [
  { name: 'wastes', label: 'Wastes' },
  // Mono
  { name: 'plains', label: 'Plains' },
  { name: 'island', label: 'Island' },
  { name: 'swamp', label: 'Swamp' },
  { name: 'mountain', label: 'Mountain' },
  { name: 'forest', label: 'Forest' },
  // Guilds
  { name: 'azorius', label: 'Azorius' },
  { name: 'dimir', label: 'Dimir' },
  { name: 'rakdos', label: 'Rakdos' },
  { name: 'gruul', label: 'Gruul' },
  { name: 'selesnya', label: 'Selesnya' },
  { name: 'orzhov', label: 'Orzhov' },
  { name: 'izzet', label: 'Izzet' },
  { name: 'golgari', label: 'Golgari' },
  { name: 'boros', label: 'Boros' },
  { name: 'simic', label: 'Simic' },
  // Shards & wedges
  { name: 'bant', label: 'Bant' },
  { name: 'esper', label: 'Esper' },
  { name: 'grixis', label: 'Grixis' },
  { name: 'jund', label: 'Jund' },
  { name: 'naya', label: 'Naya' },
  { name: 'abzan', label: 'Abzan' },
  { name: 'jeskai', label: 'Jeskai' },
  { name: 'sultai', label: 'Sultai' },
  { name: 'mardu', label: 'Mardu' },
  { name: 'temur', label: 'Temur' },
  // Nephilim (4c)
  { name: 'yore-tiller', label: 'Yore-Tiller' },
  { name: 'glint-eye', label: 'Glint-Eye' },
  { name: 'dune-brood', label: 'Dune-Brood' },
  { name: 'ink-treader', label: 'Ink-Treader' },
  { name: 'witch-maw', label: 'Witch-Maw' },
  // 5-color
  { name: 'wubrg', label: '5-Color' },
];
