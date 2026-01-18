// Card type icon component using mana-font
interface CardTypeIconProps {
  type: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

// Map card types to mana-font classes
const typeToManaClass: Record<string, string> = {
  commander: 'ms-commander',
  creature: 'ms-creature',
  planeswalker: 'ms-planeswalker',
  instant: 'ms-instant',
  sorcery: 'ms-sorcery',
  artifact: 'ms-artifact',
  enchantment: 'ms-enchantment',
  land: 'ms-land',
  tribal: 'ms-tribal',
  battle: 'ms-battle',
};

export function CardTypeIcon({ type, size = 'md', className = '' }: CardTypeIconProps) {
  const normalizedType = type.toLowerCase();
  const manaClass = typeToManaClass[normalizedType] || 'ms-creature';

  return (
    <i className={`ms ${manaClass} ${sizeClasses[size]} ${className}`} />
  );
}

// Legacy exports for backwards compatibility - now just wrapper components
export function CreatureIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="creature" size={sizeKey} className={className} />;
}

export function PlaneswalkerIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="planeswalker" size={sizeKey} className={className} />;
}

export function InstantIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="instant" size={sizeKey} className={className} />;
}

export function SorceryIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="sorcery" size={sizeKey} className={className} />;
}

export function ArtifactIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="artifact" size={sizeKey} className={className} />;
}

export function EnchantmentIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="enchantment" size={sizeKey} className={className} />;
}

export function LandIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="land" size={sizeKey} className={className} />;
}

export function CommanderIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const sizeKey = size <= 14 ? 'sm' : size >= 20 ? 'lg' : 'md';
  return <CardTypeIcon type="commander" size={sizeKey} className={className} />;
}

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
