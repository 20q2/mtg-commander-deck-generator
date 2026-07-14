import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Download, FileJson, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  parseAndMigrate,
  computeDiff,
  applyMigration,
  type ImportDiff,
  type ImportPlan,
  type ImportSummary,
  type SectionStrategy,
} from '@/services/migration/import';
import { MigrationError, type MigrationEnvelope } from '@/services/migration/schema';
import { downloadBackup, hasAnythingToExport } from '@/services/migration/export';

type Stage =
  | { kind: 'picking' }
  | { kind: 'error'; message: string }
  | { kind: 'review'; envelope: MigrationEnvelope; diff: ImportDiff; plan: ImportPlan }
  | { kind: 'applying' }
  | { kind: 'done'; summary: ImportSummary };

// We force a full page reload after applying so every in-memory cache
// (useUserLists, Zustand store, Dexie liveQueries) re-initializes from the
// freshly written storage. The summary is stashed in sessionStorage so the
// Done view can survive the reload.
const SUMMARY_STORAGE_KEY = 'manafoundry-migration-summary';

function consumePersistedSummary(): ImportSummary | null {
  try {
    const raw = sessionStorage.getItem(SUMMARY_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SUMMARY_STORAGE_KEY);
    const parsed = JSON.parse(raw) as ImportSummary;
    if (
      typeof parsed.listsImported === 'number' &&
      typeof parsed.collectionCardsImported === 'number' &&
      typeof parsed.preferencesApplied === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function MigratePage() {
  usePageTitle('Migrate');
  const [stage, setStage] = useState<Stage>(() => {
    const persisted = consumePersistedSummary();
    return persisted ? { kind: 'done', summary: persisted } : { kind: 'picking' };
  });

  const handleFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const envelope = parseAndMigrate(text);
      const diff = await computeDiff(envelope);
      setStage({ kind: 'review', envelope, diff, plan: diff.smartDefaults });
    } catch (e) {
      const message = e instanceof MigrationError
        ? e.message
        : `We couldn't process this backup file. ${e instanceof Error ? e.message : String(e)}`;
      setStage({ kind: 'error', message });
    }
  }, []);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = () => setStage({ kind: 'picking' });

  // Review/applying/done occupy the whole page — no parallel actions during the migration flow.
  if (stage.kind === 'review') {
    return (
      <PageShell>
        <ReviewView
          envelope={stage.envelope}
          diff={stage.diff}
          plan={stage.plan}
          onChangePlan={p => setStage({ ...stage, plan: p })}
          onApply={async () => {
            setStage({ kind: 'applying' });
            const summary = await applyMigration(stage.envelope, stage.plan);
            try {
              sessionStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(summary));
            } catch {
              // If sessionStorage is unavailable we still want a fresh page; the
              // Done view summary just won't survive the reload.
            }
            window.location.reload();
          }}
          onCancel={reset}
        />
      </PageShell>
    );
  }
  if (stage.kind === 'applying') {
    return (
      <PageShell>
        <div className="glass rounded-2xl p-10 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Applying migration…</p>
        </div>
      </PageShell>
    );
  }
  if (stage.kind === 'done') {
    return <PageShell><DoneView summary={stage.summary} /></PageShell>;
  }

  // Default landing: both Download and Upload, side by side.
  return (
    <PageShell>
      <div className="space-y-6">
        <ExportSection />
        <UploadSection
          onPick={onPick}
          onDrop={onDrop}
          error={stage.kind === 'error' ? stage.message : null}
          onClearError={reset}
        />
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 container mx-auto px-4 py-6 max-w-3xl animate-fade-in">
      <div className="text-center py-6 mb-4">
        <h1 className="text-4xl font-bold mb-3">
          Migrate your <span className="gradient-text">ManaFoundry</span> data
        </h1>
        <p className="text-base text-muted-foreground max-w-xl mx-auto">
          Back up everything on this site as a portable file, or restore from a backup made on another browser or host.
        </p>
      </div>
      {children}
    </main>
  );
}

function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
        {step}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function ExportSection() {
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasAnythingToExport().then(v => { if (!cancelled) setHasData(v); });
    return () => { cancelled = true; };
  }, []);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadBackup();
      setDownloaded(true);
    } finally {
      setBusy(false);
    }
  };

  const isLegacyHost = typeof window !== 'undefined' && (
    window.location.hostname === '20q2.github.io' ||
    window.location.hostname === 'localhost'
  );

  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <StepHeader step={1} title="Back up this browser" />
      <p className="text-sm text-muted-foreground mb-5">
        Saves your lists, decks, collection, and preferences as a single JSON file you can restore anywhere.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={onClick}
          disabled={busy || hasData === false}
          className="btn-shimmer h-11 px-6 text-sm"
        >
          <Download className="w-4 h-4" />
          {busy ? 'Preparing…' : 'Download backup'}
        </Button>
        {hasData === false && (
          <span className="text-xs text-muted-foreground">Nothing to back up yet.</span>
        )}
      </div>

      {downloaded && (
        <div className="mt-6 border border-emerald-500/40 bg-emerald-500/10 rounded-xl p-5 animate-fade-in">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="font-semibold text-sm">Backup file saved</div>
          </div>
          {isLegacyHost ? (
            <div className="text-sm text-foreground/90">
              <p>
                Now open{' '}
                <a
                  href="https://manafoundry.gg/migrate"
                  className="font-semibold underline underline-offset-2 text-emerald-200 hover:text-white transition-colors"
                >
                  manafoundry.gg/migrate
                </a>{' '}
                and upload that file there to restore your data on the new site.
              </p>
              <a
                href="https://manafoundry.gg/migrate"
                className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-sm font-medium transition-colors"
              >
                Go to manafoundry.gg/migrate <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="text-sm text-foreground/90">
              You can use the restore section below to load this file later, or take it to another browser.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function UploadSection({
  onPick, onDrop, error, onClearError,
}: {
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  error: string | null;
  onClearError: () => void;
}) {
  return (
    <section className="glass rounded-2xl p-6 sm:p-8">
      <StepHeader step={2} title="Restore from a backup file" />
      <p className="text-sm text-muted-foreground mb-5">
        Upload a <code className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80">manafoundry-backup-*.json</code> file
        to bring your data into this browser.
      </p>

      {error ? (
        <ErrorView message={error} onRetry={onClearError} />
      ) : (
        <PickerView onPick={onPick} onDrop={onDrop} />
      )}
    </section>
  );
}

function PickerView({
  onPick, onDrop,
}: { onPick: (e: React.ChangeEvent<HTMLInputElement>) => void; onDrop: (e: React.DragEvent<HTMLElement>) => void; }) {
  return (
    <label
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
      className="block border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:bg-accent/30 hover:border-primary/50 transition-colors group"
    >
      <Upload className="w-9 h-9 mx-auto mb-3 text-muted-foreground group-hover:text-primary transition-colors" />
      <div className="text-sm font-medium mb-1">Drop your backup file here, or click to browse</div>
      <div className="text-xs text-muted-foreground">JSON files only</div>
      <input type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
    </label>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border border-destructive/40 bg-destructive/10 rounded-xl p-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-destructive mb-1">Couldn't read this file</div>
          <div className="text-sm text-foreground/80">{message}</div>
        </div>
      </div>
      <div className="mt-4">
        <Button variant="outline" size="sm" onClick={onRetry}>Choose a different file</Button>
      </div>
    </div>
  );
}

function ReviewView({
  envelope, diff, plan, onChangePlan, onApply, onCancel,
}: {
  envelope: MigrationEnvelope;
  diff: ImportDiff;
  plan: ImportPlan;
  onChangePlan: (p: ImportPlan) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const setStrategy = (section: keyof ImportPlan, value: SectionStrategy) =>
    onChangePlan({ ...plan, [section]: value });

  const fileInfo = `Exported ${envelope.exportedAt ? new Date(envelope.exportedAt).toLocaleString() : '(unknown date)'} from ${envelope.sourceHost || '(unknown host)'} (v${envelope.appVersion || '?'})`;

  return (
    <div className="space-y-5">
      <div className="glass rounded-xl px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
        <FileJson className="w-4 h-4 text-primary/80 shrink-0" /> {fileInfo}
      </div>

      <Section
        title="Lists & decks"
        fileCount={diff.fileCounts.lists}
        fileNoun="list/deck"
        localCount={diff.localCounts.lists}
        strategy={plan.lists}
        onChange={v => setStrategy('lists', v)}
        mergeHelp="Add file's lists alongside yours. Imported list IDs are renamed to avoid collisions."
        replaceHelp="Wipe your existing lists and load only the file's lists."
      />

      <Section
        title="Collection"
        fileCount={diff.fileCounts.collection}
        fileNoun="card"
        localCount={diff.localCounts.collection}
        strategy={plan.collection}
        onChange={v => setStrategy('collection', v)}
        mergeHelp="For overlapping cards, keep the higher quantity. Won't double your collection if re-imported."
        replaceHelp="Clear your current collection and load only the file's cards."
      />

      <Section
        title="Preferences"
        fileCount={diff.fileCounts.preferences}
        fileNoun="setting"
        localCount={diff.localCounts.preferences}
        strategy={plan.preferences}
        onChange={v => setStrategy('preferences', v)}
        mergeHelp="Combine list-type prefs (banned cards, ban lists, etc.). Scalar prefs keep your existing value."
        replaceHelp="Clear your current preferences and load only the file's values."
      />

      <div className="flex gap-3 pt-4">
        <Button onClick={onApply} className="btn-shimmer h-11 px-6">Apply migration</Button>
        <Button variant="outline" onClick={onCancel} className="h-11 px-6">Cancel</Button>
      </div>
    </div>
  );
}

function Section({
  title, fileCount, fileNoun, localCount, strategy, onChange, mergeHelp, replaceHelp,
}: {
  title: string;
  fileCount: number;
  fileNoun: string;
  localCount: number;
  strategy: SectionStrategy;
  onChange: (v: SectionStrategy) => void;
  mergeHelp: string;
  replaceHelp: string;
}) {
  const fileNounPlural = fileCount === 1 ? fileNoun : `${fileNoun}s`;
  const localNounPlural = localCount === 1 ? fileNoun : `${fileNoun}s`;
  return (
    <div className="glass rounded-xl p-5">
      <div className="font-semibold text-base mb-1">{title}</div>
      <div className="text-xs text-muted-foreground mb-4">
        File: <span className="text-foreground/80 font-medium">{fileCount}</span> {fileNounPlural}
        {' · '}
        You: <span className="text-foreground/80 font-medium">{localCount}</span> {localNounPlural}
      </div>
      {fileCount === 0 ? (
        <div className="text-xs text-muted-foreground italic">Nothing in the file for this section.</div>
      ) : (
        <div className="space-y-2.5">
          <Radio name={title} value="merge" current={strategy} onChange={onChange} label="Merge" help={mergeHelp} />
          <Radio name={title} value="replace" current={strategy} onChange={onChange} label="Replace" help={replaceHelp} />
          <Radio name={title} value="skip" current={strategy} onChange={onChange} label="Skip" help="Leave this section unchanged." />
        </div>
      )}
    </div>
  );
}

function Radio({
  name, value, current, onChange, label, help,
}: {
  name: string;
  value: SectionStrategy;
  current: SectionStrategy;
  onChange: (v: SectionStrategy) => void;
  label: string;
  help: string;
}) {
  const selected = current === value;
  return (
    <label
      className={`flex items-start gap-3 cursor-pointer text-sm w-full px-4 py-2.5 rounded-lg border transition-colors ${
        selected
          ? 'border-primary/60 bg-primary/10'
          : 'border-border/60 hover:border-border hover:bg-accent/30'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={() => onChange(value)}
        className="mt-0.5 accent-primary"
      />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{help}</div>
      </div>
    </label>
  );
}

function DoneView({ summary }: { summary: ImportSummary }) {
  return (
    <div className="glass rounded-2xl p-6 sm:p-8 border border-emerald-500/40 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <div className="text-xl font-bold leading-tight">Migration complete</div>
          <p className="text-sm text-muted-foreground">Your data is now restored on this browser.</p>
        </div>
      </div>
      <ul className="text-sm text-foreground/90 space-y-1.5 mb-6">
        <li><span className="font-semibold text-foreground">{summary.listsImported}</span> list{summary.listsImported === 1 ? '' : 's'}/decks imported</li>
        <li><span className="font-semibold text-foreground">{summary.collectionCardsImported}</span> collection card{summary.collectionCardsImported === 1 ? '' : 's'} imported</li>
        <li><span className="font-semibold text-foreground">{summary.preferencesApplied}</span> preference{summary.preferencesApplied === 1 ? '' : 's'} applied</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link to="/decks" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium h-10 px-4 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
          Go to your decks
        </Link>
        <Link to="/collection" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium h-10 px-4 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
          Go to your collection
        </Link>
      </div>
    </div>
  );
}
