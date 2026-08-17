import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { useStore } from '@/store';
import { buildBracketViewModel } from './bracket/bracketViewModel';
import { RefinedVerdictView } from './bracket/RefinedVerdictView';

export function BracketTabContent({ onPreview }: { onPreview: (name: string) => void }) {
  const bracketEstimation = useStore(s => s.generatedDeck?.bracketEstimation);
  const detectedCombos = useStore(s => s.generatedDeck?.detectedCombos);

  const vm = useMemo(
    () => (bracketEstimation ? buildBracketViewModel(bracketEstimation, detectedCombos) : null),
    [bracketEstimation, detectedCombos],
  );

  if (!vm) {
    return (
      <div className="bg-card/60 border border-border/30 rounded-lg p-6 text-center">
        <Gauge className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Generate a deck to see bracket analysis</p>
      </div>
    );
  }

  return <RefinedVerdictView vm={vm} onPreview={onPreview} />;
}
