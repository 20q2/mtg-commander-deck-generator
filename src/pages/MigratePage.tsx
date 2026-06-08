import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileJson, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

type Stage =
  | { kind: 'picking' }
  | { kind: 'error'; message: string }
  | { kind: 'review'; envelope: MigrationEnvelope; diff: ImportDiff; plan: ImportPlan }
  | { kind: 'applying' }
  | { kind: 'done'; summary: ImportSummary };

export function MigratePage() {
  const [stage, setStage] = useState<Stage>({ kind: 'picking' });

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

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Migrate from another ManaFoundry site</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Upload a <code className="text-xs px-1 py-0.5 rounded bg-muted">manafoundry-backup-*.json</code> file
        exported from another browser or host to restore your lists, decks, collection, and preferences.
      </p>

      {stage.kind === 'picking' && <PickerView onPick={onPick} onDrop={onDrop} />}
      {stage.kind === 'error' && <ErrorView message={stage.message} onRetry={reset} />}
      {stage.kind === 'review' && (
        <ReviewView
          envelope={stage.envelope}
          diff={stage.diff}
          plan={stage.plan}
          onChangePlan={p => setStage({ ...stage, plan: p })}
          onApply={async () => {
            setStage({ kind: 'applying' });
            const summary = await applyMigration(stage.envelope, stage.plan);
            setStage({ kind: 'done', summary });
          }}
          onCancel={reset}
        />
      )}
      {stage.kind === 'applying' && (
        <p className="text-sm text-muted-foreground">Applying migration…</p>
      )}
      {stage.kind === 'done' && <DoneView summary={stage.summary} />}
    </div>
  );
}

function PickerView({
  onPick, onDrop,
}: { onPick: (e: React.ChangeEvent<HTMLInputElement>) => void; onDrop: (e: React.DragEvent<HTMLElement>) => void; }) {
  return (
    <label
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
      className="block border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:bg-accent/30 transition-colors"
    >
      <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
      <div className="text-sm font-medium mb-1">Drop your backup file here, or click to browse</div>
      <div className="text-xs text-muted-foreground">JSON files only</div>
      <input type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
    </label>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border border-destructive/40 bg-destructive/10 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-medium text-destructive mb-1">Couldn't read this file</div>
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
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <FileJson className="w-4 h-4" /> {fileInfo}
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

      <div className="flex gap-3 pt-2">
        <Button onClick={onApply}>Apply migration</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
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
    <div className="border border-border rounded-lg p-4">
      <div className="font-medium text-sm mb-1">{title}</div>
      <div className="text-xs text-muted-foreground mb-3">
        File: {fileCount} {fileNounPlural} · You: {localCount} {localNounPlural}
      </div>
      {fileCount === 0 ? (
        <div className="text-xs text-muted-foreground">Nothing in the file for this section.</div>
      ) : (
        <div className="space-y-2">
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
  return (
    <label className="flex items-start gap-2 cursor-pointer text-sm">
      <input
        type="radio"
        name={name}
        checked={current === value}
        onChange={() => onChange(value)}
        className="mt-0.5 accent-primary"
      />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{help}</div>
      </div>
    </label>
  );
}

function DoneView({ summary }: { summary: ImportSummary }) {
  return (
    <div className="border border-emerald-500/40 bg-emerald-500/10 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        <div className="font-medium">Migration complete</div>
      </div>
      <ul className="text-sm text-foreground/90 space-y-1 mb-4">
        <li>Imported {summary.listsImported} list{summary.listsImported === 1 ? '' : 's'}/decks</li>
        <li>Imported {summary.collectionCardsImported} collection card{summary.collectionCardsImported === 1 ? '' : 's'}</li>
        <li>Applied {summary.preferencesApplied} preference{summary.preferencesApplied === 1 ? '' : 's'}</li>
      </ul>
      <div className="flex gap-3">
        <Link to="/decks" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium h-8 px-3 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
          Go to your decks
        </Link>
        <Link to="/collection" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium h-8 px-3 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors">
          Go to your collection
        </Link>
      </div>
    </div>
  );
}
