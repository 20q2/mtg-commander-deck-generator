import { useState, useMemo, useCallback, useEffect } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PasteLane, type PasteLaneResult } from '@/components/deck-source/PasteLane';
import { getCardsByNames, getGameChangerNames, isAnyLand } from '@/services/scryfall/client';
import { fetchColorIdentityCombos } from '@/services/edhrec/client';
import { loadTaggerData } from '@/services/tagger/client';
import { estimateBracket, type BracketEstimation } from '@/services/deckBuilder/bracketEstimator';
import {
  classifyShapes, measureFuel, estimateKill, comboEstimates, summarise, rankEstimates,
  loadMembership, defaultVocab, vocabToText, parseVocab,
  deriveColorIdentity, detectCompleteCombos,
  DEFAULT_ASSUMPTIONS, type FinisherAssumptions, type TagMembership,
} from '@/services/finishers';
import themeTestDecks from '@/data/themeTestDecks.json';
import type { ScryfallCard, DetectedCombo } from '@/types';
import { TagVocabularyPanel } from './TagVocabularyPanel';
import { FinisherTuningPanel } from './FinisherTuningPanel';
import { DeckFuelStrip } from './DeckFuelStrip';
import { FinisherClassifierTable, type ClassifiedCard } from './FinisherClassifierTable';
import { KillMathTable } from './KillMathTable';
import { PlayerView } from './PlayerView';

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

  /** Distinct cards — what the classifier lists. Sixteen Forests are one row, not sixteen. */
  const [cards, setCards] = useState<ScryfallCard[] | null>(null);
  /**
   * The same deck WITH quantities. Fuel has to count slots, not names: basics are 20-35 cards of a
   * real list, and collapsing them wrecks the land ratio that the whole mana ceiling rests on.
   */
  const [deckCards, setDeckCards] = useState<ScryfallCard[] | null>(null);
  /** Complete Spellbook combos in the deck. Feed the fuel stage, not a side list. */
  const [combos, setCombos] = useState<DetectedCombo[]>([]);
  /**
   * Whether the combo lookup has settled. Results are withheld until it has: combos arrive after
   * the cards do, and rendering in between flashes a confident wrong answer — a deck that wins on
   * the spot reads "grinds the table down" for a beat before correcting itself.
   */
  const [combosPending, setCombosPending] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Power-level context. A turn-8 kill is slow at bracket 4 and oppressive at bracket 2. */
  const [bracket, setBracket] = useState<BracketEstimation | null>(null);

  const [assumptions, setAssumptions] = useState<FinisherAssumptions>(DEFAULT_ASSUMPTIONS);
  const [view, setView] = useState<'player' | 'classifier' | 'killmath'>('player');

  const reloadTags = useCallback(async (text: string) => {
    setTagsLoading(true);
    setProgress('');
    try {
      // The tagger artifact is one cached S3 file and carries the whole role vocabulary — ramp
      // included. measureFuel reads ramp from it, so it has to be in before any scoring runs.
      const [membership] = await Promise.all([
        loadMembership(
          parseVocab(text),
          (done, total, key) => setProgress(`${done}/${total} · ${key}`),
        ),
        loadTaggerData(),
      ]);
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
    setCombosPending(true);
    setError(null);
    try {
      const cardMap = await getCardsByNames(result.cardNames);
      const distinct = [...cardMap.values()];
      setCards(distinct);
      // cardNames still carries duplicates; the map is keyed by the name as given, so this
      // rebuilds the deck at its real size.
      setDeckCards(result.cardNames
        .map(n => cardMap.get(n))
        .filter((c): c is ScryfallCard => c !== undefined));
      setDeckName(name ?? result.commanderName ?? 'pasted deck');

      // Combos come from the Spellbook artifact (one file per identity), not Scryfall — no
      // rate-limit pressure. Non-fatal: without them the deck simply reads as having no combo.
      try {
        const identity = deriveColorIdentity(distinct);
        const pool = await fetchColorIdentityCombos(identity);
        const names = new Set(distinct.map(c => c.name));
        for (const c of distinct) if (c.name.includes(' // ')) names.add(c.name.split(' // ')[0]);
        const found = detectCompleteCombos(pool, names);
        setCombos(found);
        console.log(`[FinisherLab] ${identity.join('') || 'C'} → ${pool.length} combos in pool, ${found.length} complete in deck`);

        // Tagger data is already in from the mount sweep; the bracket needs it for
        // mass-land-denial / extra-turn / tutor signals.
        const gameChangers = await getGameChangerNames();
        const allNames = result.cardNames;
        const landNames = new Set(distinct.filter(isAnyLand).map(c => c.name));
        const nonLand = distinct.filter(c => !isAnyLand(c));
        const avgCmc = nonLand.length
          ? nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length
          : 0;
        setBracket(estimateBracket(
          allNames, landNames, found, avgCmc, undefined, undefined, gameChangers,
        ));
      } catch {
        setCombos([]);
        setBracket(null);
      } finally {
        setCombosPending(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-scored on every assumption change. Pure local computation over ~99 cards.
  const scored = useMemo(() => {
    if (!cards || !deckCards || !tags || combosPending) return null;
    const fuel = measureFuel(deckCards, tags, combos);
    const rows: ClassifiedCard[] = cards.map(card => {
      const matches = classifyShapes(card, tags);
      return {
        card, matches,
        estimates: matches.map(m => estimateKill(card, m, fuel, assumptions)),
      };
    });
    const all = [...rows.flatMap(r => r.estimates), ...comboEstimates(combos, assumptions)];
    return { fuel, rows, ranked: rankEstimates(all), verdict: summarise(all, assumptions) };
  }, [cards, deckCards, tags, combos, assumptions]);

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

      {(loading || tagsLoading || combosPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {tagsLoading
            ? `Fetching oracle tags… ${progress}`
            : loading ? 'Resolving cards…' : 'Checking for combos…'}
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
              {/* Instrument read-out, not product surface — hidden on the Player view. */}
              {view !== 'player' && (
                <DeckFuelStrip
                  fuel={scored.fuel}
                  verdict={scored.verdict}
                  assumptions={assumptions}
                  comboCount={combos.length}
                />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {([
                  ['player', 'Player'],
                  ['classifier', 'Classifier'],
                  ['killmath', 'Kill math'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      view === key ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-xs text-muted-foreground">
                  {deckName} · {deckCards?.length ?? 0} cards ({cards?.length ?? 0} distinct)
                </span>
              </div>
              {view === 'player' ? (
                <PlayerView
                  estimates={scored.ranked}
                  fuel={scored.fuel}
                  verdict={scored.verdict}
                  combos={combos}
                  assumptions={assumptions}
                  bracket={bracket}
                />
              ) : view === 'classifier' ? (
                <FinisherClassifierTable rows={scored.rows} />
              ) : (
                <KillMathTable estimates={scored.ranked} />
              )}
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
