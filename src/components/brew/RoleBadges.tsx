import {
  cardMatchesRole, isTutor,
  getRampSubtype, getRemovalSubtype, getBoardwipeSubtype, getCardDrawSubtype, getProtectionSubtype,
} from '@/services/tagger/client';
import { ROLE_AXES, type RoleAxis } from '@/components/brew/brewVisuals';

/**
 * Which of the six radar axes a card touches, in ROLE_AXES order. Drawn from the same tagger source
 * the radar uses (cardMatchesRole for the five roles, isTutor for tutors) so a card's badges always
 * agree with how the "Your deck so far" chart would count it — including counterspells, which
 * cardMatchesRole('protection') treats as protection. Returns [] when tagger data isn't loaded.
 */
export function cardRoleAxes(cardName: string): string[] {
  const axes: string[] = [];
  if (cardMatchesRole(cardName, 'ramp')) axes.push('ramp');
  if (cardMatchesRole(cardName, 'removal')) axes.push('removal');
  if (cardMatchesRole(cardName, 'boardwipe')) axes.push('boardwipe');
  if (cardMatchesRole(cardName, 'cardDraw')) axes.push('cardDraw');
  if (isTutor(cardName)) axes.push('tutor');
  if (cardMatchesRole(cardName, 'protection')) axes.push('protection');
  return axes;
}

const AXIS_BY_KEY = Object.fromEntries(ROLE_AXES.map(a => [a.key, a]));

// The specific-over-general label: a counterspell reads "Counterspell", not the parent "Protection".
// Keyed by the subtype slugs the tagger returns; slugs that equal their parent role fall back to the
// axis label (so a plain 'removal'/'protection' card keeps its generic name).
const SUBTYPE_LABEL: Record<string, string> = {
  'mana-producer': 'Mana Dork', 'mana-rock': 'Mana Rock', 'cost-reducer': 'Cost Reducer',
  'bounce': 'Bounce', 'spot-removal': 'Spot Removal',
  'bounce-wipe': 'Bounce Wipe',
  'wheel': 'Wheel', 'cantrip': 'Cantrip', 'card-draw': 'Card Draw', 'card-advantage': 'Card Draw',
  'counterspell': 'Counterspell',
};

// Which subtype getter refines each axis toward its more specific label.
const SUBTYPE_FOR: Record<string, (name: string) => string | null> = {
  ramp: getRampSubtype, removal: getRemovalSubtype, boardwipe: getBoardwipeSubtype,
  cardDraw: getCardDrawSubtype, protection: getProtectionSubtype,
};

/**
 * The role axes a card touches, each carrying the most specific label it earns — a Spellstutter Sprite
 * shows "Counterspell" rather than the parent "Protection". The dedicated tutor axis already speaks for
 * tutoring, so a cardDraw axis whose subtype is 'tutor' is dropped to avoid a duplicate chip.
 */
export function cardRoleChips(cardName: string): (RoleAxis & { label: string })[] {
  return cardRoleAxes(cardName)
    .map(key => {
      const axis = AXIS_BY_KEY[key];
      if (!axis) return null;
      const subtype = SUBTYPE_FOR[key]?.(cardName) ?? null;
      if (key === 'cardDraw' && subtype === 'tutor') return null; // covered by the tutor axis
      return { ...axis, label: (subtype && SUBTYPE_LABEL[subtype]) || axis.label };
    })
    .filter((c): c is RoleAxis & { label: string } => c !== null);
}

const SIZE = {
  sm: { chip: 'w-4 h-4', icon: 'w-2.5 h-2.5' },
  md: { chip: 'w-5 h-5', icon: 'w-3 h-3' },
} as const;

/**
 * The little role badges on a brew pick card. Overlay corners ('tl'/'bl') sit on the art — 'tl' is
 * the free corner on node picks (top-right holds combo/Game-Changer markers, top-centre holds
 * Lift/Spicy ribbons). 'inline' renders the same chips in normal flow for caption rows below a
 * card. Each chip is a dark backdrop + a ring and icon tinted in the role's hue, so it reads over
 * any card art while colour-matching its radar spoke. Capped at 4 (real cards rarely fill more).
 */
export function RoleBadges({ cardName, size = 'sm', corner = 'tl', withLabels = false }: { cardName: string; size?: 'sm' | 'md'; corner?: 'tl' | 'bl' | 'inline'; withLabels?: boolean }) {
  const sz = SIZE[size];
  // Overlay chips anchor to the left of their corner and grow rightward along the card edge.
  const pos = corner === 'inline' ? '' : `absolute z-20 ${corner === 'bl' ? 'bottom-1 left-1' : 'top-1 left-1'}`;

  // Labeled variant: icon + word pills that name the specific role (e.g. "Counterspell"), wrapping.
  if (withLabels) {
    const chips = cardRoleChips(cardName).slice(0, 4);
    if (chips.length === 0) return null;
    return (
      <>
        {chips.map(({ key, Icon, hue, label }) => (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full bg-[#0b0b10]/85 px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm"
            style={{ color: `hsl(${hue})`, boxShadow: `inset 0 0 0 1px hsl(${hue} / 0.6), 0 2px 6px rgba(0,0,0,0.5)` }}
          >
            <Icon className="w-2.5 h-2.5 shrink-0" strokeWidth={2.25} />
            {label}
          </span>
        ))}
      </>
    );
  }

  const axes = cardRoleAxes(cardName).slice(0, 4);
  if (axes.length === 0) return null;
  return (
    <span className={`${pos} flex flex-row gap-1`}>
      {axes.map(key => {
        const axis = AXIS_BY_KEY[key];
        if (!axis) return null;
        const { Icon, hue, label } = axis;
        return (
          <span
            key={key}
            title={label}
            className={`grid place-items-center ${sz.chip} rounded-full bg-[#0b0b10]/85 backdrop-blur-sm`}
            style={{ color: `hsl(${hue})`, boxShadow: `inset 0 0 0 1px hsl(${hue} / 0.6), 0 2px 6px rgba(0,0,0,0.5)` }}
          >
            <Icon className={sz.icon} strokeWidth={2.25} />
          </span>
        );
      })}
    </span>
  );
}
