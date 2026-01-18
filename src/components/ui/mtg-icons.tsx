import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

// Creature - Claw/paw symbol
export function CreatureIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C10.5 2 9.5 3.5 9.5 5C9.5 6.5 10.5 8 12 8C13.5 8 14.5 6.5 14.5 5C14.5 3.5 13.5 2 12 2Z" />
      <path d="M7 4C5.5 4 4.5 5 4.5 6.5C4.5 8 5.5 9 7 9C8.5 9 9.5 8 9.5 6.5C9.5 5 8.5 4 7 4Z" />
      <path d="M17 4C15.5 4 14.5 5 14.5 6.5C14.5 8 15.5 9 17 9C18.5 9 19.5 8 19.5 6.5C19.5 5 18.5 4 17 4Z" />
      <path d="M12 10C8 10 5 14 5 18C5 20 6 22 8 22C10 22 11 20 12 20C13 20 14 22 16 22C18 22 19 20 19 18C19 14 16 10 12 10Z" />
    </svg>
  );
}

// Planeswalker - Planeswalker loyalty symbol
export function PlaneswalkerIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2L14 8H20L15 12L17 18L12 14L7 18L9 12L4 8H10L12 2Z" />
    </svg>
  );
}

// Instant - Lightning bolt
export function InstantIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M13 2L4 14H11L10 22L20 10H13L15 2H13Z" />
    </svg>
  );
}

// Sorcery - Flame/fire
export function SorceryIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C12 2 8 6 8 12C8 14 9 16 10 17C9 15 10 13 12 12C14 13 15 15 14 17C15 16 16 14 16 12C16 6 12 2 12 2Z" />
      <path d="M12 22C8 22 5 19 5 15C5 11 8 8 12 8C16 8 19 11 19 15C19 19 16 22 12 22Z" opacity="0.7" />
    </svg>
  );
}

// Artifact - Gear/cog
export function ArtifactIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 8C9.8 8 8 9.8 8 12C8 14.2 9.8 16 12 16C14.2 16 16 14.2 16 12C16 9.8 14.2 8 12 8ZM19.4 11L21 9.4L19.6 8L17.8 8.5C17.3 8 16.8 7.6 16.2 7.3L16 5.5L14 5L13.4 6.8C12.9 6.7 12.5 6.7 12 6.7C11.5 6.7 11.1 6.7 10.6 6.8L10 5L8 5.5L7.8 7.3C7.2 7.6 6.7 8 6.2 8.5L4.4 8L3 9.4L4.6 11C4.5 11.5 4.5 11.9 4.5 12.4C4.5 12.9 4.5 13.3 4.6 13.8L3 15.4L4.4 16.8L6.2 16.3C6.7 16.8 7.2 17.2 7.8 17.5L8 19.3L10 19.8L10.6 18C11.1 18.1 11.5 18.1 12 18.1C12.5 18.1 12.9 18.1 13.4 18L14 19.8L16 19.3L16.2 17.5C16.8 17.2 17.3 16.8 17.8 16.3L19.6 16.8L21 15.4L19.4 13.8C19.5 13.3 19.5 12.9 19.5 12.4C19.5 11.9 19.5 11.5 19.4 11Z" />
    </svg>
  );
}

// Enchantment - Sparkle/radiance
export function EnchantmentIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" />
      <path d="M19 15L20 17L22 18L20 19L19 21L18 19L16 18L18 17L19 15Z" opacity="0.7" />
      <path d="M5 15L6 17L8 18L6 19L5 21L4 19L2 18L4 17L5 15Z" opacity="0.7" />
    </svg>
  );
}

// Land - Mountain
export function LandIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 4L20 20H4L12 4Z" />
      <path d="M12 4L16 12L20 20H12L12 4Z" opacity="0.7" />
    </svg>
  );
}

// Commander - Crown
export function CommanderIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M2 19H22V21H2V19Z" />
      <path d="M2 17L5 8L9 12L12 5L15 12L19 8L22 17H2Z" />
    </svg>
  );
}

// Map of card types to icons
export const CardTypeIcon = {
  Commander: CommanderIcon,
  Creature: CreatureIcon,
  Planeswalker: PlaneswalkerIcon,
  Instant: InstantIcon,
  Sorcery: SorceryIcon,
  Artifact: ArtifactIcon,
  Enchantment: EnchantmentIcon,
  Land: LandIcon,
} as const;

// Mana cost display using mana-font
interface ManaCostProps {
  cost: string | undefined;
  className?: string;
}

export function ManaCost({ cost, className = '' }: ManaCostProps) {
  if (!cost) return null;

  const symbols = cost.match(/\{[^}]+\}/g) || [];

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {symbols.map((symbol, i) => {
        const clean = symbol.replace(/[{}]/g, '');
        // Convert to mana-font class format (lowercase, no slashes)
        const manaClass = clean.toLowerCase().replace('/', '');

        return (
          <i
            key={i}
            className={`ms ms-${manaClass} ms-cost`}
          />
        );
      })}
    </span>
  );
}

// Color identity display using mana-font
interface ColorIdentityProps {
  colors: string[];
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ColorIdentity({ colors, className = '', size = 'md' }: ColorIdentityProps) {
  const sizeClass = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base';

  if (colors.length === 0) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <i className={`ms ms-c ms-cost ${sizeClass}`} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {colors.map((color) => (
        <i
          key={color}
          className={`ms ms-${color.toLowerCase()} ms-cost ${sizeClass}`}
        />
      ))}
    </span>
  );
}
