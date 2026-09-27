import { useCallback, useMemo, useState } from 'react';
import { Github, Copy, Check, ExternalLink, Link2, AlertCircle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { usePageTitle } from '@/hooks/usePageTitle';
import { TAB_SLUG_BY_KEY } from '@/components/deck/optimizer/constants';
import { parseDeckLines } from '@/services/collection/deckExportFilter';
import { buildShareUrl, deckToSharePayload, DeckLinkError } from '@/services/share/deckLink';

const REPO_URL = 'https://github.com/20q2/mtg-commander-deck-generator';

/** Foundry Assembler (Aether Revolt) — the page's backdrop. Scryfall art crop, hotlinked like every other card image on the site. */
const BACKDROP = {
  card: 'Foundry Assembler',
  artist: 'Karl Kopinski',
  artCrop: 'https://cards.scryfall.io/art_crop/front/e/8/e83a2862-a2d7-4d87-a4b8-def9f441f5fa.jpg',
  scryfall: 'https://scryfall.com/card/aer/151/foundry-assembler',
};

/** Where a `#d=` link can land. Order is the order they appear on the page. */
const DESTINATIONS = [
  {
    route: 'decks/shared',
    label: 'Deck view',
    detail: 'A read-only deck page with Save to My Decks and Inspect. The right landing place for an "Open in ManaFoundry" button.',
  },
  {
    route: 'analyze/overview',
    label: 'Inspector',
    detail: 'The Inspector, opened on a specific tab. Swap the last segment for any tab slug below.',
  },
  {
    route: 'playtest',
    label: 'Playtest',
    detail: 'Straight onto the goldfish table. The deck is never saved.',
  },
] as const;

const INSPECTOR_TABS: { slug: string; label: string }[] = [
  { slug: TAB_SLUG_BY_KEY.overview, label: 'Overview' },
  { slug: TAB_SLUG_BY_KEY.roles, label: 'Roles' },
  { slug: TAB_SLUG_BY_KEY.lands, label: 'Mana' },
  { slug: TAB_SLUG_BY_KEY.curve, label: 'Tempo' },
  { slug: TAB_SLUG_BY_KEY.optimize, label: 'Card fit' },
  { slug: TAB_SLUG_BY_KEY.bracket, label: 'Bracket' },
  { slug: TAB_SLUG_BY_KEY.cost, label: 'Cost' },
  { slug: TAB_SLUG_BY_KEY.lift, label: 'Lift web' },
  { slug: TAB_SLUG_BY_KEY.newCards, label: 'New cards' },
];

const JS_SNIPPET = `// cards: one name per copy, commander included
async function manafoundryLink(cards, commander, partner = '', route = 'decks/shared') {
  const body = [commander, partner, ...cards].join('\\n');
  const bytes = new TextEncoder().encode(body);
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

  let fragment;
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    fragment = '1.' + b64url(await new Response(stream).arrayBuffer());
  } else {
    fragment = '0.' + b64url(bytes);   // uncompressed fallback
  }
  return \`https://manafoundry.gg/\${route}#d=\${fragment}\`;
}`;

const PY_SNIPPET = `import base64, zlib

def manafoundry_link(cards, commander, partner="", route="decks/shared"):
    # cards: one name per copy, commander included
    body = "\\n".join([commander, partner, *cards]).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)      # raw deflate, no zlib header
    data = c.compress(body) + c.flush()
    fragment = "1." + base64.urlsafe_b64encode(data).decode().rstrip("=")
    return f"https://manafoundry.gg/{route}#d={fragment}"`;

const BODY_EXAMPLE = `Atraxa, Praetors' Voice      ← line 1: commander ("" if none)
                             ← line 2: partner commander ("" if none)
Atraxa, Praetors' Voice      ← line 3+: every card, one name per line
Sol Ring
Cultivate
Cultivate                    ← quantities are repeated, not written as "2 Cultivate"
…`;

const SAMPLE_DECKLIST = `1 Krenko, Mob Boss
1 Sol Ring
1 Goblin Chieftain
1 Skirk Prospector
1 Impact Tremors
35 Mountain`;

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

export function DevelopersPage() {
  usePageTitle('For Developers');

  return (
    <main className="flex-1 container mx-auto px-4 py-6 max-w-4xl animate-fade-in relative z-10">
      <ArtBackdrop />
      <div className="text-center py-6 mb-4">
        <h1 className="text-4xl font-bold mb-3">
          For <span className="gradient-text">Developers</span>
        </h1>
        <p className="text-base text-muted-foreground max-w-2xl mx-auto">
          ManaFoundry is open source, and any site can hand a deck to it with a single link. No API key,
          no account, no server round-trip: the decklist travels inside the URL.
        </p>
      </div>

      <div className="space-y-6">
        <OpenSourceSection />
        <DeepLinkSection />
        <PayloadSection />
        <CodeSection />
        <LinkBuilderSection />
        <RulesSection />
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground/70">
        Backdrop: <em>{BACKDROP.card}</em> by {BACKDROP.artist}, via{' '}
        <a href={BACKDROP.scryfall} target="_blank" rel="noopener noreferrer" className="hover:underline">Scryfall</a>.
      </p>
    </main>
  );
}

// ─── Backdrop ────────────────────────────────────────────────────────

/**
 * Fixed card-art backdrop, same recipe as the commander art behind /build: art
 * across the top 70vh, faded into the page background and vignetted. Lives in the
 * page rather than Layout because nothing else keys a backdrop on this route.
 * `main` carries `relative z-10`, which makes it a stacking context; the backdrop
 * sits at `-z-10` inside it so it paints beneath the static heading as well as the
 * glass sections. At `z-0` it painted over the heading (positioned beats static),
 * while the sections survived only because backdrop-blur gives them their own layer.
 */
function ArtBackdrop() {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden>
      <div className="absolute inset-0" style={{ opacity: loaded ? 1 : 0, transition: 'opacity 1800ms ease' }}>
        <img
          src={BACKDROP.artCrop}
          alt=""
          className="w-full h-[70vh] object-cover object-top blur-sm scale-105"
          onLoad={() => setLoaded(true)}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />
      <div className="absolute inset-0 bg-background/15" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center top, transparent 0%, hsl(var(--background)) 70%)' }}
      />
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────

function OpenSourceSection() {
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="Open source" />
      <p className="text-sm text-muted-foreground mb-5">
        The whole site, from the deck generator to the playtest table, lives in one MIT-licensed
        repository. React, TypeScript, and Vite on the front; card data from Scryfall and EDHREC; everything
        runs in your browser. Issues and pull requests are welcome.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
          <Github className="w-4 h-4" />
          View on GitHub
        </a>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
          <ExternalLink className="w-4 h-4" />
          Report an issue
        </a>
      </div>
      <CodeBlock className="mt-5" code={`git clone ${REPO_URL}.git\ncd mtg-commander-deck-generator\nnpm install\nnpm run dev`} />
    </section>
  );
}

function DeepLinkSection() {
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="Deep links: send a deck to ManaFoundry" />
      <p className="text-sm text-muted-foreground mb-5">
        Append <Code>#d=</Code> plus an encoded decklist to one of three routes. The recipient sees the
        deck immediately. Nothing is written to their browser until they choose to save it.
      </p>

      <Anatomy />

      <div className="mt-6 space-y-3">
        {DESTINATIONS.map(d => (
          <div key={d.route} className="rounded-lg border border-border/50 bg-background/40 p-4">
            <div className="flex items-baseline gap-3 flex-wrap mb-1">
              <span className="font-semibold">{d.label}</span>
              <Code>{`https://manafoundry.gg/${d.route}#d=…`}</Code>
            </div>
            <p className="text-sm text-muted-foreground">{d.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="text-sm font-medium mb-2">Inspector tab slugs</div>
        <div className="flex flex-wrap gap-2">
          {INSPECTOR_TABS.map(t => (
            <span key={t.slug} className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/40 px-2 py-1 text-xs">
              <span className="text-muted-foreground">{t.label}</span>
              <Code>{t.slug}</Code>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Anatomy() {
  return (
    <div className="rounded-lg border border-border/50 bg-black/30 p-4 overflow-x-auto">
      <div className="font-mono text-xs whitespace-nowrap leading-6">
        <span className="text-muted-foreground">https://manafoundry.gg/</span>
        <span className="text-sky-300">analyze</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-emerald-300">tempo</span>
        <span className="text-muted-foreground">#d=</span>
        <span className="text-amber-300">1</span>
        <span className="text-muted-foreground">.</span>
        <span className="text-violet-300">q1ZKzs8rSc0rUbBVSkosSsxLzUlVyMxLK1FIzs8rTs…</span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-sky-300 font-mono">route</dt>
        <dd className="text-muted-foreground">Which surface opens: deck view, Inspector, or playtest.</dd>
        <dt className="text-emerald-300 font-mono">tab</dt>
        <dd className="text-muted-foreground">Inspector only. Which tab the link opens on.</dd>
        <dt className="text-amber-300 font-mono">version</dt>
        <dd className="text-muted-foreground">
          <Code>1</Code> = deflate-raw compressed. <Code>0</Code> = uncompressed. Anything else is refused as
          "made by a newer version of the site".
        </dd>
        <dt className="text-violet-300 font-mono">payload</dt>
        <dd className="text-muted-foreground">base64url of the body, padding stripped.</dd>
      </dl>
    </div>
  );
}

function PayloadSection() {
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="The payload body" />
      <p className="text-sm text-muted-foreground mb-4">
        Before encoding, the body is plain newline-delimited text, not JSON. Card names cannot contain
        newlines, so there is nothing to escape.
      </p>
      <CodeBlock code={BODY_EXAMPLE} copyable={false} />
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
        <li>
          <span className="text-foreground">The commander appears twice.</span> Line 1 names it, and it is
          also included in the card list. A commander that is only on line 1 loads as a deck with no commander.
        </li>
        <li>
          <span className="text-foreground">Names are resolved through Scryfall.</span> Use the printed card
          name. The front-face name works for double-faced cards, and accents and punctuation are normalized.
          Set codes and collector numbers are not carried, so the recipient gets the canonical printing.
        </li>
        <li>
          <span className="text-foreground">Quantities are repeats.</span> Write "Cultivate" twice rather
          than "2 Cultivate".
        </li>
        <li>
          <span className="text-foreground">Compress it.</span> Version <Code>1</Code> is raw deflate with no
          zlib header. A typical 100-card deck encodes to about 1,200 characters. Version <Code>0</Code> skips
          compression and is fine for a one-off, but the encoded value must stay under 7,500 characters.
        </li>
      </ul>
    </section>
  );
}

function CodeSection() {
  const [lang, setLang] = useState<'js' | 'py'>('js');
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="Building a link" />
      <p className="text-sm text-muted-foreground mb-4">
        Both snippets produce the same link the site's own Share button does. The browser version needs no
        dependencies; the Python one uses only the standard library.
      </p>
      <div className="flex items-center gap-1 mb-3">
        <Button size="sm" variant={lang === 'js' ? 'default' : 'ghost'} onClick={() => setLang('js')}>JavaScript</Button>
        <Button size="sm" variant={lang === 'py' ? 'default' : 'ghost'} onClick={() => setLang('py')}>Python</Button>
      </div>
      <CodeBlock code={lang === 'js' ? JS_SNIPPET : PY_SNIPPET} />
    </section>
  );
}

function LinkBuilderSection() {
  const [commander, setCommander] = useState('Krenko, Mob Boss');
  const [partner, setPartner] = useState('');
  const [decklist, setDecklist] = useState(SAMPLE_DECKLIST);
  const [route, setRoute] = useState<string>(DESTINATIONS[0].route);
  const [tab, setTab] = useState<string>(TAB_SLUG_BY_KEY.overview);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isInspector = route.startsWith('analyze/');
  const effectiveRoute = isInspector ? `analyze/${tab}` : route;

  const cardNames = useMemo(() => {
    const cmd = commander.trim();
    const ptn = partner.trim();
    const names: string[] = [];
    for (const line of parseDeckLines(decklist)) {
      // A pasted commander line is dropped: deckToSharePayload prepends the commanders itself.
      if (line.name === cmd || (ptn && line.name === ptn)) continue;
      for (let i = 0; i < Math.max(1, line.quantity); i++) names.push(line.name);
    }
    return names;
  }, [decklist, commander, partner]);

  const build = useCallback(async () => {
    setError(null);
    setCopied(false);
    try {
      const payload = deckToSharePayload({
        cards: cardNames.map(name => ({ name })),
        commander: commander.trim() ? { name: commander.trim() } : null,
        partnerCommander: partner.trim() ? { name: partner.trim() } : null,
      });
      setUrl(await buildShareUrl(effectiveRoute, payload));
    } catch (e) {
      setUrl(null);
      if (e instanceof DeckLinkError && e.reason === 'too-large') setError('This deck is too large to fit in a link.');
      else if (e instanceof DeckLinkError && e.reason === 'malformed') setError('Add at least one card.');
      else setError('Could not build the link.');
    }
  }, [cardNames, commander, partner, effectiveRoute]);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }, [url]);

  const total = cardNames.length + (commander.trim() ? 1 : 0) + (partner.trim() ? 1 : 0);

  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="Try it" />
      <p className="text-sm text-muted-foreground mb-5">
        Paste a decklist, pick where it should open, and build a link with the same code the site uses.
        The link is generated in your browser and never leaves it until you share it.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Commander</span>
          <input value={commander} onChange={e => setCommander(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Partner / background (optional)</span>
          <input value={partner} onChange={e => setPartner(e.target.value)} className={INPUT_CLASS} />
        </label>
      </div>

      <label className="block mt-4">
        <span className="text-xs font-medium text-muted-foreground">Decklist ("1 Sol Ring" or "Sol Ring", one per line)</span>
        <textarea
          value={decklist}
          onChange={e => setDecklist(e.target.value)}
          rows={8}
          spellCheck={false}
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Open in</span>
          <select value={route} onChange={e => setRoute(e.target.value)} className={`${INPUT_CLASS} w-auto block`}>
            {DESTINATIONS.map(d => <option key={d.route} value={d.route}>{d.label}</option>)}
          </select>
        </label>
        {isInspector && (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Tab</span>
            <select value={tab} onChange={e => setTab(e.target.value)} className={`${INPUT_CLASS} w-auto block`}>
              {INSPECTOR_TABS.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
            </select>
          </label>
        )}
        <Button onClick={build} className="gap-2">
          <Link2 className="w-4 h-4" />
          Build link
        </Button>
        <span className="text-xs text-muted-foreground pb-2">{total} cards</span>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {url && !error && (
        <div className="mt-4">
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 font-mono text-xs break-all select-all">
            {url}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={copy} className="gap-1.5">
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              <ExternalLink className="w-4 h-4" />
              Open
            </a>
            <span className="text-xs text-muted-foreground">{url.length.toLocaleString()} characters</span>
          </div>
        </div>
      )}
    </section>
  );
}

function RulesSection() {
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <SectionHeader title="Good to know" />
      <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
        <li>
          <span className="text-foreground">Use the fragment, not the query string.</span> The decklist
          goes after <Code>#</Code>. A fragment never reaches a server, so decks stay out of request logs,
          and it survives the redirects that a <Code>?d=</Code> query would not.
        </li>
        <li>
          <span className="text-foreground">Links are stable.</span> Versions <Code>1</Code> and{' '}
          <Code>0</Code> will keep decoding. A future body format gets a new version number rather than a
          silent change.
        </li>
        <li>
          <span className="text-foreground">There is no read API.</span> ManaFoundry has no backend for
          decks. A link is the whole exchange, in one direction, and the recipient decides whether to keep it.
        </li>
        <li>
          <span className="text-foreground">Both hosts work.</span> The same fragment opens on{' '}
          <Code>manafoundry.gg</Code> and on the GitHub Pages mirror at{' '}
          <Code>20q2.github.io/mtg-commander-deck-generator</Code>. Prefer the first.
        </li>
        <li>
          Want the link format to carry something it does not yet?{' '}
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Open an issue
          </a>
          .
        </li>
      </ul>
    </section>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-lg font-semibold mb-3">{title}</h2>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-background/60 border border-border/40 px-1.5 py-0.5 text-[0.8em] font-mono text-foreground/90">
      {children}
    </code>
  );
}

function CodeBlock({ code, copyable = true, className = '' }: { code: string; copyable?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied; the block is selectable, so the user can copy by hand.
    }
  }, [code]);

  return (
    <div className={`relative ${className}`}>
      <pre className="rounded-lg border border-border/50 bg-black/30 p-4 pr-12 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
        {code}
      </pre>
      {copyable && (
        <Button
          size="icon"
          variant="ghost"
          onClick={copy}
          aria-label="Copy code"
          className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </Button>
      )}
    </div>
  );
}
