import { useState, useMemo, useCallback } from 'react';
import { Loader2, FlaskConical, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PasteLane, type PasteLaneResult } from '@/components/deck-source/PasteLane';
import { ThemeScoreTable } from '@/components/themelab/ThemeScoreTable';
import { CardThemeTable } from '@/components/themelab/CardThemeTable';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getCardsByNames, getMtgCatalogs, type MtgCatalogs } from '@/services/scryfall/client';
import { fetchAllTags, fetchCommanderThemes } from '@/services/edhrec/client';
import { loadTagIndex, tagsForOracleId } from '@/services/spellchroma/tagIndex';
import {
  buildThemeModel, scoreThemesForDeck, loadThemeCharTags, survivingThemes,
  DEFAULT_TUNING, TUNING_FIELDS, type ThemeTuning, type ThemeModel, type ThemeScore,
} from '@/services/themes';
import themeTestDecks from '@/data/themeTestDecks.json';
import type { ScryfallCard } from '@/types';

interface TestDeck { name: string; commander: string; expect: string[]; cards: string[] }

/** Everything the scorer needs, gathered once per pasted deck so tuning re-runs stay local. */
interface LabInput {
  commanderName: string;
  cards: ScryfallCard[];
  models: ThemeModel[];
  commanderThemeSlugs: Set<string>;
  /** slug → how many EDHREC decks pair this commander with this theme. */
  commanderThemeCounts: Map<string, number>;
  tagIndexLoaded: boolean;
  catalogs: MtgCatalogs;
  tableGeneratedAt: string | null;
  /** Format staples, neutral evidence for archetype themes. */
  staples: Set<string>;
  taggedCards: number;
  /** Theme slugs the fixture says SHOULD win, when a preset deck was loaded. */
  expected?: string[];
  fixtureName?: string;
}

export function ThemeLabPage() {
  usePageTitle('Theme Lab');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<LabInput | null>(null);
  const [tuning, setTuning] = useState<ThemeTuning>(DEFAULT_TUNING);
  const [tab, setTab] = useState<'themes' | 'cards'>('themes');

  const handleSubmit = useCallback(async (
    result: PasteLaneResult,
    fixture?: { name: string; expect: string[] },
  ) => {
    setLoading(true);
    setError(null);
    try {
      const [cardMap, tags, catalogs, tagIndexLoaded] = await Promise.all([
        getCardsByNames(result.cardNames),
        fetchAllTags(),
        getMtgCatalogs(),
        loadTagIndex(),
      ]);
      if (tags.length === 0) throw new Error('EDHREC tag taxonomy came back empty');

      const table = loadThemeCharTags();
      const live = new Set(table.forceArchetype ?? []);
      const models = tags.map(t => buildThemeModel(t, catalogs, table.themes, live));

      // The commander's own EDHREC themes are the prior. Non-fatal: without it every theme is
      // simply treated as off-list, which is worth seeing rather than failing over.
      let commanderThemeSlugs = new Set<string>();
      const commanderThemeCounts = new Map<string, number>();
      if (result.commanderName) {
        try {
          const themes = await fetchCommanderThemes(result.commanderName);
          commanderThemeSlugs = new Set(themes.map(t => t.slug));
          // How many EDHREC decks actually pair this commander with this theme — the sanity check on
          // a detection. "Nath + Discard, 312 decks" is a real archetype; 4 decks is a coincidence.
          for (const t of themes) commanderThemeCounts.set(t.slug, t.count);
        } catch { /* prior unavailable — every theme reads as off-list */ }
      }

      const cards = [...cardMap.values()];
      setInput({
        commanderName: result.commanderName ?? '(none)',
        cards,
        models,
        commanderThemeSlugs,
        commanderThemeCounts,
        tagIndexLoaded,
        catalogs,
        tableGeneratedAt: table.generatedAt,
        staples: new Set(table.staples ?? []),
        taggedCards: cards.filter(c => c.oracle_id && tagsForOracleId(c.oracle_id).length > 0).length,
        expected: fixture?.expect,
        fixtureName: fixture?.name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-scored on every tuning change. Pure local computation over ~400 themes × ~99 cards, which is
  // what makes the panel below a feedback loop rather than a rebuild cycle.
  const scores = useMemo(() => {
    if (!input) return [];
    return scoreThemesForDeck(
      input.cards, input.models,
      c => (c.oracle_id ? tagsForOracleId(c.oracle_id) : []),
      input.commanderThemeSlugs, tuning, input.staples,
      input.cards.find(c => c.name === input.commanderName) ?? null,
    );
  }, [input, tuning]);

  const survivors = survivingThemes(scores);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-amber-400/90" />
        <h1 className="text-xl font-semibold">Theme Lab</h1>
        <span className="text-xs text-muted-foreground">
          dev only · how a deck gets measured against the EDHREC taxonomy
        </span>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Test decks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Ten hand-built decks, each an unambiguous example of one archetype. Click one to score it
            and check the expected theme against what actually surfaces.
          </p>
          <div className="flex flex-wrap gap-2">
            {(themeTestDecks.decks as TestDeck[]).map(d => (
              <button
                key={d.name}
                disabled={loading}
                onClick={() => handleSubmit(
                  { cardNames: d.cards, commanderName: d.commander },
                  { name: d.name, expect: d.expect },
                )}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-40 ${
                  input?.fixtureName === d.name
                    ? 'bg-accent border-primary/50'
                    : 'border-border/50 hover:bg-accent/50'
                }`}
                title={`expects: ${d.expect.join(', ')}`}
              >
                {d.name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">…or drop your own in</CardTitle></CardHeader>
        <CardContent>
          <PasteLane
            onSubmit={handleSubmit}
            loading={loading}
            ctaLabel="Score themes →"
            ctaLoadingLabel="Scoring…"
            requireCommander={false}
          />
          {error && (
            <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" />{error}
            </p>
          )}
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Resolving cards, taxonomy, catalogs and the tag index…
        </div>
      )}

      {input && (
        <>
          {input.expected && <Verdict input={input} survivors={survivors} />}
          <HealthStrip input={input} />

          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <TuningPanel tuning={tuning} onChange={setTuning} />

            <div className="space-y-3 min-w-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTab('themes')}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    tab === 'themes' ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                  }`}
                >
                  By theme
                </button>
                <button
                  onClick={() => setTab('cards')}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    tab === 'cards' ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                  }`}
                >
                  By card
                </button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {survivors.length} of {input.models.length} themes survive ·{' '}
                  {survivors.slice(0, 2).map(s => s.model.name).join(' + ') || 'nothing detected'}
                </span>
              </div>

              {tab === 'themes'
                ? <ThemeScoreTable scores={scores} deckCounts={input.commanderThemeCounts} />
                : <CardThemeTable scores={scores} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Expected vs. actual for a fixture deck. PASS means an expected theme is the top survivor; PARTIAL
 * means it surfaced but not first, which is usually the interesting case; MISS means it didn't
 * clear the guards at all.
 */
function Verdict({ input, survivors }: { input: LabInput; survivors: ThemeScore[] }) {
  const expected = input.expected ?? [];
  const top = survivors[0]?.model.slug;
  const rank = survivors.findIndex(s => expected.includes(s.model.slug));
  const state = expected.includes(top ?? '') ? 'PASS' : rank >= 0 ? 'PARTIAL' : 'MISS';
  const tone = state === 'PASS'
    ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
    : state === 'PARTIAL'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
      : 'border-red-500/40 bg-red-500/5 text-red-300';
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 ${tone}`}>
      <span className="font-semibold">{state}</span>
      <span>{input.fixtureName}</span>
      <span className="text-muted-foreground">
        expected <strong>{expected.join(' or ')}</strong>
      </span>
      <span className="text-muted-foreground">
        got <strong>{survivors.slice(0, 3).map(s => `${s.model.name} (${s.confidence}%)`).join(', ') || 'nothing'}</strong>
      </span>
      {state === 'PARTIAL' && (
        <span className="text-muted-foreground">expected theme ranked #{rank + 1}</span>
      )}
    </div>
  );
}

/** Which data layer died, when everything mysteriously scores zero. */
function HealthStrip({ input }: { input: LabInput }) {
  const items = [
    { ok: input.catalogs.creatureTypes.size > 0,
      label: `Scryfall catalogs (${input.catalogs.mechanics.size} mechanics, ${input.catalogs.creatureTypes.size} types)`,
      bad: 'Scryfall catalogs empty — every theme falls back to archetype' },
    { ok: input.tagIndexLoaded,
      label: `SpellChroma tag index (${input.taggedCards}/${input.cards.length} deck cards tagged)`,
      bad: 'Tag index unavailable — archetype themes find no members' },
    { ok: input.tableGeneratedAt !== null,
      label: `Theme table built ${input.tableGeneratedAt?.slice(0, 10)}`,
      bad: 'themeCharTags.json never generated — run npm run build:theme-tags' },
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs rounded-lg border border-border/40 bg-card/30 px-3 py-2">
      <span className="text-muted-foreground">
        {input.commanderName} · {input.cards.length} cards
      </span>
      {items.map(i => (
        <span key={i.label} className={`flex items-center gap-1.5 ${i.ok ? 'text-muted-foreground' : 'text-amber-400'}`}>
          {i.ok
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
            : <XCircle className="w-3.5 h-3.5" />}
          {i.ok ? i.label : i.bad}
        </span>
      ))}
    </div>
  );
}

function TuningPanel({ tuning, onChange }: { tuning: ThemeTuning; onChange: (t: ThemeTuning) => void }) {
  const dirty = TUNING_FIELDS.some(f => tuning[f.key] !== DEFAULT_TUNING[f.key]);
  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Tuning</CardTitle>
        {dirty && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange(DEFAULT_TUNING)}>
            <RotateCcw className="w-3 h-3 mr-1" />Reset
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {TUNING_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-xs font-medium" title={f.hint}>{f.label}</label>
              <span className="text-xs tabular-nums text-violet-300/90">{tuning[f.key]}</span>
            </div>
            <input
              type="range"
              min={f.min} max={f.max} step={f.step}
              value={tuning[f.key]}
              onChange={e => onChange({ ...tuning, [f.key]: Number(e.target.value) })}
              className="w-full accent-primary h-1"
            />
            <p className="text-[10px] text-muted-foreground leading-tight">{f.hint}</p>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          Changes are live and local to this page. Write the winners back into
          <code className="mx-1">src/services/themes/tuning.ts</code>.
        </p>
      </CardContent>
    </Card>
  );
}
