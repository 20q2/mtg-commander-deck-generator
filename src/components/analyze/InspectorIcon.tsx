const LOGO_URL = `${import.meta.env.BASE_URL}inspector-logo.png`;

/**
 * A monochrome glyph of the Inspector logo. Rather than the full-color image,
 * this masks the logo's silhouette and fills it with `currentColor`, so it
 * renders as a light-gray icon that matches (and hover-brightens with) the
 * lucide icons beside it in the deck toolbars. Size via `className` (e.g. `w-4 h-4`).
 */
export function InspectorIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className ?? ''}`}
      style={{
        WebkitMaskImage: `url(${LOGO_URL})`,
        maskImage: `url(${LOGO_URL})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
