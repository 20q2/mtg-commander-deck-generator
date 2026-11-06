import { Megaphone } from 'lucide-react';

// Site-wide announcement shown in the header for every visitor. Edit the text to push a new
// message; set it to null to take the banner down.
const ANNOUNCEMENT: string | null = null;

/**
 * The header renders this twice. The gap between the brand block and the nav is only wide
 * enough for the message at 2xl, so "inline" sits in that gap from 2xl up and "below" takes
 * its own line under the header row beneath that. Exactly one is displayed at any width.
 */
export function AnnouncementBanner({ placement }: { placement: 'inline' | 'below' }) {
  if (!ANNOUNCEMENT) return null;

  const position = placement === 'inline'
    ? 'hidden 2xl:flex flex-1 min-w-0 mx-6'
    : 'flex mt-3 2xl:hidden';

  return (
    <div className={`${position} justify-center`}>
      <p className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-violet-100 text-balance">
        <Megaphone className="w-3.5 h-3.5 shrink-0 text-violet-300" aria-hidden="true" />
        <span>{ANNOUNCEMENT}</span>
      </p>
    </div>
  );
}
