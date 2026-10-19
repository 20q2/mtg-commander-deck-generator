/**
 * Which of a pool of known combos does this deck actually assemble?
 *
 * This was duplicated verbatim in ListDeckView and analyzeHydration (with two
 * more partial copies in AnalyzePage and cardSwap that refreshed completeness
 * without re-deriving it). Template-aware completeness has to be identical in
 * all four or the "N complete" count disagrees with the bracket estimate, so
 * the rule lives here now and they all call it.
 *
 * Completeness means both halves: every named card is in the deck AND every
 * unnamed slot the combo needs (see templateFit.ts) is filled by something in
 * the deck. A combo whose named cards are all present but whose persist-creature
 * slot is empty is a near-miss, not a combo you can run.
 */
import type { ComboTemplateFit, DetectedCombo, EDHRECCombo, ScryfallCard } from '@/types';
import { fitTemplates } from './templateFit';

/** Deck names used for named-card matching — front faces count for split cards. */
export function buildDeckNameSet(cards: ScryfallCard[]): Set<string> {
  const names = new Set<string>();
  for (const c of cards) {
    if (!c) continue;
    names.add(c.name);
    if (c.name.includes(' // ')) names.add(c.name.split(' // ')[0]);
  }
  return names;
}

function comboCardSetKey(names: string[]): string {
  return [...names].sort().join('|');
}

/**
 * Dedupe by card set, keeping the first occurrence but inheriting templates from
 * any later duplicate.
 *
 * The same combo surfaces more than once two ways: (1) EDHREC lists a card set as
 * multiple entries differing only by a result-variant suffix in the comboId, and
 * (2) it appears on both the commander page and the color-identity page. Callers
 * list commander-source combos first so the kept copy keeps its commander
 * provenance — but only the Spellbook-backed color-identity copy carries
 * `templates`, so dropping the duplicate outright silently threw the combo's
 * unnamed slots away. That is why a Mikaeus + Phyrexian Altar deck with no
 * persist creature read as complete.
 */
function dedupeInheritingTemplates(combos: EDHRECCombo[]): EDHRECCombo[] {
  const byCardSet = new Map<string, EDHRECCombo>();
  const order: string[] = [];

  for (const combo of combos) {
    const key = comboCardSetKey(combo.cards.map(c => c.name));
    const kept = byCardSet.get(key);
    if (!kept) {
      byCardSet.set(key, combo);
      order.push(key);
      continue;
    }
    if ((!kept.templates?.length && combo.templates?.length) || (!kept.href && combo.href)) {
      byCardSet.set(key, {
        ...kept,
        templates: kept.templates?.length ? kept.templates : combo.templates,
        href: kept.href ?? combo.href,
      });
    }
  }

  return order.map(k => byCardSet.get(k)!);
}

/**
 * Merge the commander-page pool with the color-identity pool.
 *
 * Commander source wins on collision — higher provenance, and the UI badges the
 * other as "Synergy". But EDHREC's commander page carries no `templates`; only
 * the Spellbook-backed color-identity copy does. Keying purely on comboId and
 * dropping the loser therefore discarded the combo's unnamed slots BEFORE
 * detection could see them, which is why Mikaeus + Phyrexian Altar still read
 * complete in a deck with no persist creature. Inherit the slots instead.
 */
export function mergeComboPools(
  commanderCombos: EDHRECCombo[],
  colorCombos: EDHRECCombo[],
): EDHRECCombo[] {
  const byId = new Map<string, EDHRECCombo>();
  for (const c of commanderCombos) byId.set(c.comboId, c);
  for (const c of colorCombos) {
    const kept = byId.get(c.comboId);
    if (!kept) { byId.set(c.comboId, c); continue; }
    if ((!kept.templates?.length && c.templates?.length) || (!kept.href && c.href)) {
      byId.set(c.comboId, {
        ...kept,
        templates: kept.templates?.length ? kept.templates : c.templates,
        href: kept.href ?? c.href,
      });
    }
  }
  return [...byId.values()];
}

/** Named cards missing from the deck, plus the fit of every unnamed slot. */
export function assessCombo(
  combo: { cards: string[]; templates?: EDHRECCombo['templates'] },
  deckNames: Set<string>,
  deckCards: ScryfallCard[],
): { missingCards: string[]; templateFits: ComboTemplateFit[]; isComplete: boolean } {
  const missingCards = combo.cards.filter(name => !deckNames.has(name));
  // A combo's own named pieces can't double as its unnamed slot.
  const templateFits = fitTemplates(combo.templates, deckCards, new Set(combo.cards));
  const isComplete = missingCards.length === 0 && templateFits.every(f => f.satisfied);
  return { missingCards, templateFits, isComplete };
}

function sortDetected(
  detected: DetectedCombo[],
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): void {
  const commanderNames = new Set<string>();
  for (const c of [commanderCard, partnerCard]) {
    if (!c) continue;
    commanderNames.add(c.name);
    if (c.name.includes(' // ')) commanderNames.add(c.name.split(' // ')[0]);
  }

  detected.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const aHasCommander = a.cards.some(n => commanderNames.has(n));
    const bHasCommander = b.cards.some(n => commanderNames.has(n));
    if (aHasCommander !== bHasCommander) return aHasCommander ? -1 : 1;
    return b.deckCount - a.deckCount;
  });
}

/**
 * Detect which combos the deck runs.
 * `deckCards` is the non-commander body; commanders are folded in here so they
 * count both as named pieces and as candidates to fill an unnamed slot.
 */
export function detectCombosInDeck(
  combos: EDHRECCombo[],
  deckCards: ScryfallCard[],
  commanderCard: ScryfallCard | null,
  partnerCard: ScryfallCard | null,
): DetectedCombo[] | undefined {
  if (combos.length === 0) return undefined;

  const allCards = [...deckCards, commanderCard, partnerCard].filter((c): c is ScryfallCard => !!c);
  const deckNames = buildDeckNameSet(allCards);

  const detected = dedupeInheritingTemplates(combos)
    .map(combo => {
      const cards = combo.cards.map(c => c.name);
      const { missingCards, templateFits, isComplete } = assessCombo(
        { cards, templates: combo.templates },
        deckNames,
        allCards,
      );
      return {
        comboId: combo.comboId,
        cards,
        templates: combo.templates,
        templateFits: templateFits.length > 0 ? templateFits : undefined,
        results: combo.results,
        isComplete,
        missingCards,
        deckCount: combo.deckCount,
        bracket: combo.bracket,
        href: combo.href,
        source: combo.source ?? 'commander',
      } as DetectedCombo;
    })
    .filter(dc => dc.isComplete || dc.missingCards.length <= 2);

  sortDetected(detected, commanderCard, partnerCard);

  return detected.length > 0 ? detected : undefined;
}

/**
 * Refresh completeness on already-detected combos after the deck list changes.
 * The raw combo pool is dropped after hydration, so these keep their own `cards`
 * and `templates` and only the deck-dependent fields are re-derived.
 */
export function recomputeComboCompleteness(
  combos: DetectedCombo[],
  deckCards: ScryfallCard[],
  commanderCard?: ScryfallCard | null,
  partnerCard?: ScryfallCard | null,
): DetectedCombo[] {
  const allCards = [...deckCards, commanderCard, partnerCard].filter((c): c is ScryfallCard => !!c);
  const deckNames = buildDeckNameSet(allCards);

  return combos.map(dc => {
    // User-authored combos are complete by definition — they describe cards the
    // user already pointed at, and carry no Spellbook templates to check.
    if (dc.source === 'user') return dc;
    const { missingCards, templateFits, isComplete } = assessCombo(dc, deckNames, allCards);
    return {
      ...dc,
      missingCards,
      templateFits: templateFits.length > 0 ? templateFits : undefined,
      isComplete,
    };
  });
}

/** Slots this combo needs but the deck doesn't fill. */
export function unfilledSlots(combo: DetectedCombo): ComboTemplateFit[] {
  return (combo.templateFits ?? []).filter(f => !f.satisfied);
}
