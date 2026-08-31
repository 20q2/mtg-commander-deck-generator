import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import {
  ASSUMPTION_FIELDS, DEFAULT_ASSUMPTIONS, type FinisherAssumptions,
} from '@/services/finishers';

interface Props { value: FinisherAssumptions; onChange: (a: FinisherAssumptions) => void }

export function FinisherTuningPanel({ value, onChange }: Props) {
  const dirty = ASSUMPTION_FIELDS.some(f => value[f.key] !== DEFAULT_ASSUMPTIONS[f.key]);
  return (
    <Card className="h-fit">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Assumptions</CardTitle>
        {dirty && (
          <Button variant="ghost" size="sm" className="h-6 text-xs"
            onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>
            <RotateCcw className="w-3 h-3 mr-1" />Reset
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {ASSUMPTION_FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-xs font-medium" title={f.hint}>{f.label}</label>
              <span className="text-xs tabular-nums text-violet-300/90">{value[f.key]}</span>
            </div>
            <input
              type="range"
              min={f.min} max={f.max} step={f.step}
              value={value[f.key]}
              onChange={e => onChange({ ...value, [f.key]: Number(e.target.value) })}
              className="w-full accent-primary h-1"
            />
            <p className="text-[10px] text-muted-foreground leading-tight">{f.hint}</p>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          Live and local to this page. Write winners back into
          <code className="mx-1">src/services/finishers/tuning.ts</code>.
        </p>
      </CardContent>
    </Card>
  );
}
