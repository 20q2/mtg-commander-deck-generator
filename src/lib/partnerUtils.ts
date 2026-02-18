import type { ScryfallCard } from '@/types';

export type PartnerType =
  | 'none'
  | 'partner'           // Generic "Partner" keyword
  | 'partner-with'      // "Partner with [Name]"
  | 'friends-forever'   // "Friends forever" keyword
  | 'choose-background' // Commander that can choose a Background
  | 'background'        // Background enchantment (partner for choose-background commanders)
  | 'doctors-companion' // "Doctor's companion" keyword (pairs with a Doctor)
  | 'doctor';           // Creature with Doctor type (pairs with Doctor's companion)

// Local helper to get oracle text (avoids circular dependency with scryfall/client)
function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) {
    return card.oracle_text;
  }
  if (card.card_faces) {
    return card.card_faces
      .map((face) => face.oracle_text || '')
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/**
 * Determines the partner type of a commander card
 */
export function getPartnerType(card: ScryfallCard): PartnerType {
  const keywords = card.keywords || [];
  const oracleText = getOracleText(card);
  const typeLine = card.type_line || '';

  // Check for Background type (these are the partners for "Choose a Background" commanders)
  if (typeLine.includes('Background')) {
    return 'background';
  }

  // Check for "Choose a Background" in oracle text
  if (oracleText.includes('Choose a Background')) {
    return 'choose-background';
  }

  // Check for "Doctor's companion" keyword
  if (keywords.includes("Doctor's companion")) {
    return 'doctors-companion';
  }

  // Check for Doctor creature type (Time Lord Doctor — pairs with Doctor's companion)
  if (typeLine.includes('—')) {
    const subtypes = typeLine.split('—')[1] || '';
    if (/\bDoctor\b/.test(subtypes)) {
      return 'doctor';
    }
  }

  // Check for "Friends forever" in oracle text (before generic Partner check)
  // Note: Scryfall returns keywords: ["Partner"] for Friends forever cards,
  // so we must check oracle text to distinguish them from generic Partner
  if (oracleText.includes('Friends forever')) {
    return 'friends-forever';
  }

  // Check for "Partner with [Name]" in oracle text (before generic Partner check)
  if (/Partner with [A-Z]/.test(oracleText)) {
    return 'partner-with';
  }

  // Check for generic "Partner" keyword (after excluding Friends forever and Partner with)
  if (keywords.includes('Partner')) {
    return 'partner';
  }

  return 'none';
}

/**
 * Extracts the specific partner name from "Partner with [Name]" cards
 * Returns null if not a "Partner with" card
 */
export function getPartnerWithName(card: ScryfallCard): string | null {
  const oracleText = getOracleText(card);

  // Match "Partner with [Name]" pattern
  // The name is everything after "Partner with " until end of line or "("
  const match = oracleText.match(/Partner with ([A-Z][^(\n]+)/);

  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Checks if a card can have a partner
 */
export function canHavePartner(card: ScryfallCard): boolean {
  const partnerType = getPartnerType(card);
  return partnerType !== 'none';
}

/**
 * Checks if two cards are valid partner pairs
 */
export function areValidPartners(card1: ScryfallCard, card2: ScryfallCard): boolean {
  const type1 = getPartnerType(card1);
  const type2 = getPartnerType(card2);

  // Can't partner with itself
  if (card1.name === card2.name) {
    return false;
  }

  // Generic Partner pairs with generic Partner
  if (type1 === 'partner' && type2 === 'partner') {
    return true;
  }

  // Partner with X pairs only with that specific card
  if (type1 === 'partner-with') {
    const partnerName = getPartnerWithName(card1);
    return partnerName === card2.name;
  }
  if (type2 === 'partner-with') {
    const partnerName = getPartnerWithName(card2);
    return partnerName === card1.name;
  }

  // Friends forever pairs with Friends forever
  if (type1 === 'friends-forever' && type2 === 'friends-forever') {
    return true;
  }

  // Choose a Background pairs with Background
  if (type1 === 'choose-background' && type2 === 'background') {
    return true;
  }
  if (type1 === 'background' && type2 === 'choose-background') {
    return true;
  }

  // Doctor's companion pairs with Doctor
  if (type1 === 'doctors-companion' && type2 === 'doctor') {
    return true;
  }
  if (type1 === 'doctor' && type2 === 'doctors-companion') {
    return true;
  }

  return false;
}

/**
 * Gets a human-readable label for the partner type
 */
export function getPartnerTypeLabel(partnerType: PartnerType): string {
  switch (partnerType) {
    case 'partner':
      return 'Partner';
    case 'partner-with':
      return 'Partner with';
    case 'friends-forever':
      return 'Friends forever';
    case 'choose-background':
      return 'Choose a Background';
    case 'background':
      return 'Background';
    case 'doctors-companion':
      return 'Doctor';
    case 'doctor':
      return "Doctor's Companion";
    default:
      return '';
  }
}
