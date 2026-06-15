import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { DeckCustomizer } from '@/components/customization/DeckCustomizer';
import { Wand2 } from 'lucide-react';

interface BrewSetupProps {
  loadingCommander: boolean;
  progress: { msg: string; pct: number } | null;
  onStart: () => void;
}

export function BrewSetup({ loadingCommander, progress, onStart }: BrewSetupProps) {
  const { commander, themesLoading } = useStore();

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Brew {commander?.name ?? '…'}</h1>
        <p className="text-sm text-muted-foreground">Set your budget and power level — you'll shape the theme and mana base as you build, one choice at a time.</p>
      </div>

      {/* Lean brew setup: only the up-front constraints (deck size, budget, power level, collection).
          No theme picker — the theme emerges from your picks — and no land sliders (the mana base is
          resolved at the finish). DeckCustomizer's brewMode hides those sections.
          Mount only once the commander is loaded: DeckCustomizer early-returns on a null commander
          BETWEEN hook groups, so mounting it mid-load and transitioning null->set crashes (Rules of Hooks). */}
      {commander ? (
        <DeckCustomizer brewMode />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-10">Loading commander…</div>
      )}

      <div className="text-center pt-2">
        <Button
          size="lg"
          onClick={onStart}
          disabled={loadingCommander || themesLoading || !commander || !!progress}
          className="min-w-56 h-14 text-lg btn-shimmer hover-lift"
        >
          <Wand2 className="w-5 h-5 mr-2" /> {progress ? progress.msg : 'Start Brewing'}
        </Button>
        {progress && progress.pct > 0 && (
          <div className="mt-3 w-64 mx-auto h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
