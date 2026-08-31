import { useState, useMemo, useCallback, useEffect } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PasteLane, type PasteLaneResult } from '@/components/deck-source/PasteLane';
import { getCardsByNames } from '@/services/scryfall/client';
import {
  classifyShapes, measureFuel, estimateKill, summarise, rankEstimates,
  loadMembership, defaultVocab, vocabToText, parseVocab,
  DEFAULT_ASSUMPTIONS, type FinisherAssumptions, type TagMembership,
} from '@/services/finishers';
import themeTestDecks from '@/data/themeTestDecks.json';
import type { ScryfallCard } from '@/types';
import { TagVocabularyPanel } from './TagVocabularyPanel';
import { FinisherTuningPanel } from './FinisherTuningPanel';
import { DeckFuelStrip } from './DeckFuelStrip';
import { FinisherClassifierTable, type ClassifiedCard } from './FinisherClassifierTable';
import { KillMathTable } from './KillMathTable';

interface TestDeck { name: string; commander: string; expect: string[]; cards: string[] }

/**
 * Which cards in a deck can actually end the game, and whether this deck turns them on.
 *
 * Tag membership is fetched once per session and held here; assumptions re-score locally, which
 * is what makes the sliders a feedback loop rather than a reload cycle.
 */
export function FinisherLabTab() {
  const [tags, setTags] = useState<TagMembership | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [vocabText, setVocabText] = useState(() => vocabToText(defaultVocab()));

  const [cards, setCards] = useState<ScryfallCard[] | null>(null);
  const [deckName, setDeckName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assumptions, setAssumptions] = useState<FinisherAssumptions>(DEFAULT_ASSUMPTIONS);
  const [view, setView] = useState<'classifier' | 'killmath'>('classifier');

  const reloadTags = useCallback(async (text: string) => {
    setTagsLoading(true);
    setProgress('');
    try {
      const membership = await loadMembership(
        parseVocab(text),
        (done, total, key) => setProgress(`${done}/${total} · ${key}`),
      );
      setTags(membership);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTagsLoading(false);
      setProgress('');
    }
  }, []);

  // Fetch the default vocabulary once on mount so the tab is usable immediately.
  useEffect(() => {
    void reloadTags(vocabToText(defaultVocab()));
  }, [reloadTags]);

  const handleSubmit = useCallback(async (result: PasteLaneResult, name?: string) => {
    setLoading(true);
    setError(null);
    try {
      const cardMap = await getCardsByNames(result.cardNames);
      setCards([...cardMap.values()]);
      setDeckName(name ?? result.commanderName ?? 'pasted deck');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-scored on every assumption change. Pure local computation over ~99 cards.
  const scored = useMemo(() => {
    if (!cards || !tags) return null;
    const fuel = measureFuel(cards, tags);
    const rows: ClassifiedCard[] = cards.map(card => {
      const matches = classifyShapes(card, tags);
      return {
        card, matches,
        estimates: matches.map(m => estimateKill(card, m, fuel, assumptions)),
      };
    });
    const all = rows.flatMap(r => r.estimates);
    return { fuel, rows, ranked: rankEstimates(all), verdict: summarise(all, assumptions) };
  }, [cards, tags, assumptions]);

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Which cards can actually end the game, scored as a fraction of the table killed.
        Single-target shapes cap at 1/opponents — that ceiling is the point.
      </p>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Test decks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(themeTestDecks.decks as TestDeck[]).map(d => (
              <button
                key={d.name}
                disabled={loading || !tags}
                onClick={() => handleSubmit({ cardNames: d.cards, commanderName: d.commander }, d.name)}
                className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-40 ${
                  deckName === d.name ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                }`}
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
            onSubmit={r => handleSubmit(r)}
            loading={loading}
            ctaLabel="Score finishers →"
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

      {(loading || tagsLoading) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {tagsLoading ? `Fetching oracle tags… ${progress}` : 'Resolving cards…'}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <FinisherTuningPanel value={assumptions} onChange={setAssumptions} />
          <TagVocabularyPanel
            text={vocabText}
            onChange={setVocabText}
            onReload={() => void reloadTags(vocabText)}
            onReset={() => setVocabText(vocabToText(defaultVocab()))}
            loading={tagsLoading}
            sizes={tags?.sizes ?? {}}
          />
        </div>

        <div className="space-y-3 min-w-0">
          {scored ? (
            <>
              <DeckFuelStrip fuel={scored.fuel} verdict={scored.verdict} assumptions={assumptions} />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('classifier')}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    view === 'classifier' ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                  }`}
                >
                  Classifier
                </button>
                <button
                  onClick={() => setView('killmath')}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    view === 'killmath' ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                  }`}
                >
                  Kill math
                </button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {deckName} · {cards?.length ?? 0} cards
                </span>
              </div>
              {view === 'classifier'
                ? <FinisherClassifierTable rows={scored.rows} />
                : <KillMathTable estimates={scored.ranked} />}
            </>
          ) : (
            <p className="text-xs text-muted-foreground rounded-lg border border-border/40 bg-card/30 px-3 py-4">
              Pick a test deck or paste a list to score it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
