import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import type { ThemeMembership } from './themeMembership';

export type GroupKey = 'cmc' | 'theme' | 'role' | 'type';

export interface GroupOption {
  key: GroupKey;
  label: string;
}

export const GROUP_OPTIONS: GroupOption[] = [
  { key: 'cmc',   label: 'CMC'   },
  { key: 'theme', label: 'Theme' },
  { key: 'role',  label: 'Role'  },
  { key: 'type',  label: 'Type'  },
];

export interface Column {
  key: string;
  label: string;
  matches: (card: ScryfallCard) => boolean;
}

export interface ColumnContext {
  themeMembership: ThemeMembership | null;
}

const CMC_LABELS = ['CMC 0', 'CMC 1', 'CMC 2', 'CMC 3', 'CMC 4', 'CMC 5', 'CMC 6', 'CMC 7+'];

function cmcColumns(): Column[] {
  return CMC_LABELS.map((label, i) => ({
    key: `cmc:${i}`,
    label,
    matches: (card) => {
      const cmc = Math.min(Math.floor(card.cmc ?? 0), 7);
      return cmc === i;
    },
  }));
}

function themeColumns(ctx: ColumnContext): Column[] {
  const themes = ctx.themeMembership?.themes ?? [];
  const byCard = ctx.themeMembership?.byCard;
  const has = (card: ScryfallCard, idx: number) =>
    !!byCard?.get(card.name.toLowerCase())?.includes(idx);

  if (themes.length === 0) {
    return [{ key: 'theme:all', label: 'All', matches: () => true }];
  }
  if (themes.length === 1) {
    return [
      { key: `theme:${themes[0].slug}`, label: themes[0].name, matches: (c) => has(c, 0) },
      { key: 'theme:off',                 label: 'Off-theme',     matches: (c) => !has(c, 0) },
    ];
  }
  return [
    { key: `theme:${themes[0].slug}`, label: themes[0].name,
      matches: (c) => has(c, 0) && !has(c, 1) },
    { key: 'theme:both',              label: 'Both',
      matches: (c) => has(c, 0) && has(c, 1) },
    { key: `theme:${themes[1].slug}`, label: themes[1].name,
      matches: (c) => has(c, 1) && !has(c, 0) },
    { key: 'theme:off',               label: 'Off-theme',
      matches: (c) => !has(c, 0) && !has(c, 1) },
  ];
}

function roleColumns(): Column[] {
  return [
    { key: 'role:ramp',       label: 'Ramp',       matches: (c) => c.deckRole === 'ramp' },
    { key: 'role:removal',    label: 'Removal',    matches: (c) => c.deckRole === 'removal' },
    { key: 'role:wipe',       label: 'Wipes',      matches: (c) => c.deckRole === 'boardwipe' },
    { key: 'role:draw',       label: 'Draw',       matches: (c) => c.deckRole === 'cardDraw' },
    { key: 'role:protection', label: 'Protection', matches: (c) => c.deckRole === 'protection' },
    { key: 'role:other',      label: 'Other',
      matches: (c) => !c.deckRole || !['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection'].includes(c.deckRole) },
  ];
}

function typeOf(card: ScryfallCard): string {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  if (t.includes('creature'))     return 'creature';
  if (t.includes('planeswalker')) return 'planeswalker';
  if (t.includes('battle'))       return 'battle';
  if (t.includes('artifact'))     return 'artifact';
  if (t.includes('enchantment'))  return 'enchantment';
  if (t.includes('instant'))      return 'instant';
  if (t.includes('sorcery'))      return 'sorcery';
  return 'other';
}

function typeColumns(): Column[] {
  return [
    { key: 'type:creature',     label: 'Creature',     matches: (c) => typeOf(c) === 'creature' },
    { key: 'type:planeswalker', label: 'Planeswalker', matches: (c) => typeOf(c) === 'planeswalker' },
    { key: 'type:battle',       label: 'Battle',       matches: (c) => typeOf(c) === 'battle' },
    { key: 'type:artifact',     label: 'Artifact',     matches: (c) => typeOf(c) === 'artifact' },
    { key: 'type:enchantment',  label: 'Enchantment',  matches: (c) => typeOf(c) === 'enchantment' },
    { key: 'type:instant',      label: 'Instant',      matches: (c) => typeOf(c) === 'instant' },
    { key: 'type:sorcery',      label: 'Sorcery',      matches: (c) => typeOf(c) === 'sorcery' },
    { key: 'type:other',        label: 'Other',        matches: (c) => typeOf(c) === 'other' },
  ];
}

export function getColumns(groupKey: GroupKey, ctx: ColumnContext): Column[] {
  switch (groupKey) {
    case 'cmc':   return cmcColumns();
    case 'theme': return themeColumns(ctx);
    case 'role':  return roleColumns();
    case 'type':  return typeColumns();
  }
}

export function shouldCollapseRows(groupKey: GroupKey): boolean {
  return groupKey === 'type';
}
