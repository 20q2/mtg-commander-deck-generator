/**
 * LIVE DIAGNOSTIC — skipped by default because it hits EDHREC and Scryfall. Run with:
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/deckBuilder/__tests__/liveDetection.diag.test.ts
 *
 * (VITE_-prefixed so it reaches import.meta.env; the repo's tsconfig has no @types/node, so
 * process.env is not available here.)
 *
 * Runs real EDHREC data through the real detectThemes against a deck whose correct answer we know,
 * and prints the full ranking. This is the only end-to-end check of the detection composite we have;
 * every other test in the suite covers pure functions in isolation and cannot see wiring problems.
 *
 * Two limits to respect:
 *  - There is no SpellChroma oracle-tag index here, so ARCHETYPE themes find no members and show
 *    `members=0 basis=none`. Only deterministic kinds (mechanic/tribal/subtype/...) are exercised.
 *  - The fixture deck is EDHREC-generated, so it overlaps its commander's theme pages almost
 *    completely. A hand-brewed deck overlaps far less.
 */
import { describe, it, expect } from 'vitest';
import { buildThemeModel, scoreThemesForDeck, loadThemeCharTags, survivingThemes } from '@/services/themes';
import { detectThemes } from '../themeDetector';
import { parseTagsIndex } from '@/services/edhrec/client';
import type { EDHRECCommanderData, EDHRECTag, EDHRECTheme, ScryfallCard } from '@/types';
import type { MtgCatalogs } from '@/services/scryfall/client';

const H = { 'User-Agent': 'ManaFoundry/1.0', Accept: 'application/json' };
const COMMANDER = 'Toph, Hardheaded Teacher';
const SLUG = 'toph-hardheaded-teacher';

const DECK = `Toph, Hardheaded Teacher|Avatar Kyoshi, Earthbender|Avenger of Zendikar|Azusa, Lost but Seeking|Badgermole|Badgermole Cub|Bristly Bill, Spine Sower|Bumi, Eclectic Earthbender|Bumi, Unleashed|Disciple of Freyalise|Earthbending Student|Embodiment of Insight|Evolution Sage|Horizon Explorer|Icetill Explorer|Loot, Exuberant Explorer|Meltstrider Eulogist|Moraug, Fury of Akoum|Mossborn Hydra|Omnath, Locus of Rage|Raggadragga, Goreguts Boss|Sabotender|Scute Swarm|Tannuk, Memorial Ensign|Toph, Earthbending Master|Toph, Greatest Earthbender|Toph, the Blind Bandit|Traveling Chocobo|Tunneling Geopede|Banner of Kinship|Skullclamp|Sol Ring|The Earth Crystal|Bitter Work|Earthbender Ascension|Goblin Bombardment|Hardened Scales|Spelunking|Terrasymbiosis|The Legend of Kyoshi|Beast Within|Chaos Warp|Deflecting Swat|Fling|Heroic Intervention|Inspiring Call|Krosan Grip|Lightning Bolt|Naturalize|Origin of Metalbending|Overwhelming Victory|Redirect Lightning|Return of the Wildspeaker|Rocky Rebuke|Tamiyo's Safekeeping|Thrill of Possibility|Cracked Earth Technique|Decimate|Earth Rumble|Earthbending Lesson|Explore|Harmonize|Rampant Growth|Rishkar's Expertise|Shared Roots|Ba Sing Se|Cinder Glade|Command Beacon|Command Tower|Commercial District|Darksteel Citadel|Evolving Wilds|Fabled Passage|Lotus Field|Myriad Landscape|Reliquary Tower|Rootbound Crag|Rumble Arena|Stomping Ground|Wooded Foothills|Yavimaya, Cradle of Growth`.split('|');

const pct = (c: { num_decks?: number; potential_decks?: number }) =>
  c.potential_decks && c.potential_decks > 0 ? ((c.num_decks ?? 0) / c.potential_decks) * 100 : 0;

/** EDHREC page → the cardlists shape scoreThemeMatch consumes. */
async function page(url: string): Promise<EDHRECCommanderData | null> {
  const res = await fetch(url, { headers: H });
  if (!res.ok) return null;
  const j = await res.json();
  const lists = j.container?.json_dict?.cardlists ?? [];
  const allNonLand: unknown[] = [];
  const lands: unknown[] = [];
  for (const l of lists) {
    if (/^(new commanders|top commanders)$/i.test(l.header)) continue;
    const bucket = /land/i.test(l.header) ? lands : allNonLand;
    for (const c of l.cardviews) {
      bucket.push({ name: c.name, inclusion: pct(c), synergy: c.synergy ?? 0 });
    }
  }
  return { themes: [], stats: {}, cardlists: { allNonLand, lands }, similarCommanders: [] } as unknown as EDHRECCommanderData;
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('live detection diagnostic', () => {
  it('ranks the Toph landfall deck', async () => {
    // Deck cards from Scryfall (two batches — /collection caps at 75).
    const cards: ScryfallCard[] = [];
    for (let i = 0; i < DECK.length; i += 70) {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: DECK.slice(i, i + 70).map(name => ({ name })) }),
      });
      const j = await res.json();
      cards.push(...(j.data ?? []));
    }
    expect(cards.length).toBeGreaterThan(60);

    const base = await (await fetch(`https://json.edhrec.com/pages/commanders/${SLUG}.json`, { headers: H })).json();
    const commanderThemes: EDHRECTheme[] = (base.panels?.taglinks ?? [])
      .map((t: { value: string; slug?: string; href?: string }) => ({
        name: t.value,
        slug: t.slug ?? (t.href ?? '').split('/').pop() ?? '',
        count: 0, url: '',
      }))
      .filter((t: EDHRECTheme) => t.slug);

    // parseTagsIndex, not hand-rolled: in tags.json the cardview `.slug` field is a representative
    // CARD's slug ("Tokens" -> "skullclamp"), and the tag's real slug lives only in `.url`. Parsing
    // it by hand keyed every model to a card name, which silently zeroed the membership signal.
    const rawTags = await (await fetch('https://json.edhrec.com/pages/tags.json', { headers: H })).json();
    const tags: EDHRECTag[] = parseTagsIndex(rawTags);

    const cat = async (n: string) => ((await (await fetch(`https://api.scryfall.com/catalog/${n}`, { headers: H })).json()).data ?? []) as string[];
    const [abil, act, words, ctypes, atypes, etypes] = await Promise.all([
      cat('keyword-abilities'), cat('keyword-actions'), cat('ability-words'),
      cat('creature-types'), cat('artifact-types'), cat('enchantment-types'),
    ]);
    const catalogs: MtgCatalogs = {
      mechanics: new Set([...abil, ...act, ...words].map(s => s.toLowerCase())),
      creatureTypes: new Set(ctypes.map(s => s.toLowerCase())),
      permanentSubtypes: new Set([...atypes, ...etypes].map(s => s.toLowerCase())),
    };

    const table = loadThemeCharTags();
    const models = tags.map(t => buildThemeModel(t, catalogs, table.themes, new Set(table.forceArchetype ?? [])));
    // NOTE: no SpellChroma tag index here, so archetype themes find no members. Deterministic
    // kinds (mechanic/tribal/...) are unaffected — Landfall is a mechanic, which is the point.
    const scored = scoreThemesForDeck(cards, models, () => [], new Set(commanderThemes.map(t => t.slug)));
    const membership = new Map(scored.map(s => [s.model.slug, s]));

    console.log('\ncommander themes:', commanderThemes.map(t => t.slug).join(', ') || '(none parsed)');
    console.log('\nclassifier survivors (top 8):');
    for (const s of survivingThemes(scored).slice(0, 8)) {
      console.log(`  ${s.model.name.padEnd(24)} ${s.model.kind.kind.padEnd(12)} score=${s.membershipScore.toFixed(1).padStart(6)} members=${String(s.members).padStart(3)} conf=${s.confidence}%`);
    }

    const shortlist = [
      ...commanderThemes.slice(0, 8),
      ...survivingThemes(scored)
        .filter(s => !commanderThemes.slice(0, 8).some(t => t.slug === s.model.slug))
        .slice(0, 6)
        .map(s => ({ name: s.model.name, slug: s.model.slug, count: s.model.numDecks, url: '' })),
    ];
    const themeDataMap = new Map<string, EDHRECCommanderData>();
    for (const t of shortlist) {
      const d = await page(`https://json.edhrec.com/pages/commanders/${SLUG}/${t.slug}.json`)
        ?? await page(`https://json.edhrec.com/pages/tags/${t.slug}.json`);
      if (d) themeDataMap.set(t.slug, d);
    }
    console.log(`\nshortlist ${shortlist.length}, pages resolved ${themeDataMap.size}`);

    const detection = detectThemes(shortlist, themeDataMap, cards, [], COMMANDER, membership);
    console.log('\nDETECTED:', detection.matchedThemes.map(m => `${m.theme.name} (${m.score})`).join(' + ') || '(none)');
    console.log('confident:', detection.isConfident);
    console.log('\nfull ranking:');
    for (const e of detection.evaluatedThemes.slice(0, 12)) {
      console.log(`  ${e.theme.name.padEnd(24)} score=${String(e.score).padStart(5)} overlap=${String(e.cardOverlap).padStart(3)} members=${String(e.memberCount).padStart(3)} basis=${e.basis}`);
    }
    expect(detection.evaluatedThemes.length).toBeGreaterThan(0);
  }, 180000);
});
