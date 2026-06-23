import { useMemo } from 'react';
import { Shield } from 'lucide-react';
import type { ScryfallCard } from '@/types';
import type { RoleBreakdown, AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { getRoleVerdict } from '@/services/deckBuilder/deckAnalyzer';
import { roleBarColor, ROLE_META, VERDICT_STYLES, ROLE_KNOWN_SUBTYPES, type CollapsibleGroup } from './constants';
import { AnalyzedCardRow, CollapsibleCardGroups, type CardAction, type CardRowMenuProps } from './shared';
import { SuggestionCardGrid } from './OverviewTab';

// ─── Roles Tab: Summary Strip ────────────────────────────────────────

export function RoleSummaryStrip({
  roleBreakdowns, activeRole, onRoleClick,
}: {
  roleBreakdowns: RoleBreakdown[];
  activeRole: string | null;
  onRoleClick: (role: string) => void;
}) {
  return (
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4">
    <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-border/30 bg-background/80 backdrop-blur-sm">
      {roleBreakdowns.map((rb, i) => {
        const meta = ROLE_META[rb.role];
        const Icon = meta?.icon || Shield;
        const pct = rb.target > 0 ? Math.min(100, (rb.current / rb.target) * 100) : 100;
        const met = rb.current >= rb.target;
        const isActive = activeRole === rb.role;
        return (
          <div
            key={rb.role}
            role="button"
            tabIndex={0}
            onClick={() => onRoleClick(rb.role)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRoleClick(rb.role); } }}
            className={`p-2.5 text-left cursor-pointer transition-all hover:bg-card/80 ${
              i % 2 !== 0 ? 'border-l border-l-border/30' : ''
            } ${i < 2 ? 'border-b border-b-border/30 sm:border-b-0' : ''} ${
              i > 0 ? 'sm:border-l sm:border-l-border/30' : ''
            } ${
              isActive ? met ? 'bg-emerald-500/5' : 'bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 transition-colors duration-200 ${isActive ? (meta?.color || 'text-muted-foreground') : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate transition-colors duration-200 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {rb.label}
              </span>
              {rb.deficit > 0 && (
                <span className="text-[10px] font-bold px-1 py-px rounded-full bg-red-500/15 text-red-400 ml-auto shrink-0">
                  -{rb.deficit}
                </span>
              )}
            </div>
            <div className="flex items-baseline justify-between gap-1.5 mb-1.5">
              <span className="text-xl font-bold tabular-nums leading-none" style={{ color: roleBarColor(rb.current, rb.target) }}>
                {rb.current}
              </span>
              <span className="text-[11px] text-muted-foreground text-right">at least {rb.target}</span>
            </div>
            <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
              <div className="h-full rounded-full animate-bar-grow" style={{ width: `${pct}%`, backgroundColor: roleBarColor(rb.current, rb.target) }} />
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

// ─── Roles Tab: Grouped Card List ────────────────────────────────────
export function RoleCardGroups({ cards, role, onPreview, onCardAction, menuProps, addedCards }: {
  cards: AnalyzedCard[];
  role: string;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  addedCards?: Set<string>;
}) {
  const knownSubtypes = ROLE_KNOWN_SUBTYPES[role];
  const groupEntries = useMemo(() => {
    const map = new Map<string, AnalyzedCard[]>();
    const sorted = [...cards].sort((a, b) => a.card.name.localeCompare(b.card.name));
    for (const ac of sorted) {
      const label = ac.subtypeLabel || 'Other';
      const key = knownSubtypes?.has(label) ? label : 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ac);
    }
    const other = map.get('Other');
    if (other) { map.delete('Other'); map.set('Other', other); }
    return [...map.entries()];
  }, [cards, knownSubtypes]);

  const groups: CollapsibleGroup[] = groupEntries.map(([label, groupCards]) => ({
    key: label,
    label,
    count: groupCards.length,
    content: (
      <div className="space-y-0.5">
        {groupCards.map(ac => (
          <AnalyzedCardRow
            key={ac.card.name}
            ac={ac}
            onPreview={onPreview}
            showDetails
            hideChips
            hidePrice
            justAdded={addedCards?.has(ac.card.name)}
            onCardAction={onCardAction}
            menuProps={menuProps}
          />
        ))}
      </div>
    ),
  }));

  return <CollapsibleCardGroups groups={groups} totalCount={cards.length} />;
}

// ─── Roles Tab: Summary Verdict ──────────────────────────────────────
// Bolds numbers and key result words to give the verdict message tactical
// emphasis. Pure formatting — no semantic changes.
function emphasizeMessage(message: string): React.ReactNode[] {
  // \d+ catches "10 ramp", "6 above", "4 target", etc.
  // Verdict words like "short", "above", "below", "solid", "close" get the
  // same treatment so the eye lands on the takeaway.
  const splitPattern = /(\b\d+\b|\bshort\b|\babove\b|\bbelow\b|\bsolid\b|\bClose\b)/g;
  const testPattern = /^(\d+|short|above|below|solid|Close)$/;
  const parts = message.split(splitPattern);
  return parts.map((part, i) =>
    testPattern.test(part)
      ? <strong key={i} className="font-semibold text-foreground">{part}</strong>
      : <span key={i}>{part}</span>
  );
}

function RoleSummary({ rb }: { rb: RoleBreakdown }) {
  const { verdict, message } = getRoleVerdict(rb);
  const vs = VERDICT_STYLES[verdict] || VERDICT_STYLES['ok'];
  const meta = ROLE_META[rb.role];
  const Icon = meta?.icon || Shield;

  return (
    <div className="mb-3 -mx-3 sm:-mx-4 -mt-3 px-3 sm:px-4 pt-3 pb-3 border-b border-border/30">
      <div className={`relative overflow-hidden border rounded-lg p-2.5 ${vs.border} ${vs.bg}`}>
        <Icon
          aria-hidden
          className={`pointer-events-none absolute -right-3 -bottom-3 w-20 h-20 opacity-10 ${meta?.color || 'text-muted-foreground'}`}
        />
        <p className="relative text-sm text-foreground/85 leading-snug">{emphasizeMessage(message)}</p>
      </div>
    </div>
  );
}

// ─── Roles Tab: Detail Panel ─────────────────────────────────────────
export function RoleDetailPanel({
  rb, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  rb: RoleBreakdown;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const hasSuggestions = rb.suggestedReplacements.length > 0;

  // Soft aurora tint by role — green/red/orange/blue
  const auroraByRole: Record<string, string> = {
    ramp:      'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(16,185,129,0.05), transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(16,185,129,0.035), transparent 60%)',
    removal:   'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(244,63,94,0.05),  transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(244,63,94,0.035),  transparent 60%)',
    boardwipe: 'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(249,115,22,0.05), transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(249,115,22,0.035), transparent 60%)',
    cardDraw:  'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(14,165,233,0.05), transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(14,165,233,0.035), transparent 60%)',
    protection:'radial-gradient(ellipse 80% 60% at 15% 0%, rgba(234,179,8,0.05),  transparent 60%), radial-gradient(ellipse 70% 55% at 90% 100%, rgba(234,179,8,0.035),  transparent 60%)',
  };
  const aurora = auroraByRole[rb.role];

  return (
    <div
      className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3 flex-1 min-h-0 overflow-y-auto transition-[background-image] duration-500"
      style={aurora ? { backgroundImage: aurora } : undefined}
    >
      <div className={`h-full ${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left column: summary + current cards grouped by subtype */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'}`}>
          <RoleSummary rb={rb} />
          {rb.cards.length > 0 ? (
            <RoleCardGroups cards={rb.cards} role={rb.role} onPreview={onPreview} onCardAction={onCardAction} menuProps={menuProps} addedCards={addedCards} />
          ) : (
            <p className="text-xs text-muted-foreground italic px-0.5">No cards filling this role</p>
          )}
        </div>

        {/* Vertical divider */}
        {hasSuggestions && (
          <div className="hidden md:block w-px bg-border/30 shrink-0 -my-3" />
        )}

        {/* Right column: potential replacements as card image grid */}
        {hasSuggestions && (
          <div className="flex-1 min-w-0">
            <SuggestionCardGrid
              title={<>Suggested {rb.label} ({rb.suggestedReplacements.length})</>}
              cards={rb.suggestedReplacements}
              onAdd={onAdd}
              onPreview={onPreview}
              addedCards={addedCards}
              deficit={rb.deficit}
              onCardAction={onCardAction}
              menuProps={menuProps}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Roles Tab: Content Orchestrator ─────────────────────────────────
export function RolesTabContent({
  roleBreakdowns, activeRole, onRoleChange, onPreview, onAdd, addedCards, onCardAction, menuProps,
}: {
  roleBreakdowns: RoleBreakdown[];
  activeRole: string | null;
  onRoleChange: (role: string) => void;
  onPreview: (name: string) => void;
  onAdd: (name: string) => void;
  addedCards: Set<string>;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {

  const activeRb = roleBreakdowns.find(rb => rb.role === activeRole);

  return (
    <div className="flex-1 flex flex-col">
      <RoleSummaryStrip roleBreakdowns={roleBreakdowns} activeRole={activeRole} onRoleClick={onRoleChange} />
      {activeRb && (
        <RoleDetailPanel key={activeRb.role} rb={activeRb} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} />
      )}
    </div>
  );
}
