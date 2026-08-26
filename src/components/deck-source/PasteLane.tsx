import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CollectionImporter,
  type CollectionImporterHandle,
  type ImportResult,
} from '@/components/collection/CollectionImporter';
import { HydrationSteps, type HydrationStepItem } from '@/components/analyze/HydrationSteps';
import type { HydrateStage } from '@/components/analyze/analyzeHydration';
import { searchCommanders, getCardImageUrl } from '@/services/scryfall/client';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import type { ScryfallCard } from '@/types';

export interface PasteLaneResult {
  cardNames: string[];
  /** Absent only when the lane allows commander-less decks (see `requireCommander`). */
  commanderName?: string;
  partnerCommanderName?: string;
}

interface PasteLaneProps {
  /**
   * May return a promise. If it settles while the lane is still mounted — the
   * Inspector failed to hydrate (its error banner shows above the lane) or
   * Theme Lab finished scoring (results render below it) — the lane slides
   * back to the editable paste. Pages that navigate away on success (Inspector,
   * Playtest) simply unmount it first.
   */
  onSubmit: (result: PasteLaneResult) => void | Promise<void>;
  loading: boolean;
  ctaLabel?: string;
  ctaLoadingLabel?: string;
  /**
   * Inspector analysis is meaningless without a commander, so it gates the CTA on
   * one. Playtest doesn't: an empty command zone is a legal way to goldfish a
   * partial list, so it opts out and gets a "Continue without commander" path.
   */
  requireCommander?: boolean;
  /**
   * Inspector-only: passing this prop (even as null) adds the three hydration
   * steps to the resolve card; the value drives which one is active.
   */
  hydrateStage?: HydrateStage | null;
  /** Inspector-only: x/y counter for the "Fetching card data" step. */
  cardProgress?: { fetched: number; total: number } | null;
}

const HYDRATE_ORDER: HydrateStage[] = ['fetching-cards', 'detecting-combos', 'analyzing-roles', 'done'];

export function PasteLane({
  onSubmit,
  loading,
  ctaLabel = 'Inspect →',
  ctaLoadingLabel = 'Inspecting…',
  requireCommander = true,
  hydrateStage,
  cardProgress,
}: PasteLaneProps) {
  const [step, setStep] = useState<'paste' | 'resolve'>('paste');

  // ── Validation run ──
  const [hasPending, setHasPending] = useState(false);
  const [emptyParse, setEmptyParse] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateProgress, setValidateProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // ── Commander resolution ──
  const [importedCards, setImportedCards] = useState<string[]>([]);
  const [legendaries, setLegendaries] = useState<ScryfallCard[]>([]);
  const [commanderCard, setCommanderCard] = useState<ScryfallCard | null>(null);
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackResults, setFallbackResults] = useState<ScryfallCard[]>([]);
  const [fallbackSearching, setFallbackSearching] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ card: ScryfallCard; top: number; left: number; below: boolean } | null>(null);

  const importerRef = useRef<CollectionImporterHandle>(null);
  // Refs mirror what the async click handler reads AFTER awaiting triggerImport —
  // the state values captured in its closure would be stale by then. The
  // legendaries ref also keeps its original job: the importer fires
  // onLegendariesDetected BEFORE its auto-pick onCommanderDetected, so the
  // commander callback can tell multi-legendary ambiguity apart from a *CMDR*
  // marker (which fires before legendaries are scanned).
  const importedRef = useRef<string[]>([]);
  const legendariesRef = useRef<ScryfallCard[]>([]);
  const commanderRef = useRef<ScryfallCard | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleImportCards = useCallback((validatedNames: string[]) => {
    importedRef.current = validatedNames;
    setImportedCards(validatedNames);
    return { added: validatedNames.length, updated: 0 };
  }, []);

  const handleCommanderDetected = useCallback((card: ScryfallCard) => {
    // Suppress the importer's auto-pick when multiple legendaries are present.
    if (legendariesRef.current.length > 1) return;
    commanderRef.current = card;
    setCommanderCard(card);
  }, []);

  const handleLegendariesDetected = useCallback((found: ScryfallCard[]) => {
    legendariesRef.current = found;
    setLegendaries(found);
  }, []);

  const pickCommander = useCallback((card: ScryfallCard) => {
    commanderRef.current = card;
    setCommanderCard(card);
  }, []);

  const runFallbackSearch = useCallback(async (q: string) => {
    setFallbackQuery(q);
    if (q.trim().length < 2) { setFallbackResults([]); return; }
    setFallbackSearching(true);
    try {
      const results = await searchCommanders(q.trim());
      setFallbackResults(results.slice(0, 8));
    } finally {
      setFallbackSearching(false);
    }
  }, []);

  const handleChipHover = useCallback((card: ScryfallCard, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isDesktop = window.innerWidth >= 768;
    setHoverPreview({
      card,
      top: isDesktop ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
      below: isDesktop,
    });
  }, []);

  const renderCommanderChip = useCallback((card: ScryfallCard, onClick: () => void) => (
    <button
      key={card.name}
      // Dismiss the preview here, not just on mouse-leave: picking a commander unmounts the whole
      // chip row, so onMouseLeave never fires and the floating image would hang around forever.
      onClick={() => { setHoverPreview(null); onClick(); }}
      onMouseEnter={(e) => handleChipHover(card, e)}
      onMouseLeave={() => setHoverPreview(null)}
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent hover:border-primary/50 transition-colors"
    >
      <CardTypeIcon type="commander" size="sm" className="text-amber-300/90 opacity-90" />
      {card.name}
    </button>
  ), [handleChipHover]);

  const submitRun = useCallback(async (cmdr: ScryfallCard | null, cards: string[]) => {
    setSubmitted(true);
    const names = cmdr && !cards.includes(cmdr.name) ? [cmdr.name, ...cards] : cards;
    const ret = onSubmit(cmdr ? { cardNames: names, commanderName: cmdr.name } : { cardNames: names });
    if (ret && typeof (ret as Promise<void>).then === 'function') {
      await (ret as Promise<void>).catch(() => {});
      // Still mounted = the page didn't navigate away. Back to the editable paste.
      if (mountedRef.current) {
        setSubmitted(false);
        setStep('paste');
      }
    }
  }, [onSubmit]);

  const handleInspectClick = useCallback(async () => {
    const count = importerRef.current?.parsePendingCount() ?? 0;
    if (count === 0) {
      setEmptyParse(true);
      return;
    }
    // Fresh run: wipe every trace of the previous attempt.
    importedRef.current = [];
    legendariesRef.current = [];
    commanderRef.current = null;
    setImportedCards([]);
    setLegendaries([]);
    setCommanderCard(null);
    setImportResult(null);
    setValidateError(null);
    setValidateProgress(null);
    setEmptyParse(false);
    setSubmitted(false);
    setFallbackQuery('');
    setFallbackResults([]);

    setValidating(true);
    setStep('resolve');
    try {
      const result = await importerRef.current!.triggerImport();
      if (!mountedRef.current) return;
      if (!result) {
        // triggerImport never rejects — a null here after a non-empty parse means
        // the Scryfall lookup failed (the importer caught it internally).
        setValidateError('Validation failed — check your connection and try again.');
        return;
      }
      setImportResult(result);
      const cmdr = commanderRef.current;
      const cards = importedRef.current;
      if (cards.length === 0) {
        // Every single name failed lookup; the not-found box says so.
        return;
      }
      if (result.notFound.length === 0 && cmdr) {
        void submitRun(cmdr, cards);
      }
      // Otherwise: paused — the resolve card shows pickers/errors and waits.
    } finally {
      if (mountedRef.current) setValidating(false);
    }
  }, [submitRun]);

  const handleBackToEdit = useCallback(() => {
    setStep('paste');
  }, []);

  // ── Derived resolve-card state ──
  const showHydration = hydrateStage !== undefined;
  const hydrating = submitted && showHydration && !!hydrateStage;
  const paused = !validating && !submitted && !!importResult;
  const verb = ctaLabel.replace(/\s*→\s*$/, '');
  const showLegendaryPicker = paused && legendaries.length > 1 && !commanderCard;
  const showFallback = paused && importedCards.length > 0 && legendaries.length === 0 && !commanderCard;
  const commanderMissing = paused && !commanderCard;
  const canContinue = paused && importedCards.length > 0 && !!commanderCard && !loading;

  const steps: HydrationStepItem[] = [
    { id: 'validate', label: 'Validating card names', count: validateProgress },
    ...(showHydration ? [
      { id: 'fetching-cards', label: 'Fetching card data from Scryfall', count: cardProgress ?? null },
      { id: 'detecting-combos', label: 'Detecting commander combos' },
      { id: 'analyzing-roles', label: 'Analyzing roles, curve & mana' },
    ] : []),
  ];
  const currentIdx = validating ? 0
    : validateError ? 0
    : hydrating ? 1 + HYDRATE_ORDER.indexOf(hydrateStage!)
    : importResult ? 1
    : 0;
  const idle = !validating && !hydrating && !(submitted && loading);

  const pastePanel = (
    <div className="space-y-4">
      <CollectionImporter
        ref={importerRef}
        label="Decklist"
        textareaClassName="min-h-[180px]"
        hideImportButton
        externalResult
        onImportCards={handleImportCards}
        onCommanderDetected={handleCommanderDetected}
        onLegendariesDetected={handleLegendariesDetected}
        onPendingChange={(p) => { setHasPending(p); if (p) setEmptyParse(false); }}
        onValidateProgress={(fetched, total) => setValidateProgress({ fetched, total })}
      />
      {emptyParse && (
        <p className="text-xs text-amber-400/90">No cards found in input — paste a decklist first.</p>
      )}
      <div className="flex justify-end">
        <Button
          onClick={handleInspectClick}
          disabled={!hasPending || validating}
          className="btn-shimmer"
          title={!hasPending ? 'Paste a decklist first' : undefined}
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );

  const resolvePanel = (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Preparing your deck</p>
        {paused && importedCards.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {importedCards.length} card{importedCards.length === 1 ? '' : 's'} validated
          </p>
        )}
      </div>

      <HydrationSteps steps={steps} currentIdx={currentIdx} idle={idle} />

      {submitted && loading && !showHydration && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {ctaLoadingLabel}
        </p>
      )}

      {validateError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {validateError}
        </div>
      )}

      {paused && importResult && importResult.notFound.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1 text-xs text-amber-500">
            <AlertCircle className="w-3.5 h-3.5" />
            {importResult.notFound.length} card{importResult.notFound.length > 1 ? 's' : ''} not found — fix the spelling, or continue without {importResult.notFound.length > 1 ? 'them' : 'it'}:
          </div>
          <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {importResult.notFound.slice(0, 10).map(name => (
              <li key={name} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                {name}
              </li>
            ))}
            {importResult.notFound.length > 10 && (
              <li className="text-muted-foreground/70">and {importResult.notFound.length - 10} more</li>
            )}
          </ul>
        </div>
      )}

      {showLegendaryPicker && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Multiple legendary creatures detected — pick the commander:
          </p>
          <div className="flex flex-wrap gap-2">
            {legendaries.map(card => renderCommanderChip(card, () => pickCommander(card)))}
          </div>
        </div>
      )}

      {showFallback && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs text-amber-400/90">
            {requireCommander
              ? "We couldn't find a commander in this list — pick one to analyze."
              : "We couldn't find a commander in this list — pick one, or continue without a command zone."}
          </p>
          <input
            type="text"
            value={fallbackQuery}
            onChange={(e) => runFallbackSearch(e.target.value)}
            placeholder="Search for a commander…"
            className="w-full bg-card/50 border border-border/50 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {fallbackSearching && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Searching…
            </p>
          )}
          {fallbackResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fallbackResults.map(c => renderCommanderChip(c, () => pickCommander(c)))}
            </div>
          )}
        </div>
      )}

      {paused && commanderCard && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400/90">
          Commander: <span className="font-semibold text-emerald-300">{commanderCard.name}</span>
        </div>
      )}

      {(paused || validateError) && (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleBackToEdit}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Edit decklist
          </button>
          <div className="flex items-center gap-2">
            {commanderMissing && !requireCommander && importedCards.length > 0 && (
              <button
                onClick={() => submitRun(null, importedRef.current)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/50 hover:bg-accent transition-colors"
              >
                Continue without commander
              </button>
            )}
            {paused && importedCards.length > 0 && (
              <Button
                onClick={() => submitRun(commanderRef.current, importedRef.current)}
                disabled={!canContinue}
                className="btn-shimmer"
                title={!commanderCard ? 'Pick a commander to inspect this list' : undefined}
              >
                {importResult && importResult.notFound.length > 0 ? `${verb} anyway →` : ctaLabel}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Two panels on a 200%-wide track; stepping translates the track by one
          panel width. Both stay mounted — the importer owns the textarea text,
          and unmounting it would lose the paste. */}
      <div className="overflow-hidden">
        <div className={`flex w-[200%] transition-transform duration-300 ease-out ${step === 'resolve' ? '-translate-x-1/2' : ''}`}>
          <div
            className={`w-1/2 shrink-0 ${step === 'paste' ? '' : 'pointer-events-none'}`}
            aria-hidden={step !== 'paste'}
          >
            {pastePanel}
          </div>
          <div
            className={`w-1/2 shrink-0 ${step === 'resolve' ? '' : 'pointer-events-none'}`}
            aria-hidden={step !== 'resolve'}
          >
            {resolvePanel}
          </div>
        </div>
      </div>

      {hoverPreview && createPortal(
        <div
          className="pointer-events-none fixed z-[110] animate-fade-in"
          style={{
            top: hoverPreview.top,
            left: hoverPreview.left,
            transform: hoverPreview.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <img
            src={getCardImageUrl(hoverPreview.card, 'normal')}
            alt={hoverPreview.card.name}
            className="w-48 rounded-lg shadow-2xl border border-white/10"
          />
        </div>,
        document.body
      )}
    </>
  );
}
