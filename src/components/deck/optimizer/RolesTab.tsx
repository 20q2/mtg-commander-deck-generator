import { useState, useMemo } from 'react';
import { Shield, Plus, Check, ArrowUpDown } from 'lucide-react';
import type { ScryfallCard, UserCardList } from '@/types';
import type { RoleBreakdown, AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { scryfallImg, roleBarColor, ROLE_META, ROLE_LABELS, ROLE_KNOWN_SUBTYPES, type CollapsibleGroup } from './constants';
import { AnalyzedCardRow, CollapsibleCardGroups, RecommendationRow, type CardAction } from './shared';
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
    <div className="-mx-3 sm:-mx-4 -mt-3 sm:-mt-4 grid grid-cols-2 sm:grid-cols-4 border-b border-border/30">
      {roleBreakdowns.map((rb, i) => {
        const meta = ROLE_META[rb.role];
        const Icon = meta?.icon || Shield;
        const pct = rb.target > 0 ? Math.min(100, (rb.current / rb.target) * 100) : 100;
        const met = rb.current >= rb.target;
        const isActive = activeRole === rb.role;
        return (
          <button
            key={rb.role}
            onClick={() => onRoleClick(rb.role)}
            className={`p-2.5 text-left transition-all hover:bg-card/80 ${
              i % 2 !== 0 ? 'border-l border-l-border/30' : ''
            } ${i < 2 ? 'border-b border-b-border/30 sm:border-b-0' : ''} ${
              i > 0 ? 'sm:border-l sm:border-l-border/30' : ''
            } ${
              isActive ? met ? 'bg-emerald-500/5' : 'bg-amber-500/5' : ''
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-4 h-4 ${isActive ? (meta?.color || 'text-muted-foreground') : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider truncate ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {rb.label}
              </span>
              {met && <Check className="w-3.5 h-3.5 text-emerald-400/50 ml-auto shrink-0" />}
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
              <span className="text-[11px] text-muted-foreground text-right">{rb.target} suggested</span>
            </div>
            <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: roleBarColor(rb.current, rb.target) }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Roles Tab: Grouped Card List ────────────────────────────────────
export function RoleCardGroups({ cards, role, onPreview, onCardAction, menuProps }: {
  cards: AnalyzedCard[];
  role: string;
  onPreview: (name: string) => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
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
            onCardAction={onCardAction}
            menuProps={menuProps ? {
              userLists: menuProps.userLists,
              isMustInclude: menuProps.mustIncludeNames.has(ac.card.name),
              isBanned: menuProps.bannedNames.has(ac.card.name),
              isInSideboard: menuProps.sideboardNames.has(ac.card.name),
              isInMaybeboard: menuProps.maybeboardNames.has(ac.card.name),
            } : undefined}
          />
        ))}
      </div>
    ),
  }));

  return <CollapsibleCardGroups groups={groups} totalCount={cards.length} />;
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {
  const hasSuggestions = rb.suggestedReplacements.length > 0;

  return (
    <div className="-mx-3 sm:-mx-4 -mb-3 sm:-mb-4 bg-black/15 px-3 sm:px-4 py-3">
      <div className={`${hasSuggestions ? 'flex flex-col md:flex-row md:items-stretch gap-4' : ''}`}>
        {/* Left column: current cards grouped by subtype */}
        <div className={`${hasSuggestions ? 'md:w-[30%] shrink-0' : 'w-full'}`}>
          {rb.cards.length > 0 ? (
            <RoleCardGroups cards={rb.cards} role={rb.role} onPreview={onPreview} onCardAction={onCardAction} menuProps={menuProps} />
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
  menuProps?: { userLists: UserCardList[]; mustIncludeNames: Set<string>; bannedNames: Set<string>; sideboardNames: Set<string>; maybeboardNames: Set<string> };
}) {

  const activeRb = roleBreakdowns.find(rb => rb.role === activeRole);

  return (
    <div>
      <RoleSummaryStrip roleBreakdowns={roleBreakdowns} activeRole={activeRole} onRoleClick={onRoleChange} />
      {activeRb && (
        <RoleDetailPanel key={activeRb.role} rb={activeRb} onPreview={onPreview} onAdd={onAdd} addedCards={addedCards} onCardAction={onCardAction} menuProps={menuProps} />
      )}
    </div>
  );
}
