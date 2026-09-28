import { useMemo, useState } from 'react';
import { Ban } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import {
  EDITABLE_CARD_TYPES,
  animatedTypeLine,
  composeTypeLine,
  liveTypeLine,
  parseTypeLine,
} from '@/services/playtest/powerToughness';
import { typeLineOf } from '@/services/playtest/opponents/stats';
import type { CardEdit, EditTarget } from '@/components/playtest/types';
import type { ScryfallCard } from '@/types';

/**
 * The "becomes a" auras, as one click each. Not a taxonomy to maintain — just the
 * handful that come up often enough that typing the numbers gets old.
 */
const PRESETS: { label: string; edit: CardEdit }[] = [
  { label: '0/4 Treefolk',  edit: { power: 0, toughness: 4, typeLine: 'Creature — Treefolk',  loseAbilities: true } },
  { label: '1/1 Frog',      edit: { power: 1, toughness: 1, typeLine: 'Creature — Frog',      loseAbilities: true } },
  { label: '1/1 Snake',     edit: { power: 1, toughness: 1, typeLine: 'Creature — Snake',     loseAbilities: true } },
  { label: '0/1 Wall',      edit: { power: 0, toughness: 1, typeLine: 'Creature — Wall',      loseAbilities: true } },
  { label: '3/3 Elephant',  edit: { power: 3, toughness: 3, typeLine: 'Creature — Elephant',  loseAbilities: true } },
];

/**
 * Sizes for animating something that isn't a creature yet — a manland, a
 * Karn'd artifact. Only numbers, because the type line is derived from the
 * permanent's own rather than replaced by a preset's, and the abilities stay:
 * a Mutavault that lost its own activated ability would be pointless.
 */
const ANIMATE_SIZES: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]];

/** Printed P/T as numbers, for seeding the form. `*` and blanks read as 0. */
function printedPT(card: ScryfallCard): { power: number; toughness: number } {
  const read = (key: 'power' | 'toughness') => {
    const n = parseInt(card[key] ?? card.card_faces?.[0]?.[key] ?? '', 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return { power: read('power'), toughness: read('toughness') };
}

/**
 * Rewrite a permanent's characteristics — Lignify, Frogify, Kenrith's
 * Transformation one way, Mutavault and Karn, Liberated the other. Works on
 * either side of the table: `target` says whose permanent it is, and the
 * matching store action does the write.
 *
 * The two directions want different defaults, so the dialog reads which one it
 * is off the permanent's live type line rather than offering both at once.
 */
export function EditCreatureModal() {
  const modal = usePlaytestStore(s => s.modal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const setCardEdit = usePlaytestStore(s => s.setCardEdit);
  const opponents = useOpponentStore(s => s.opponents);
  const setPermanentEdit = useOpponentStore(s => s.setPermanentEdit);

  const target: EditTarget | null = modal?.kind === 'editCreature' ? modal.target : null;

  // The permanent behind the target, whichever side it's on.
  const subject = useMemo(() => {
    if (!target) return null;
    if (target.side === 'player') {
      const hit = battlefield.find(b => b.instanceId === target.instanceId);
      return hit ? { card: hit.card, edit: hit.edit, typeLine: liveTypeLine(hit) } : null;
    }
    const opp = opponents.find(o => o.id === target.opponentId);
    const hit = opp?.battlefield.find(p => p.instanceId === target.instanceId);
    return hit ? { card: hit.card, edit: hit.edit, typeLine: typeLineOf(hit) } : null;
  }, [target, battlefield, opponents]);

  // Seeded once per open from whatever the creature is now — an existing edit if
  // it has one, otherwise its printed self, so the fields start somewhere sane.
  const [form, setForm] = useState(() => {
    const printed = subject ? printedPT(subject.card) : { power: 0, toughness: 0 };
    const existing = subject?.edit;
    // Pre-animated: opening this on a land seeds "Land Creature — Mutavault", so
    // becoming a creature is two numbers rather than retyping the line. Held in
    // pieces because the types are buttons and the subtypes are a field, and a
    // single string would fight the keystrokes in the latter.
    const parsed = parseTypeLine(subject ? animatedTypeLine(subject.typeLine) : '');
    return {
      power: String(existing?.power ?? printed.power),
      toughness: String(existing?.toughness ?? printed.toughness),
      others: parsed.others,
      types: parsed.types,
      subtypes: parsed.subtypes,
      loseAbilities: existing?.loseAbilities ?? false,
    };
  });

  if (!target || !subject) return null;

  /** Nothing here is a creature yet — this is an animation, not a rewrite. */
  const animating = !subject.typeLine.toLowerCase().includes('creature');

  const apply = (edit: CardEdit | null) => {
    if (target.side === 'player') setCardEdit(target.instanceId, edit);
    else setPermanentEdit(target.opponentId, target.instanceId, edit);
    closeModal();
  };

  const numberOr0 = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };

  return (
    <FloatingDialog
      title={<>{animating ? 'Make it a creature' : 'Edit creature'} <span className="text-muted-foreground font-normal ml-1">{subject.card.name}</span></>}
      onClose={closeModal}
      width={380}
      storageKey="playtest:dialog-pos:edit-creature"
    >
      <div className="px-4 py-3 space-y-3">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {animating ? 'Animate as' : 'Presets'}
          </div>
          <div className="flex flex-wrap gap-1">
            {/* The "becomes a" auras rewrite what a creature is, so they carry a
                type line and strip the abilities. Animating does neither: the
                land keeps its name, its subtypes and its ability, and only
                gains a size. */}
            {animating
              ? ANIMATE_SIZES.map(([power, toughness]) => (
                  <Button
                    key={`${power}/${toughness}`}
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px] tabular-nums"
                    onClick={() => apply({
                      power,
                      toughness,
                      typeLine: animatedTypeLine(subject.typeLine),
                      loseAbilities: false,
                    })}
                  >
                    {power}/{toughness}
                  </Button>
                ))
              : PRESETS.map(p => (
                  <Button
                    key={p.label}
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    // A preset applies straight away — it's the whole point of the row.
                    onClick={() => apply(p.edit)}
                  >
                    {p.label}
                  </Button>
                ))}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Power</span>
            <Input
              type="number"
              value={form.power}
              onChange={e => setForm(f => ({ ...f, power: e.target.value }))}
              className="h-8 tabular-nums"
            />
          </label>
          <span className="text-muted-foreground pb-2">/</span>
          <label className="flex-1 space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Toughness</span>
            <Input
              type="number"
              value={form.toughness}
              onChange={e => setForm(f => ({ ...f, toughness: e.target.value }))}
              className="h-8 tabular-nums"
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Card types</div>
          {/* Toggles rather than a text field because these five words are the
              only part of the line anything reads: they are what the bots' view
              of your board is built from, so a typo here is a land they never
              blow up or a creature they refuse to block. Supertypes and Token
              ride along untouched in `others`. */}
          <div className="flex flex-wrap gap-1">
            {EDITABLE_CARD_TYPES.map(type => {
              const on = form.types.includes(type);
              return (
                <Button
                  key={type}
                  variant={on ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={on}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setForm(f => ({
                    ...f,
                    types: on ? f.types.filter(t => t !== type) : [...f.types, type],
                  }))}
                >
                  {type}
                </Button>
              );
            })}
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Subtypes</span>
          <Input
            value={form.subtypes}
            onChange={e => setForm(f => ({ ...f, subtypes: e.target.value }))}
            placeholder="Treefolk"
            className="h-8"
          />
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.loseAbilities}
            onCheckedChange={v => setForm(f => ({ ...f, loseAbilities: v === true }))}
          />
          <span className="text-xs">Loses all abilities</span>
          <Ban className="w-3 h-3 text-muted-foreground" />
        </label>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            disabled={!subject.edit}
            onClick={() => apply(null)}
          >
            Clear edit
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => apply({
              power: numberOr0(form.power),
              toughness: numberOr0(form.toughness),
              typeLine: composeTypeLine(form) || undefined,
              loseAbilities: form.loseAbilities,
            })}
          >
            Apply
          </Button>
        </div>
      </div>
    </FloatingDialog>
  );
}
