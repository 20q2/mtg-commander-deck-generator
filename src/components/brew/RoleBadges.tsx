import { cardMatchesRole, isTutor } from '@/services/tagger/client';
import { ROLE_AXES } from '@/components/brew/brewVisuals';

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

const SIZE = {
  sm: { chip: 'w-4 h-4', icon: 'w-2.5 h-2.5' },
  md: { chip: 'w-5 h-5', icon: 'w-3 h-3' },
} as const;

/**
 * The little corner badges on a brew pick card: a vertical stack in the top-left (the only free
 * corner — top-right holds combo/Game-Changer markers, top-centre holds Lift/Spicy ribbons). Each
 * chip is a dark backdrop + a ring and icon tinted in the role's hue, so it reads over any card art
 * while colour-matching its radar spoke. Capped at 4 (real cards rarely fill more).
 */
export function RoleBadges({ cardName, size = 'sm', corner = 'tl' }: { cardName: string; size?: 'sm' | 'md'; corner?: 'tl' | 'bl' }) {
  const axes = cardRoleAxes(cardName).slice(0, 4);
  if (axes.length === 0) return null;
  const sz = SIZE[size];
  // Anchored to the left of its corner and laid out in a horizontal row, the chips grow rightward
  // along the card edge rather than stacking up the side.
  const pos = corner === 'bl' ? 'bottom-1 left-1' : 'top-1 left-1';

  return (
    <span className={`absolute ${pos} z-20 flex flex-row gap-1`}>
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
