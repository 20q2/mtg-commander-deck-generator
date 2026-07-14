import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * "Finish for me" — the bail-out escape hatch. Rendered once at the page level and pushed to the
 * bottom of the brew content region (mt-auto), so it docks right above the site footer instead of
 * riding the in-flow wayfinding row up and down as each screen's content changes height.
 */
export function BrewFinishButton({ onFinish, className }: { onFinish: () => void; className?: string }) {
  return (
    <div className={`flex justify-center pt-8 text-muted-foreground ${className ?? ''}`}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFinish}
        className="text-violet-300 hover:text-violet-200"
      >
        <Play className="w-4 h-4 mr-1.5" /> Finish for me
      </Button>
    </div>
  );
}
