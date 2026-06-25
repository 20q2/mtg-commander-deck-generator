/** Shared site footer — attribution + support/feedback links. */
export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3 text-center text-sm text-muted-foreground">
        <p>
          Card data from{' '}
          <a
            href="https://scryfall.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Scryfall
          </a>
          {' · '}
          Inspired by{' '}
          <a
            href="https://edhrec.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            EDHREC
          </a>
          {' · '}
          <a
            href="https://github.com/20q2/mtg-commander-deck-generator"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GitHub
          </a>
          {' · '}
          Support me on{' '}
          <a
            href="https://www.patreon.com/c/ShadowMonk598"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Patreon
          </a>
          {' · '}
          Send{' '}
          <a
            href="https://forms.gle/H3eKtDh52muFm7d56"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Feedback
          </a>
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground/70">
          Unofficial Fan Content permitted under the{' '}
          <a
            href="https://company.wizards.com/en/legal/fancontentpolicy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            WotC Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions © Wizards of the Coast LLC.
        </p>
      </div>
    </footer>
  );
}
