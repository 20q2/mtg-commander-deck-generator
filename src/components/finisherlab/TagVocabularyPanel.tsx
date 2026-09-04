import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

interface Props {
  text: string;
  onChange: (t: string) => void;
  onReload: () => void;
  onReset: () => void;
  loading: boolean;
  sizes: Record<string, number>;
}

/**
 * The tag vocabulary as an editable box rather than a baked constant. Add `otag:group-slug`,
 * hit reload, and see what changes — no tagger redeploy.
 */
export function TagVocabularyPanel({ text, onChange, onReload, onReset, loading, sizes }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Tag vocabulary</CardTitle>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onReset}>
          <RotateCcw className="w-3 h-3 mr-1" />Reset
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <textarea
          value={text}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full text-xs font-mono bg-background/50 border border-border/50 rounded-md p-2 resize-y"
        />
        <div className="flex items-center gap-2">
          {/* Deliberately NOT disabled while loading. A tag that stalls is exactly when you need
              to edit the vocabulary, and disabling this made the stalled sweep unrecoverable. */}
          <Button size="sm" className="h-7 text-xs" onClick={onReload}>
            {loading ? 'Restart sweep' : 'Reload tags'}
          </Button>
          {loading && <span className="text-[10px] text-muted-foreground">sweeping…</span>}
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight">
          <code>key: otag:query</code> per line; <code>#</code> comments a line out. Fetched from
          Scryfall and cached to IndexedDB, so the vocabulary is a knob rather than a redeploy.
          The commented tags are display-only and cost most of a cold sweep.
        </p>
        {Object.keys(sizes).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            {Object.entries(sizes).map(([k, n]) => (
              <span key={k} className={n === 0 ? 'text-amber-400' : ''}>{k}:{n}</span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
