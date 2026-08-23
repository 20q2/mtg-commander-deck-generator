import { useState, useCallback } from 'react';
import { Tags, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ScryfallCard, EDHRECCommanderData } from '@/types';
import { fetchCommanderThemes, fetchCommanderThemeData, fetchPartnerThemeData, fetchTagPageData } from '@/services/edhrec/client';
import { type ThemeMatchResult } from '@/services/deckBuilder/themeDetector';
import { detectDeckThemes } from '@/services/deckBuilder/detectDeckThemes';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { ThemeSearchList } from '@/components/theme/ThemeSearchList';

export interface SelectedTheme { name: string; slug: string }

interface ThemePickerPopoverProps {
  themes: SelectedTheme[];
  onChange: (themes: SelectedTheme[]) => void;
  commanderName?: string;
  partnerCommanderName?: string;
  /** Current mainboard cards — powers the archetype-data theme detection. */
  deckCards: ScryfallCard[];
  /** EDHREC page segment for "choose a color" commanders (see edhrecColorSegment); '' otherwise. */
  colorSegment?: string;
}

const MAX_THEMES = 2;            // matches the generator's theme limit

/** An off-list theme has no commander+theme page, so it is scored against the archetype pool.
 *  Colour-agnostic here: the picker has no colour identity in hand, and the tag page's own
 *  fallback covers it. */
async function archetypePage(slug: string): Promise<EDHRECCommanderData> {
  const tagData = await fetchTagPageData(slug, []);
  if (!tagData) throw new Error(`No EDHREC data for theme "${slug}"`);
  return {
    themes: [],
    stats: {
      avgPrice: 0, numDecks: 0, deckSize: 81, manaCurve: {},
      typeDistribution: { creature: 0, instant: 0, sorcery: 0, artifact: 0, enchantment: 0, land: 0, planeswalker: 0, battle: 0 },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: tagData.cardlists,
    similarCommanders: [],
  } as unknown as EDHRECCommanderData;
}

/**
 * Why the detector thinks this, in something the user can go and check.
 *
 * Not the composite score. That is an internal 0-100 that reads like a percentage, so a
 * thoroughly confident 36 looked like a failing grade — and the same number is already printed
 * against every theme in the list right below this. Nor the raw page overlap ("17 of your 75 cards
 * fit the archetype"), which counted every generic staple sitting on a ~300-card theme page: it
 * sounded weak when the verdict was strong, and it wasn't measuring what it claimed.
 *
 * The count of the user's own cards that carry the theme IS checkable. They can open the deck and
 * see them. Literal and inferred evidence get different wording because they deserve different
 * trust: one is read off the card, the other guessed from how the card tends to be played.
 */
function themeEvidence(m: ThemeMatchResult): string {
  if (m.literalCount > 0) {
    // "17 of your cards are Auras", not "carry Auras" — for a subtype or a tribe the cards ARE
    // the thing. A mechanic or counter type is something a card has.
    const verb = m.themeKind === 'subtype' || m.themeKind === 'tribal' || m.themeKind === 'cardType'
      ? 'are'
      : 'carry';
    return `${m.literalCount} of your cards ${verb} ${m.theme.name}`;
  }
  if (m.memberCount > 0) {
    return `${m.memberCount} of your cards play like ${m.theme.name}`;
  }
  // No card-level evidence at all — the verdict rests on EDHREC overlap alone. Say so, rather
  // than dressing page presence up as fit.
  return `${m.cardOverlap} of your cards show up in ${m.theme.name} decks`;
}

/** How many member names fit on one line of a 320px popover. */
const NAMES_SHOWN = 3;

/**
 * The receipts. A user given "17 of your cards are Auras" on a land-ramp deck counted seven and
 * reported it as a bug — the count was exact, but every one of the seventeen was a mana Aura
 * (Utopia Sprawl, Wild Growth) that doesn't feel like one. Naming three of them collapses that
 * whole misunderstanding into a glance, and the full list is in the tooltip.
 */
function memberPreview(m: ThemeMatchResult): { text: string; full: string } | null {
  if (m.memberNames.length === 0) return null;
  const shown = m.memberNames.slice(0, NAMES_SHOWN);
  const rest = m.memberNames.length - shown.length;
  return {
    text: shown.join(', ') + (rest > 0 ? ` +${rest} more` : ''),
    full: m.memberNames.join(', '),
  };
}

interface Detection {
  /** Confident best guess (1-2 themes) per the Inspector's thresholds, or null. */
  guess: ThemeMatchResult[] | null;
  /** All evaluated candidates, score-ordered. */
  evaluated: ThemeMatchResult[];
  deckNonBasicCount: number;
}

export function ThemePickerPopover({ themes, onChange, commanderName, partnerCommanderName, deckCards, colorSegment = '' }: ThemePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [detectionStarted, setDetectionStarted] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy: detection runs on first open, fail-open. (Taxonomy loads inside ThemeSearchList.)
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next || detectionStarted) return;
    setDetectionStarted(true);
    setLoading(true);
    void (async () => {
      try {
        if (!commanderName) { setDetection(null); return; }

        // The SAME service the Inspector runs, not a local variant of it. This used to call
        // detectThemes without the classifier's membership scores, which silently selected a
        // different scoring path: scoreThemeMatch renormalizes when membership is absent, pushing
        // overlap from 40% of the composite to 62%, and since theme pages overlap most decks almost
        // entirely that pinned several themes at 100 while the Inspector reported far lower numbers
        // for the same deck. It also evaluated five commander taglinks with no off-list promotion,
        // so a deck whose real archetype sits outside the commander's top five could never be named
        // here at all.
        const commanderThemes = await fetchCommanderThemes(commanderName).catch(() => []);
        const result = (await detectDeckThemes({
          cards: deckCards,
          commanderName,
          commanderThemes,
          logLabel: 'ThemePicker',
          fetchThemeData: (slug, opts) => opts?.archetypeOnly
            ? archetypePage(slug)
            : (partnerCommanderName
                ? fetchPartnerThemeData(commanderName, partnerCommanderName, slug, undefined, undefined, colorSegment)
                : fetchCommanderThemeData(commanderName, slug, undefined, undefined, colorSegment)),
        })).detection;
        if (!result) { setDetection(null); return; }

        const nonBasic = deckCards.filter(c => {
          const tl = getFrontFaceTypeLine(c).toLowerCase();
          return !(tl.includes('basic') && tl.includes('land'));
        }).length;
        setDetection({
          guess: result.isConfident && result.matchedThemes.length > 0 ? result.matchedThemes : null,
          evaluated: result.evaluatedThemes.filter(t => t.cardOverlap > 0),
          deckNonBasicCount: nonBasic,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [detectionStarted, commanderName, partnerCommanderName, deckCards]);

  const addTheme = (t: SelectedTheme) => {
    if (themes.length >= MAX_THEMES || themes.some(s => s.slug === t.slug)) return;
    onChange([...themes, t]);
  };
  const removeTheme = (slug: string) => onChange(themes.filter(t => t.slug !== slug));

  const applyGuess = (guess: ThemeMatchResult[]) => {
    onChange(guess.slice(0, MAX_THEMES).map(m => ({ name: m.theme.name, slug: m.theme.slug })));
  };

  const selectedSlugs = new Set(themes.map(t => t.slug));
  const guessSlugs = new Set((detection?.guess ?? []).map(m => m.theme.slug));
  const guessApplied = detection?.guess != null && detection.guess.every(m => selectedSlugs.has(m.theme.slug));

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2 text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent hover:border-border/40"
        >
          <Tags className="w-3.5 h-3.5 text-violet-300/70" />
          {themes.length > 0
            ? <span className="text-xs text-violet-200/90">{themes.map(t => t.name).join(' + ')}</span>
            : <span className="text-xs hidden sm:inline">Theme</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-3 space-y-3">
        <div className="text-xs font-medium text-foreground/90">Deck theme (max {MAX_THEMES})</div>

        {themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {themes.map(t => (
              <button
                key={t.slug}
                onClick={() => removeTheme(t.slug)}
                aria-label={`Remove ${t.name}`}
                title="Click to remove"
                className="inline-flex items-center gap-1 rounded-full bg-violet-500/25 border border-violet-400/60 pl-2.5 pr-1.5 py-0.5 text-xs font-medium text-violet-100 hover:bg-violet-500/40 transition-colors"
              >
                {t.name}
                <X className="w-3 h-3 text-violet-200/70" />
              </button>
            ))}
            {themes.length >= MAX_THEMES && (
              <span className="text-[11px] text-muted-foreground/70 self-center">Max {MAX_THEMES} — remove one to swap</span>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Interpreting your deck's EDHREC data…
          </div>
        )}

        {!loading && detection?.guess && !guessApplied && (
          <button
            onClick={() => applyGuess(detection.guess!)}
            className="w-full text-left rounded-lg border border-violet-400/30 bg-violet-500/10 px-2.5 py-2 hover:bg-violet-500/20 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-violet-300/90">
              <Tags className="w-3.5 h-3.5" />
              This looks like {detection.guess.map(m => m.theme.name).join(' + ')}
            </div>
            <div className="mt-1 space-y-1">
              {detection.guess.map(m => {
                const names = memberPreview(m);
                return (
                  <div key={m.theme.slug}>
                    <div className="text-[11px] text-muted-foreground">{themeEvidence(m)}</div>
                    {names && (
                      <div
                        className="text-[10px] text-muted-foreground/60 truncate"
                        title={names.full}
                      >
                        {names.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] font-medium text-violet-300/70 mt-1.5">Tap to apply</div>
          </button>
        )}

        <ThemeSearchList
          enabled={open}
          onPick={addTheme}
          disabledSlugs={selectedSlugs}
          disableAll={themes.length >= MAX_THEMES}
          suggestions={detection?.evaluated.slice(0, 4).map(m => ({
            name: m.theme.name,
            slug: m.theme.slug,
            score: m.score,
            isBestGuess: guessSlugs.has(m.theme.slug),
          }))}
        />
      </PopoverContent>
    </Popover>
  );
}
