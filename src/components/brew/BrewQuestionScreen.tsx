import { useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Compass, SkipForward } from 'lucide-react';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { BrewAnswer } from '@/services/brew/engine';

/**
 * A personality round: a generic prompt with playstyle answers drawn from the commander's
 * themes. Picking one gently leans that theme; "Skip" moves on without steering.
 */
export function BrewQuestionScreen() {
  const { brewQuestion, answerBrewQuestion } = useStore();
  const [chosenId, setChosenId] = useState<string | null>(null);
  if (!brewQuestion) return null;

  const exiting = chosenId !== null;
  const isCardQuestion = brewQuestion.answers.some(a => a.card);

  function choose(answer: BrewAnswer | null, id: string) {
    if (exiting) return;
    setChosenId(id);
    window.setTimeout(() => answerBrewQuestion(answer), 320);
  }

  return (
    <div className="text-center">
      {/* Compass sigil — this screen steers the deck rather than filling it. */}
      <span className="mx-auto mb-3 grid place-items-center w-12 h-12 rounded-full border-2 border-violet-300/60 bg-violet-500/12 text-violet-200 backdrop-blur-sm shadow-[0_0_28px_hsl(262_83%_58%/0.35)]">
        <Compass className="w-6 h-6" />
      </span>
      <div className="flex items-center justify-center gap-3 mb-2 text-muted-foreground/70">
        <span className="h-px w-8 sm:w-14 bg-gradient-to-r from-transparent to-border" />
        <span className="text-[10px] uppercase tracking-[0.32em] whitespace-nowrap">Your call</span>
        <span className="h-px w-8 sm:w-14 bg-gradient-to-l from-transparent to-border" />
      </div>
      <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-1 drop-shadow-[0_2px_18px_hsl(var(--primary)/0.35)]">
        {brewQuestion.prompt}
      </h2>
      <p className="text-xs text-muted-foreground mb-7">No wrong answer — it just steers what we suggest.</p>

      {isCardQuestion ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto" style={{ perspective: '1200px' }}>
          {brewQuestion.answers.map((answer, idx) => (
            <button
              key={answer.id}
              onClick={() => choose(answer, answer.id)}
              disabled={exiting}
              style={exiting ? undefined : { animationDelay: `${idx * 60}ms` }}
              className={`group flex flex-col items-center gap-2 rounded-2xl p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                exiting ? (answer.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss') : 'animate-brew-card-in'
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200/90">{answer.label}</span>
              {answer.card && (
                <img
                  src={getCardImageUrl(answer.card, 'small')}
                  alt={answer.card.name}
                  loading="lazy"
                  className="block w-full h-auto rounded-[4.8%] shadow-md ring-1 ring-black/50 transition-transform duration-150 ease-out group-hover:-translate-y-2 group-hover:scale-[1.06] group-hover:shadow-[0_16px_36px_hsl(var(--primary)/0.5)] group-hover:ring-violet-400/70"
                />
              )}
              <span className="font-flavor text-[12px] italic leading-tight text-muted-foreground">{answer.blurb}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {brewQuestion.answers.map((answer, idx) => (
            <button
              key={answer.id}
              onClick={() => choose(answer, answer.id)}
              disabled={exiting}
              style={exiting ? undefined : { animationDelay: `${idx * 70}ms` }}
              className={`group relative flex flex-col items-center rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm px-5 py-6 text-center shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1.5 hover:border-violet-400 hover:bg-card/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                exiting
                  ? (answer.id === chosenId ? 'animate-brew-to-deck' : 'animate-brew-dismiss')
                  : 'animate-brew-card-in'
              }`}
            >
              <span className="font-display text-lg font-semibold text-foreground mb-2">{answer.label}</span>
              <span className="font-flavor text-[15px] italic leading-snug text-muted-foreground">{answer.blurb}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center mt-9 text-muted-foreground">
        <Button variant="ghost" size="sm" disabled={exiting} onClick={() => choose(null, 'skip')}>
          <SkipForward className="w-4 h-4 mr-1.5" /> Skip — no preference
        </Button>
      </div>
    </div>
  );
}
