/**
 * Renders the ManaFoundry logo as a single-color silhouette by using the logo
 * PNG's alpha channel as a CSS mask and filling it with `currentColor`. This
 * lets the mark sit inline next to text like a Lucide icon and inherit the
 * surrounding text color (e.g. white on a colored button, muted on an inactive
 * tab). Size it with `className` (e.g. "w-4 h-4").
 */
interface LogoMarkProps {
  className?: string;
}

export function LogoMark({ className }: LogoMarkProps) {
  const src = `${import.meta.env.BASE_URL}logo.png`;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}
