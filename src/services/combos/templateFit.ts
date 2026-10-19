/**
 * Does the deck actually contain a card that fills a combo's unnamed slot?
 *
 * Commander Spellbook describes slots like "Creature with Persist" as a
 * template: a human label plus the Scryfall query that matches it
 * (`t:creature keyword:persist`). Without checking that query against the deck
 * we can only report that the *named* cards are present — which is how
 * "Mikaeus, the Unhallowed + Phyrexian Altar" read as a complete combo in a
 * deck holding no persist creature.
 *
 * Rather than ask Scryfall (rate-limited, and some slot queries match thousands
 * of cards), this evaluates the query locally against the ScryfallCard objects
 * the deck already holds. It models the subset of Scryfall's grammar that
 * Spellbook templates actually use; anything outside that subset is reported
 * unverified rather than unfilled — falsely calling a working combo broken is
 * the worse error.
 */
import type { ComboTemplate, ComboTemplateFit, ScryfallCard } from '@/types';

class UnsupportedAtom extends Error {}

type Ast =
  | { kind: 'and'; nodes: Ast[] }
  | { kind: 'or'; nodes: Ast[] }
  | { kind: 'not'; node: Ast }
  | { kind: 'atom'; key: string; op: string; value: string }
  | { kind: 'exact'; value: string }
  | { kind: 'name'; value: string };

// --- Tokenizer ---------------------------------------------------------------

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let quoted = false;
  const flush = () => { if (buf) { tokens.push(buf); buf = ''; } };

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (quoted) {
      buf += ch;
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; buf += ch; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n') { flush(); continue; }
    if (ch === '(' || ch === ')') { flush(); tokens.push(ch); continue; }
    buf += ch;
  }
  flush();
  return tokens;
}

// --- Parser ------------------------------------------------------------------
// expr := or ; or := and (OR and)* ; and := unary+ ; unary := '-' unary | '(' expr ')' | atom

const ATOM_RE = /^([a-z]+)(<=|>=|!=|:|=|<|>)(.*)$/i;

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function parse(tokens: string[]): Ast {
  let pos = 0;

  const peek = () => tokens[pos];
  const isOr = (t?: string) => t?.toLowerCase() === 'or';
  const isAnd = (t?: string) => t?.toLowerCase() === 'and';

  function parseOr(): Ast {
    const nodes = [parseAnd()];
    while (isOr(peek())) { pos++; nodes.push(parseAnd()); }
    return nodes.length === 1 ? nodes[0] : { kind: 'or', nodes };
  }

  function parseAnd(): Ast {
    const nodes: Ast[] = [parseUnary()];
    for (;;) {
      const t = peek();
      if (t === undefined || t === ')' || isOr(t)) break;
      if (isAnd(t)) { pos++; continue; }
      nodes.push(parseUnary());
    }
    return nodes.length === 1 ? nodes[0] : { kind: 'and', nodes };
  }

  function parseUnary(): Ast {
    let t = peek();
    if (t === undefined) throw new UnsupportedAtom('unexpected end of query');
    if (t === '-') { pos++; return { kind: 'not', node: parseUnary() }; }
    if (t.startsWith('-') && t.length > 1) {
      tokens[pos] = t.slice(1);
      return { kind: 'not', node: parseUnary() };
    }
    if (t === '(') {
      pos++;
      const inner = parseOr();
      if (peek() !== ')') throw new UnsupportedAtom('unbalanced parentheses');
      pos++;
      return inner;
    }
    if (t === ')') throw new UnsupportedAtom('unexpected )');
    pos++;
    t = t.trim();
    // !"Card Name" is Scryfall's exact-name match. It shows up constantly as a
    // `-!"…"` carve-out on otherwise simple template queries, so supporting it
    // keeps those queries checkable instead of unverified.
    if (t.startsWith('!')) return { kind: 'exact', value: unquote(t.slice(1)) };
    const m = ATOM_RE.exec(t);
    if (!m) return { kind: 'name', value: unquote(t) };
    return { kind: 'atom', key: m[1].toLowerCase(), op: m[2], value: unquote(m[3]) };
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new UnsupportedAtom('trailing tokens');
  return ast;
}

// --- Card field accessors ----------------------------------------------------
// Faces are folded in so a split/MDFC card matches on either half, which is how
// Scryfall treats these fields for search purposes.

function typeLineOf(card: ScryfallCard): string {
  const faces = card.card_faces?.map(f => f.type_line).filter(Boolean).join(' // ') ?? '';
  return `${card.type_line ?? ''} ${faces}`.toLowerCase();
}

function oracleOf(card: ScryfallCard): string {
  const faces = card.card_faces?.map(f => f.oracle_text ?? '').join('\n') ?? '';
  return `${card.oracle_text ?? ''}\n${faces}`.toLowerCase();
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numeric(value: string | undefined): number {
  if (value === undefined) return NaN;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}

function compare(actual: number, op: string, expected: number): boolean {
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  switch (op) {
    case ':': case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    default: throw new UnsupportedAtom(`operator ${op}`);
  }
}

const COLOR_LETTERS = new Set(['w', 'u', 'b', 'r', 'g']);
const NAMED_COLORS: Record<string, string> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
};

function parseColors(value: string): string[] {
  const v = value.toLowerCase();
  // "colorless", bare "c" and "0" all mean the empty color set.
  if (v === 'colorless' || v === 'c' || v === '0') return [];
  if (v in NAMED_COLORS) return [NAMED_COLORS[v]];
  const letters = v.split('');
  if (letters.length > 0 && letters.every(l => COLOR_LETTERS.has(l))) return letters;
  throw new UnsupportedAtom(`color ${value}`);
}

/** `c:rg` is "at least these colors"; `c=rg` is "exactly these colors". */
function colorMatch(have: string[], want: string[], op: string): boolean {
  if (op === '=' || op === '!=') {
    const exact = have.length === want.length && want.every(w => have.includes(w));
    return op === '=' ? exact : !exact;
  }
  if (op !== ':') throw new UnsupportedAtom(`color operator ${op}`);
  return want.length === 0 ? have.length === 0 : want.every(w => have.includes(w));
}

/** Normalized mana cost symbols, e.g. "{1}{G}" → ["1","G"]. */
function manaSymbols(card: ScryfallCard): string[] {
  const cost = card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '';
  return (cost.match(/\{[^}]+\}/g) ?? []).map(sym => sym.slice(1, -1).toUpperCase());
}

const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle'];

function matchesIs(card: ScryfallCard, value: string): boolean {
  const type = typeLineOf(card);
  switch (value) {
    case 'permanent': return PERMANENT_TYPES.some(t => type.includes(t));
    case 'spell': return !type.includes('land');
    case 'token': return card.layout === 'token';
    case 'dfc': case 'mdfc': case 'transform': case 'tdfc':
      return Array.isArray(card.card_faces) && card.card_faces.length > 1;
    case 'flip': return card.layout === 'flip';
    case 'vanilla': return type.includes('creature') && oracleOf(card).trim() === '';
    default: throw new UnsupportedAtom(`is:${value}`);
  }
}

function matchesAtom(card: ScryfallCard, key: string, op: string, value: string): boolean {
  const v = value.toLowerCase();
  switch (key) {
    case 't': case 'type':
      // Whole type words only, so t:ally can't match a "Rally" and t:art can't
      // match "Artifact" — Scryfall matches type words, not substrings.
      return new RegExp(`\\b${escapeRe(v)}`, 'i').test(typeLineOf(card));
    case 'keyword': case 'kw':
      return (card.keywords ?? []).some(k => k.toLowerCase() === v);
    case 'o': case 'oracle': case 'fo': case 'text': {
      // `~` is Scryfall's placeholder for the card's own name.
      const text = oracleOf(card);
      const needle = v.replace(/~/g, card.name.toLowerCase());
      if (needle.length > 1 && needle.startsWith('/') && needle.endsWith('/')) {
        return new RegExp(needle.slice(1, -1), 'i').test(text);
      }
      return text.includes(needle);
    }
    case 'm': case 'mana': {
      const have = manaSymbols(card);
      const want = (value.match(/\{[^}]+\}/g) ?? []).map(sym => sym.slice(1, -1).toUpperCase());
      // `mana=` is the exact cost; `mana:` is "contains these symbols". The
      // comparison forms (`m<{0}`) are a subset test we don't model.
      if (op === '=') return have.length === want.length && want.every((w, i) => have[i] === w);
      if (op === '!=') return !(have.length === want.length && want.every((w, i) => have[i] === w));
      if (op === ':') return want.every(w => have.includes(w));
      throw new UnsupportedAtom(`mana operator ${op}`);
    }
    case 'legal': case 'f': case 'format':
      return (card.legalities as Record<string, string> | undefined)?.[v] === 'legal';
    case 'mv': case 'cmc': case 'manavalue':
      return compare(card.cmc ?? NaN, op, numeric(v));
    case 'pow': case 'power':
      return compare(numeric(card.power ?? card.card_faces?.[0]?.power), op, numeric(v));
    case 'tou': case 'toughness':
      return compare(numeric(card.toughness ?? card.card_faces?.[0]?.toughness), op, numeric(v));
    case 'loy': case 'loyalty':
      return compare(numeric(card.loyalty), op, numeric(v));
    case 'name': case 'n':
      return card.name.toLowerCase().includes(v);
    case 'r': case 'rarity':
      return (card.rarity ?? '').toLowerCase() === v;
    case 'is': case 'has':
      return matchesIs(card, v);
    case 'c': case 'color': {
      const have = (card.colors ?? card.card_faces?.[0]?.colors ?? []).map(x => x.toLowerCase());
      return colorMatch(have, parseColors(v), op);
    }
    case 'id': case 'identity': case 'ci': {
      const want = parseColors(v);
      const have = (card.color_identity ?? []).map(x => x.toLowerCase());
      return have.every(h => want.includes(h));
    }
    case 'produces': {
      const want = parseColors(v);
      const have = (card.produced_mana ?? []).map(x => x.toLowerCase());
      return want.every(w => have.includes(w));
    }
    default:
      throw new UnsupportedAtom(`${key}:`);
  }
}

function evaluate(card: ScryfallCard, ast: Ast): boolean {
  switch (ast.kind) {
    case 'and': return ast.nodes.every(n => evaluate(card, n));
    case 'or': return ast.nodes.some(n => evaluate(card, n));
    case 'not': return !evaluate(card, ast.node);
    case 'exact': return card.name.toLowerCase() === ast.value.toLowerCase()
      || (card.name.includes(' // ') && card.name.split(' // ')[0].toLowerCase() === ast.value.toLowerCase());
    case 'name': return card.name.toLowerCase().includes(ast.value.toLowerCase());
    case 'atom': return matchesAtom(card, ast.key, ast.op, ast.value);
  }
}

// --- Public API --------------------------------------------------------------

// Parsing is pure and queries repeat across combos — cache per query string.
// A null entry means "unsupported", including atoms that only throw at match time.
const astCache = new Map<string, Ast | null>();

function astFor(query: string): Ast | null {
  if (astCache.has(query)) return astCache.get(query)!;
  let ast: Ast | null = null;
  try {
    ast = parse(tokenize(query));
  } catch (err) {
    console.warn(`[Combos] Unsupported template query "${query}": ${(err as Error).message}`);
  }
  astCache.set(query, ast);
  return ast;
}

/**
 * Measure one template slot against the deck's cards.
 * `excludeNames` keeps a combo's own named pieces from filling its unnamed slot —
 * a Spellbook template is always an *additional* card.
 */
export function fitTemplate(
  template: ComboTemplate,
  deckCards: ScryfallCard[],
  excludeNames: Set<string>,
): ComboTemplateFit {
  const quantity = Math.max(1, template.quantity ?? 1);
  const query = (template.scryfallQuery ?? '').trim();
  const ast = query ? astFor(query) : null;

  if (!ast) return { template, filledBy: [], satisfied: true, verified: false };

  const filledBy: string[] = [];
  for (const card of deckCards) {
    if (excludeNames.has(card.name)) continue;
    try {
      if (evaluate(card, ast)) filledBy.push(card.name);
    } catch (err) {
      // An atom the grammar parsed but the matcher can't model (is:foil, …).
      console.warn(`[Combos] Unsupported template query "${query}": ${(err as Error).message}`);
      astCache.set(query, null);
      return { template, filledBy: [], satisfied: true, verified: false };
    }
  }

  return { template, filledBy, satisfied: filledBy.length >= quantity, verified: true };
}

/** Measure every slot a combo needs. Returns [] when the combo has no templates. */
export function fitTemplates(
  templates: ComboTemplate[] | undefined,
  deckCards: ScryfallCard[],
  excludeNames: Set<string>,
): ComboTemplateFit[] {
  if (!templates?.length) return [];
  return templates.map(t => fitTemplate(t, deckCards, excludeNames));
}

/** Label for a slot, e.g. "2× creature with persist". */
export function templateLabel(t: ComboTemplate): string {
  const qty = t.quantity && t.quantity > 1 ? `${t.quantity}× ` : '';
  return `${qty}${t.name}`;
}

/**
 * Scryfall query for an unfilled slot, narrowed to what this deck could legally
 * run — an uncoloured search offers persist creatures in colours the deck can't
 * cast. `id<=` is subset-of-identity; an empty identity means a colourless deck,
 * where only `id=c` is playable. `legal:commander` keeps banned cards out of a
 * list of things to go find. Returns null when the template ships no query
 * (Spellbook leaves ~15% blank), since a search for nothing but a colour filter
 * is worse than no search at all.
 *
 * Shared by the in-app slot browser and the "open on Scryfall" link so the two
 * can never disagree about what fills the slot.
 */
export function slotSearchQuery(scryfallQuery: string | undefined, deckColorIdentity: string): string | null {
  const q = (scryfallQuery ?? '').trim();
  if (!q) return null;
  const identity = deckColorIdentity ? `id<=${deckColorIdentity.toLowerCase()}` : 'id=c';
  return `${q} ${identity} legal:commander`;
}

/** Scryfall web-search URL for a slot, or null when the template ships no query. */
export function slotSearchUrl(scryfallQuery: string | undefined, deckColorIdentity: string): string | null {
  const q = slotSearchQuery(scryfallQuery, deckColorIdentity);
  return q ? `https://scryfall.com/search?q=${encodeURIComponent(q)}` : null;
}
