import type { ScryfallCard } from '@/types';

export function getRoleBadgeProps(
  card: ScryfallCard,
): { color: string; bgColor: string; title: string; label: string } | null {
  if (!card.deckRole) return null;
  switch (card.deckRole) {
    case 'ramp':
      switch (card.rampSubtype) {
        case 'mana-producer': return { color: 'text-lime-400/70', bgColor: 'bg-lime-500/80', title: 'Mana Producer', label: 'MP' };
        case 'mana-rock': return { color: 'text-yellow-400/70', bgColor: 'bg-yellow-500/80', title: 'Mana Rock', label: 'MR' };
        case 'cost-reducer': return { color: 'text-teal-400/70', bgColor: 'bg-teal-500/80', title: 'Cost Reducer', label: 'CR' };
        default: return { color: 'text-emerald-400/70', bgColor: 'bg-emerald-500/80', title: 'Ramp', label: 'RA' };
      }
    case 'removal':
      switch (card.removalSubtype) {
        case 'counterspell': return { color: 'text-sky-400/70', bgColor: 'bg-sky-500/80', title: 'Counterspell', label: 'CT' };
        case 'bounce': return { color: 'text-cyan-400/70', bgColor: 'bg-cyan-500/80', title: 'Bounce', label: 'BN' };
        case 'spot-removal': return { color: 'text-rose-400/70', bgColor: 'bg-rose-500/80', title: 'Spot Removal', label: 'SR' };
        default: return { color: 'text-red-400/70', bgColor: 'bg-red-500/80', title: 'Removal', label: 'RE' };
      }
    case 'boardwipe':
      switch (card.boardwipeSubtype) {
        case 'bounce-wipe': return { color: 'text-cyan-400/70', bgColor: 'bg-cyan-500/80', title: 'Bounce Wipe', label: 'BW' };
        default: return { color: 'text-orange-400/70', bgColor: 'bg-orange-500/80', title: 'Board Wipe', label: 'WI' };
      }
    case 'cardDraw':
      switch (card.cardDrawSubtype) {
        case 'tutor': return { color: 'text-amber-400/70', bgColor: 'bg-amber-500/80', title: 'Tutor', label: 'TU' };
        case 'wheel': return { color: 'text-pink-400/70', bgColor: 'bg-pink-500/80', title: 'Wheel', label: 'WH' };
        case 'cantrip': return { color: 'text-sky-400/70', bgColor: 'bg-sky-500/80', title: 'Cantrip', label: 'CN' };
        case 'card-draw': return { color: 'text-blue-400/70', bgColor: 'bg-blue-500/80', title: 'Card Draw', label: 'DR' };
        default: return { color: 'text-indigo-400/70', bgColor: 'bg-indigo-500/80', title: 'Card Advantage', label: 'CA' };
      }
    default: return null;
  }
}
