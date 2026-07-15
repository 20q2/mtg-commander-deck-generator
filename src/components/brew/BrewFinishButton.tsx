import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * "Finish for me" — the bail-out escape hatch. A deliberately quiet link tucked into the top-right,
 * just under the edge of the fate-map track, so it's always reachable without competing with the
 * pack/fork choices for attention.
 */
export function BrewFinishButton({ onFinish, className }: { onFinish: () => void; className?: string }) {
  return (
    <div className={`flex justify-end ${className ?? ''}`}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFinish}
        className="h-auto px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground"
      >
        <Play className="w-3 h-3 mr-1" /> Finish for me
      </Button>
    </div>
  );
}
