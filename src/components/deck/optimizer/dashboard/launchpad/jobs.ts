// src/components/deck/optimizer/dashboard/launchpad/jobs.ts
//
// The Overview launch pad's vocabulary: the jobs a player comes to the Inspector to do, which score
// areas each one moves, and the plain-English reasons shown beside a suggested swap. Pure — no React.
import type { LucideIcon } from 'lucide-react';
import type { SubScoreKey } from '@/types';
import type { OptimizeCard, RoleBreakdown, CurvePhaseAnalysis } from '@/services/deckBuilder/deckAnalyzer';
import type { PointsToGain } from '@/services/deckBuilder/planScore';
import { TABS, type TabKey } from '../../constants';

// A job wears its primary tab's rail icon, so picking a job here teaches the rail.
const tabIcon = (tab: TabKey): LucideIcon => TABS.find(t => t.key === tab)!.icon as LucideIcon;

export type JobId = 'upgrades' | 'new' | 'mana' | 'cheaper' | 'balance' | 'power';

export interface JobDef {
  id: JobId;
  /** Plain words, the player's own: "Make it cheaper", never "Cost Explorer". */
  label: string;
  /** Same icon as the rail tab it opens, so the launch pad teaches the rail. */
  Icon: LucideIcon;
  /** Score areas this job moves. Empty = it changes the deck without moving the score. */
  areas: SubScoreKey[];
  /** The tab(s) the job opens, first one primary. */
  tabs: { tab: TabKey; label: string }[];
}

const job = (id: JobId, label: string, areas: SubScoreKey[], tabs: JobDef['tabs']): JobDef =>
  ({ id, label, areas, tabs, Icon: tabIcon(tabs[0].tab) });

export const JOBS: JobDef[] = [
  job('upgrades', 'Find upgrades', ['cardFit', 'strategy'], [{ tab: 'optimize', label: 'Card Fit' }]),
  job('new', 'Find new cards', [], [{ tab: 'newCards', label: 'New Cards' }, { tab: 'lift', label: 'Lift Web' }]),
  job('mana', 'Build out the mana base', [], [{ tab: 'lands', label: 'Mana' }]),
  job('cheaper', 'Make it cheaper', [], [{ tab: 'cost', label: 'Cost Explorer' }]),
  job('balance', 'Balance roles and tempo', ['roles', 'tempo'], [{ tab: 'roles', label: 'Roles' }, { tab: 'curve', label: 'Tempo' }]),
  job('power', 'Check the power level', [], [{ tab: 'bracket', label: 'Bracket' }]),
];

export const JOB_BY_ID = Object.fromEntries(JOBS.map(j => [j.id, j])) as Record<JobId, JobDef>;

/** Which job wins back a given area's points — what a click on the path-to-100 line selects. */
export function jobForArea(area: SubScoreKey): JobId {
  return JOBS.find(j => j.areas.includes(area))?.id ?? 'upgrades';
}

export function pointsForJob(job: JobId, gains: PointsToGain[]): number {
  const areas = JOB_BY_ID[job].areas;
  return gains.filter(g => areas.includes(g.key)).reduce((s, g) => s + g.points, 0);
}

// ── Swap pairing ──────────────────────────────────────────────────────────
// Lives with the swap service (deckAnalyzer) so any surface that offers a swap pairs the same way —
// including its rule that a swap must be an upgrade at the deck's bracket.
export { pairSwaps, type SwapPair } from '@/services/deckBuilder/deckAnalyzer';

// ── Plain-English reasons ─────────────────────────────────────────────────

export interface ReasonContext {
  /** "Krenko", not "Krenko, Mob Boss". */
  commanderShort: string;
  /** Set when role targets are a bracket's decks' rather than the all-brackets average. */
  targetsBracket?: number;
  /** The bracket the deck is judged at — the aim, when the player has one. */
  judgedBracket?: number;
  roleBreakdowns?: RoleBreakdown[];
  curvePhases?: CurvePhaseAnalysis[];
}

const roleRow = (ctx: ReasonContext, role: string) => ctx.roleBreakdowns?.find(r => r.role === role);

/** Why a card is on the way out, in the words a player would use at the table. */
export function cutReason(c: OptimizeCard, ctx: ReasonContext): string {
  const cat = c.reasonCategory;
  if (cat.startsWith('excess:')) {
    // Targets are floors (the Balance panel says so), so a surplus is room to trade, never a fault.
    const rb = roleRow(ctx, cat.slice('excess:'.length));
    return rb && rb.current > rb.target
      ? `${rb.current} ${rb.label.toLowerCase()}, most ${ctx.targetsBracket ? `Bracket ${ctx.targetsBracket} ` : ''}${ctx.commanderShort} decks run ${rb.target}`
      : c.reason;
  }
  switch (cat) {
    case 'over-bracket': return c.reason;
    case 'misfit':
      if (c.reason === 'Low commander synergy') return `Low synergy with ${ctx.commanderShort}`;
      if (c.reason === "Not played in this commander's decks") return `Not in ${ctx.commanderShort} decks on EDHREC`;
      {
        // cardFit's label is a raw toFixed(0): a card in 0.4% of decks reads "Played in 0%" though the
        // deck plainly plays it.
        const m = c.reason.match(/^Played in (\d+)% of decklists$/);
        if (m) return +m[1] < 1 ? `In under 1% of ${ctx.commanderShort} decks` : `In ${m[1]}% of ${ctx.commanderShort} decks`;
      }
      return c.reason;
    case 'low-synergy': return `Low synergy with ${ctx.commanderShort}`;
    case 'low-inclusion':
      return c.inclusion != null ? `In ${Math.round(c.inclusion)}% of ${ctx.commanderShort} decks` : `Rarely played with ${ctx.commanderShort}`;
    case 'curve-fix': return c.cmc != null ? `Heavy for your curve at ${c.cmc} mana` : 'Heavy for your curve';
    case 'balance': return 'Trims the deck to size';
    case 'excess-land': return 'More lands than this deck needs';
    case 'tapland': return 'Enters the battlefield tapped';
    case 'off-plan': return "Doesn't serve your plan";
    case 'outplayed':
      return c.inclusion != null ? `In ${Math.round(c.inclusion)}% of ${ctx.commanderShort} decks` : `Rarely played with ${ctx.commanderShort}`;
    default: return c.reason;
  }
}

/**
 * Why a card is worth bringing in. `replacing` is the card it trades for, when there is one: a ramp
 * card swapped for a ramp card doesn't fill the ramp gap, so that pair says what it does do.
 */
export function addReason(c: OptimizeCard, ctx: ReasonContext, replacing?: OptimizeCard): string {
  const cat = c.reasonCategory;
  const pct = c.inclusion != null ? Math.round(c.inclusion) : null;
  const incl = pct != null ? ` · in ${pct}% of ${ctx.commanderShort} decks` : '';
  // Replacing a card cut for the aim: what makes the pick good is how much that bracket plays it.
  if (replacing?.reasonCategory === 'over-bracket' && c.fitInclusion != null && ctx.judgedBracket) {
    return `In ${Math.round(c.fitInclusion)}% of Bracket ${ctx.judgedBracket} ${ctx.commanderShort} decks`;
  }
  if (cat.startsWith('fills:')) {
    const role = cat.slice('fills:'.length);
    const rb = roleRow(ctx, role);
    if (replacing?.role === role) return `Also ${(rb?.label ?? role).toLowerCase()}${incl}`;
    // The service finds the gap on the deck's role counts; the Roles lanes count a multi-role card
    // in every lane it fills, so they can already read at target. Only claim a gap they show.
    if (!rb) return c.reason;
    if (rb.current < rb.target) return `Fills the ${rb.label.toLowerCase()} gap (${rb.current} of ${rb.target})`;
    // The role is already met, so it's no reason on its own: the case for the card is how much
    // these decks play it, set against the cut's "Not in X decks".
    return pct != null ? `In ${pct}% of ${ctx.commanderShort} decks` : `Adds ${rb.label.toLowerCase()}`;
  }
  if (cat.startsWith('curve:')) {
    const phase = ctx.curvePhases?.find(p => p.phase === cat.slice('curve:'.length));
    return phase ? `Fills your ${phase.label.toLowerCase()} (${phase.current} of ${phase.target})` : c.reason;
  }
  if (cat === 'flex-land') return 'A land that can be cast as a spell';
  if (cat === 'staple' && pct != null) return `A staple: in ${pct}% of ${ctx.commanderShort} decks`;
  if (cat === 'theme-staple') return `A top card for your plan${incl}`;
  return `${c.reason}${incl}`;
}
