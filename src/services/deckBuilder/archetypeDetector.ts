import { Archetype, type ArchetypeResult, type ScryfallCard } from '@/types';
import { ARCHETYPE_KEYWORDS } from '@/lib/constants/archetypes';
import { getOracleText } from '@/services/scryfall/client';

// Common tribal creature types to detect
const TRIBAL_TYPES = [
  'elf', 'elves', 'goblin', 'zombie', 'vampire', 'dragon', 'angel', 'demon',
  'merfolk', 'wizard', 'soldier', 'warrior', 'beast', 'elemental', 'spirit',
  'knight', 'rogue', 'cleric', 'shaman', 'dinosaur', 'pirate', 'sliver',
  'human', 'cat', 'bird', 'snake', 'rat', 'skeleton', 'horror', 'sphinx',
];

export function detectArchetypes(commander: ScryfallCard, partnerCommander?: ScryfallCard | null): ArchetypeResult[] {
  const oracleText = getOracleText(commander).toLowerCase();
  const partnerText = partnerCommander ? getOracleText(partnerCommander).toLowerCase() : '';
  const combinedText = `${oracleText} ${partnerText}`;

  const keywords = commander.keywords || [];
  const partnerKeywords = partnerCommander?.keywords || [];
  const allKeywords = [...keywords, ...partnerKeywords].map(k => k.toLowerCase());

  const typeLine = (commander.type_line || '').toLowerCase();
  const partnerTypeLine = partnerCommander?.type_line?.toLowerCase() || '';
  const combinedTypeLine = `${typeLine} ${partnerTypeLine}`;

  const scores: ArchetypeResult[] = [];

  for (const [archetype, patterns] of Object.entries(ARCHETYPE_KEYWORDS)) {
    if (archetype === Archetype.MIDRANGE || archetype === Archetype.GOODSTUFF) {
      continue; // Skip default archetypes
    }

    let score = 0;
    const matched: string[] = [];

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');

        // Check combined oracle text
        if (regex.test(combinedText)) {
          score += 2;
          matched.push(pattern);
        }

        // Check keywords array (stronger signal)
        if (allKeywords.some((k) => regex.test(k))) {
          score += 3;
          matched.push(`keyword:${pattern}`);
        }
      } catch {
        // Invalid regex, try exact match
        if (combinedText.includes(pattern.toLowerCase())) {
          score += 1;
          matched.push(pattern);
        }
      }
    }

    // Special case: Tribal detection
    if (archetype === Archetype.TRIBAL) {
      for (const tribe of TRIBAL_TYPES) {
        const tribeRegex = new RegExp(`\\b${tribe}\\b`, 'i');
        // Check if mentions tribe multiple times or in significant ways
        const textMatches = (combinedText.match(tribeRegex) || []).length;
        const typeMatches = tribeRegex.test(combinedTypeLine) ? 1 : 0;

        if (textMatches >= 2 || (textMatches >= 1 && typeMatches >= 1)) {
          score += 4;
          matched.push(`tribal:${tribe}`);
        }
      }

      // "Other [type] you control" pattern is very tribal
      if (/other.*(you control|creatures you control)/i.test(combinedText)) {
        score += 3;
        matched.push('other-creatures-pattern');
      }
    }

    // Special case: Voltron boost for self-buffing commanders
    if (archetype === Archetype.VOLTRON) {
      if (combinedTypeLine.includes('legendary creature')) {
        if (/gets? \+\d+\/\+\d+|protection from|hexproof|indestructible/i.test(combinedText)) {
          score += 3;
          matched.push('self-buff');
        }
        // Low CMC with evasion suggests voltron
        if (commander.cmc <= 4 && /flying|trample|menace|fear|intimidate|unblockable/i.test(combinedText)) {
          score += 2;
          matched.push('evasion-commander');
        }
      }
    }

    // Special case: Spellslinger - check for instant/sorcery triggers
    if (archetype === Archetype.SPELLSLINGER) {
      const spellTriggers = (combinedText.match(/whenever you cast/g) || []).length;
      if (spellTriggers >= 2) {
        score += 3;
        matched.push('multiple-cast-triggers');
      }
    }

    // Special case: Tokens - check for multiple token creation
    if (archetype === Archetype.TOKENS) {
      const tokenMentions = (combinedText.match(/create.*token|token creature/gi) || []).length;
      if (tokenMentions >= 2) {
        score += 3;
        matched.push('multiple-token-mentions');
      }
    }

    // Special case: Aristocrats - sacrifice synergy
    if (archetype === Archetype.ARISTOCRATS) {
      if (/sacrifice.*:.*|whenever.*sacrifice/i.test(combinedText)) {
        score += 3;
        matched.push('sacrifice-ability');
      }
    }

    if (score > 0) {
      scores.push({
        archetype: archetype as Archetype,
        score,
        matchedKeywords: matched,
        confidence: score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low',
      });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // If no strong matches, default to midrange
  if (scores.length === 0 || scores[0].score < 3) {
    scores.unshift({
      archetype: Archetype.MIDRANGE,
      score: 1,
      matchedKeywords: ['default'],
      confidence: 'low',
    });
  }

  return scores;
}

export function getArchetypeDefaultCustomization(archetype: Archetype) {
  return {
    landCount: archetype === Archetype.AGGRO ? 34
             : archetype === Archetype.LANDFALL ? 40
             : archetype === Archetype.STORM ? 34
             : 37,
  };
}
