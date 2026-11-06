// src/components/deck/optimizer/dashboard/launchpad/doors.tsx
//
// Claims that open what they claim. A count shows its list, so "Completes 3 combos" shows the three
// and "6 of 9" shows the six. Each one is a Peek over data the panel already holds.
import type { ReactNode } from 'react';
import type { DetectedCombo } from '@/types';
import type { AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { ArtChip, Peek } from './parts';

const MAX_COMBOS = 4;

/**
 * The combos one card would finish: the only piece each is missing. Same rule the analyzer uses to
 * label a "Completes N combos" add, so the count on the row and the list behind it agree.
 */
export function combosCompletedBy(name: string, combos: DetectedCombo[] | undefined): DetectedCombo[] {
  return (combos ?? []).filter(c => !c.isComplete && c.missingCards.length === 1 && c.missingCards[0] === name);
}

/** Each combo as what it does over its pieces. `adding` marks the piece a suggestion brings in. */
function ComboList({ combos, adding, onPreview }: {
  combos: DetectedCombo[];
  adding?: string;
  onPreview: (name: string) => void;
}) {
  const shown = combos.slice(0, MAX_COMBOS);
  return (
    <>
      <ul className="flex flex-col divide-y divide-border/50">
        {shown.map(c => (
          <li key={c.comboId} className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
            <span className="font-semibold text-foreground">{c.results.slice(0, 2).join(' · ') || 'Combo'}</span>
            <span className="flex flex-wrap gap-1">
              {c.cards.map(piece => (
                <ArtChip key={piece} name={piece} onPreview={onPreview} tone={piece === adding ? 'add' : undefined} />
              ))}
              {(c.templates ?? []).map(t => (
                <span key={t.name} className="inline-flex items-center rounded-md border border-dashed border-border/70 px-2 py-0.5 text-muted-foreground">
                  {t.quantity && t.quantity > 1 ? `${t.quantity}× ` : ''}{t.name}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {combos.length > shown.length && (
        <p className="mt-2 text-[12px] text-muted-foreground">And {combos.length - shown.length} more.</p>
      )}
    </>
  );
}

/** "Completes 3 combos", opening each combo: what it does, the pieces you hold, and the one coming in. */
export function CombosDoor({ name, combos, onPreview }: {
  name: string;
  combos: DetectedCombo[];
  onPreview: (name: string) => void;
}) {
  return (
    <Peek label={`Completes ${combos.length} combo${combos.length === 1 ? '' : 's'}`} contentClassName="w-[22rem]">
      <p className="mb-2 text-[12px] text-muted-foreground">
        You hold every other piece. {name.split(',')[0]} finishes:
      </p>
      <ComboList combos={combos} adding={name} onPreview={onPreview} />
    </Peek>
  );
}

/** "1 complete combo" in the unrated-combo warning, opening the combos it means. */
export function UnratedCombosDoor({ combos, onPreview, className }: {
  combos: DetectedCombo[];
  onPreview: (name: string) => void;
  className?: string;
}) {
  return (
    <Peek label={`${combos.length} complete combo${combos.length === 1 ? '' : 's'}`} className={className} contentClassName="w-[22rem]">
      <p className="mb-2 text-[12px] text-muted-foreground">
        In the deck, with no community bracket rating yet:
      </p>
      <ComboList combos={combos} onPreview={onPreview} />
    </Peek>
  );
}

/** A role count ("6 of 9") opening the cards counted toward it, so the number can be checked. */
export function RoleCardsDoor({ label, role, cards, onPreview }: {
  label: ReactNode;
  role: string;
  cards: AnalyzedCard[];
  onPreview: (name: string) => void;
}) {
  const byName = new Map(cards.map(c => [c.card.name, c.card]));
  const names = [...byName.keys()];
  return (
    <Peek label={label} className="tabular-nums" contentClassName="w-[22rem]">
      <p className="mb-2 text-[12px] text-muted-foreground">
        {names.length === 0 ? `Nothing in the deck counts as ${role.toLowerCase()} yet.` : `Counted as ${role.toLowerCase()}:`}
      </p>
      {names.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {names.map(n => <ArtChip key={n} name={n} card={byName.get(n)} onPreview={onPreview} />)}
        </span>
      )}
    </Peek>
  );
}
