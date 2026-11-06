// src/components/deck/optimizer/dashboard/launchpad/panelArt.ts
//
// The faint art behind the job panel: a card the picked job is about, so the backdrop changes with the
// job instead of repeating the commander the hero already shows.
import type { ScryfallCard } from '@/types';
import { getCachedCard } from '@/services/scryfall/client';
import { JOBS, type JobId } from './jobs';
import type { LaunchPadDeps } from './types';

const artOf = (c?: ScryfallCard) => c?.image_uris?.art_crop ?? c?.card_faces?.[0]?.image_uris?.art_crop;
const isLand = (c: ScryfallCard) => c.type_line.toLowerCase().includes('land');
const isBasic = (c: ScryfallCard) => c.type_line.toLowerCase().includes('basic');

/** Names worth showing for a job, best first. Cards the deck doesn't hold resolve through the card cache. */
function candidates(job: JobId, d: LaunchPadDeps, cheaperNames: string[], newCardNames: string[]): string[] {
  switch (job) {
    case 'upgrades': return d.pairs.flatMap(p => [p.in.name, p.out.name]);
    case 'new': return newCardNames;
    case 'mana': {
      const pick = d.baseSwaps?.additions.find(a => (a.primaryType ?? '').toLowerCase().includes('land'));
      return [...(pick ? [pick.name] : []), ...d.cards.filter(c => isLand(c) && !isBasic(c)).map(c => c.name)];
    }
    case 'cheaper':
      return cheaperNames;
    case 'balance': {
      const short = (d.analysis.roleBreakdowns ?? []).find(r => r.target > 0 && r.current < r.target);
      return short?.suggestedReplacements.map(r => r.name) ?? [];
    }
    case 'power': {
      const b = d.bracketEstimation?.breakdown;
      return b ? [...b.gameChangerNames, ...b.extraTurnNames, ...b.massLandDenialNames, ...b.fastManaNames] : [];
    }
  }
}

export function pickPanelArt(job: JobId, d: LaunchPadDeps, cheaperNames: string[], newCardNames: string[]): string | undefined {
  const inDeck = new Map(d.cards.map(c => [c.name, c]));
  for (const name of candidates(job, d, cheaperNames, newCardNames)) {
    const url = artOf(inDeck.get(name) ?? getCachedCard(name));
    if (url) return url;
  }
  // Nothing job-specific: a nonland from the deck, picked by job so each one still looks different.
  const pool = d.cards.filter(c => !isLand(c) && c.name !== d.commander.name && artOf(c));
  return pool.length ? artOf(pool[(JOBS.findIndex(j => j.id === job) * 7) % pool.length]) : undefined;
}
