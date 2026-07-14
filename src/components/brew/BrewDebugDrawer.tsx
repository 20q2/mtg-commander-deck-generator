import { useMemo } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { useHeaderAnchoredTop } from '@/components/brew/BrewDeckListButton';
import {
  buildHealth, computeDeficits, CHAR_TAG_MIN_LIFT, CHAR_TAG_MIN_CARRIERS, themeKindMatches,
  type BrewContext, type BrewState, type BrewCandidate,
} from '@/services/brew/engine';
import { Bug, X } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
 * Developer debug panel: a holistic, read-only dump of everything that drives
 * how the brew's card pool and packs are populated. Not user-facing — it's the
 * "why is this pack like this?" window. Everything is derived from the live
 * BrewContext / BrewState, so it always reflects the current run.
 * ──────────────────────────────────────────────────────────────────────────── */

const MONO = 'font-mono tabular-nums';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/40 px-4 py-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="text-muted-foreground/80">{label}</span>
      <span className={`${MONO} font-semibold ${tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-foreground/90'}`}>{value}</span>
    </div>
  );
}

/** Pool-local tag lift for one theme, recomputed here so the panel can show the numbers behind the
 *  characteristic-tag decision (mirrors chromaTags.ts computeThemeCharTags). */
function themeTagLift(candidates: BrewCandidate[], slug: string, poolCarriers: Map<string, number>) {
  const members = candidates.filter(c => c.themeTags.includes(slug));
  const memberN = members.length;
  const poolN = candidates.length || 1;
  const memberCarriers = new Map<string, number>();
  for (const c of members) for (const t of c.chromaTags ?? []) memberCarriers.set(t, (memberCarriers.get(t) ?? 0) + 1);
  const rows: { tag: string; carriers: number; lift: number }[] = [];
  for (const [tag, mc] of memberCarriers) {
    const base = (poolCarriers.get(tag) ?? 0) / poolN;
    const lift = base > 0 && memberN > 0 ? (mc / memberN) / base : 0;
    rows.push({ tag, carriers: mc, lift });
  }
  rows.sort((a, b) => b.lift - a.lift);
  return { rows, memberN };
}

export function BrewDebugContent({ onClose }: { onClose: () => void }) {
  const { brewContext, brewState, brewNode } = useStore();

  const derived = useMemo(() => {
    if (!brewContext || !brewState) return null;
    const ctx = brewContext as BrewContext;
    const st = brewState as BrewState;
    const cands = ctx.candidates;

    const label = (tag: string) => ctx.chromaTagLabels?.[tag] ?? tag;
    const tagsLoaded = !!ctx.themeCharTags;
    const stamped = cands.filter(c => c.chromaTags !== undefined).length;
    const withTags = cands.filter(c => (c.chromaTags?.length ?? 0) > 0).length;
    const gcInPool = cands.filter(c => ctx.gameChangerNames?.has(c.name)).length;

    // Pool-wide chroma-tag carrier counts (also the baseline for the per-theme lift below).
    const poolCarriers = new Map<string, number>();
    for (const c of cands) for (const t of c.chromaTags ?? []) poolCarriers.set(t, (poolCarriers.get(t) ?? 0) + 1);
    const tagAgg = [...poolCarriers.entries()].sort((a, b) => b[1] - a[1]);

    const themes = Object.entries(ctx.themeNames).map(([slug, name]) => {
      const membership = cands.filter(c => c.themeTags.includes(slug)).length;
      const sigs = ctx.themeSignatures[slug] ?? [];
      const charTags = ctx.themeCharTags?.[slug] ?? [];
      const { rows } = themeTagLift(cands, slug, poolCarriers);
      return {
        slug, name, membership, sigCount: sigs.length,
        affinity: Math.round(st.themeAffinity[slug] ?? 0),
        vetoed: st.vetoedThemes?.includes(slug) ?? false,
        charTags, liftRows: rows.slice(0, 10),
        kind: ctx.themeKinds?.[slug] ?? { kind: 'archetype' as const },
      };
    });

    const health = buildHealth(ctx, st);
    const deficits = computeDeficits(ctx, st);
    const fill = ctx.nonLandTarget ? st.picks.length / ctx.nonLandTarget : 0;

    return { ctx, st, cands, label, tagsLoaded, stamped, withTags, gcInPool, tagAgg, themes, health, deficits, fill };
  }, [brewContext, brewState]);

  if (!derived) return null;
  const { ctx, st, cands, label, tagsLoaded, stamped, withTags, gcInPool, tagAgg, themes, health, deficits, fill } = derived;

  const sigSet = (slug: string) => new Set(ctx.themeSignatures[slug] ?? []);

  // The current pack round, if we're on one — the "why is THIS pack like this" breakdown.
  const packOptions = (brewNode?.options ?? []).filter(o => (o.cards?.length ?? 0) > 0);

  return (
    <div className="brew-foundry flex h-full flex-col bg-card/95 backdrop-blur-md">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-violet-200">
          <Bug className="h-4 w-4" /> Pool &amp; Pack Debug
        </span>
        <button onClick={onClose} aria-label="Close debug" className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-foreground/90">
        {/* ── Overview ── */}
        <Section title="Overview">
          <Stat label="Commander" value={ctx.commander.name} />
          {ctx.partnerCommander && <Stat label="Partner" value={ctx.partnerCommander.name} />}
          <Stat label="Color identity" value={ctx.colorIdentity.join('') || 'C'} />
          <Stat label="Candidate pool (non-land)" value={cands.length} />
          <Stat label="Discovered (mid-run)" value={st.discovered.length} />
          <Stat label="Deck fill" value={`${st.picks.length}/${ctx.nonLandTarget} · ${Math.round(fill * 100)}%`} />
          <Stat label="Banned (excluded)" value={ctx.customization.bannedCards?.length ?? 0} />
          <Stat label="Game changers in pool" value={gcInPool} />
        </Section>

        {/* ── Tag index health ── the single most important "why" toggle. */}
        <Section title="SpellChroma tag index" subtitle="When this isn't loaded (e.g. CORS-blocked on localhost), theme-tag gating, Good Stuff / Game Changers packs, and tag chips all fall back to legacy behavior.">
          <Stat label="Loaded (themeCharTags)" value={tagsLoaded ? 'YES' : 'NO — legacy fallback'} tone={tagsLoaded ? 'ok' : 'warn'} />
          <Stat label="Cards stamped w/ chromaTags" value={`${stamped}/${cands.length}`} tone={stamped ? undefined : 'warn'} />
          <Stat label="Cards carrying ≥1 tag" value={withTags} />
          <Stat label="Distinct tags in pool" value={tagAgg.length} />
          <Stat label="Lift thresholds" value={`lift ≥ ${CHAR_TAG_MIN_LIFT}, carriers ≥ ${CHAR_TAG_MIN_CARRIERS}`} />
        </Section>

        {/* ── Themes ── membership, signatures, affinity, characteristic tags + lift ── */}
        <Section title={`Themes (${themes.length})`} subtitle="Per theme: how many pool cards it tags, its signature count, your affinity, and the characteristic-tag lift that decides theme-pack membership.">
          <div className="space-y-3">
            {themes.map(t => (
              <div key={t.slug} className="rounded-lg border border-border/40 bg-background/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold">
                    {t.name}
                    {t.vetoed && <span className="ml-1.5 rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">muted</span>}
                    <span className="ml-1.5 rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-300">
                      {t.kind.kind}{t.kind.kind !== 'archetype' ? `:${(t.kind as { match: string }).match}` : ''}
                    </span>
                  </span>
                  <span className={`${MONO} text-[10px] text-muted-foreground`}>{t.slug}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>pool: <b className={`${MONO} text-foreground/80`}>{t.membership}</b></span>
                  <span>sigs: <b className={`${MONO} text-foreground/80`}>{t.sigCount}</b></span>
                  <span>affinity: <b className={`${MONO} text-foreground/80`}>{t.affinity}</b></span>
                  <span>char tags: <b className={`${MONO} text-foreground/80`}>{t.charTags.length}</b></span>
                </div>
                {tagsLoaded && t.liftRows.length > 0 && (
                  <table className="mt-1.5 w-full text-[10px]">
                    <thead>
                      <tr className="text-muted-foreground/60">
                        <th className="text-left font-medium">tag</th>
                        <th className="text-right font-medium">lift</th>
                        <th className="text-right font-medium">carriers</th>
                        <th className="text-right font-medium">char?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.liftRows.map(r => {
                        const isChar = t.charTags.includes(r.tag);
                        return (
                          <tr key={r.tag} className={isChar ? 'text-emerald-300' : 'text-foreground/70'}>
                            <td className="pr-2">{label(r.tag)}</td>
                            <td className={`${MONO} text-right`}>{r.lift.toFixed(1)}×</td>
                            <td className={`${MONO} text-right`}>{r.carriers}</td>
                            <td className="text-right">{isChar ? '✓' : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Current pack round ── the direct "why these cards?" view. */}
        <Section title="Current pack round" subtitle={packOptions.length ? 'Each offered pack, its flavor/hallmark, and per-card: role, whether it is a theme signature, and which of the theme’s characteristic tags it carries.' : 'Not on a pack node right now (fork / event / question).'}>
          <div className="space-y-3">
            {packOptions.map(o => {
              const slug = o.id.startsWith('theme:') ? o.id.slice('theme:'.length) : null;
              const sigs = slug ? sigSet(slug) : new Set<string>();
              const chars = slug ? (ctx.themeCharTags?.[slug] ?? []) : [];
              return (
                <div key={o.id} className="rounded-lg border border-border/40 bg-background/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold">{o.label ?? o.id}</span>
                    <span className={`${MONO} text-[10px] text-muted-foreground`}>{o.flavor ?? '—'}{o.goldCard ? ' · +windfall' : ''}</span>
                  </div>
                  {o.hallmarkName && <div className="text-[10px] text-muted-foreground">hallmark: <b className="text-foreground/80">{o.hallmarkName}</b></div>}
                  <ul className="mt-1 space-y-0.5">
                    {o.cards.map(c => {
                      const matched = chars.filter(t => c.chromaTags?.includes(t)).map(label);
                      const slugK = slug ? ctx.themeKinds?.[slug] : undefined;
                      const detMatch = slugK && slugK.kind !== 'archetype' && themeKindMatches(slugK, c.scryfall)
                        ? slugK.kind : null;
                      return (
                        <li key={c.name} className="flex items-baseline justify-between gap-2 text-[10px]">
                          <span className="truncate text-foreground/85">
                            {c.name}
                            {slug && sigs.has(c.name) && <span className="ml-1 text-violet-300">·sig</span>}
                          </span>
                          <span className="shrink-0 text-right text-muted-foreground/80">
                            <span className={MONO}>{c.role ?? '—'}</span>
                            {detMatch && <span className="ml-1.5 text-emerald-300">{detMatch}✓</span>}
                            {!detMatch && slug && sigs.has(c.name) && <span className="ml-1.5 text-violet-300">via sig</span>}
                            {matched.length > 0 && <span className="ml-1.5 text-emerald-300">{matched.join(', ')}</span>}
                          </span>
                        </li>
                      );
                    })}
                    {o.goldCard && (
                      <li className="flex items-baseline justify-between gap-2 text-[10px] text-amber-300">
                        <span className="truncate">{o.goldCard.name}</span>
                        <span className="shrink-0">{o.windfallTier ?? 'gold'} windfall</span>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Roles / deficits ── drives the "need" pack. */}
        <Section title="Roles &amp; deficits" subtitle="The top deficit forms the steering 'need' pack once past the identity phase.">
          {(['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection'] as const).map(role => (
            <Stat key={role} label={role} value={`${health.roleCounts[role] ?? 0} / ${ctx.roleTargets[role] ?? 0}`} />
          ))}
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            top deficit: <b className="text-foreground/80">{deficits[0] ? `${deficits[0].shortLabel} (${deficits[0].deficit})` : 'none'}</b>
          </div>
        </Section>

        {/* ── Pool-wide chroma tag aggregation ── */}
        <Section title={`Chroma tag usage · pool-wide (${tagAgg.length} tags)`} subtitle="How many pool cards carry each mechanical tag. The baseline every theme's lift is measured against.">
          {tagAgg.length === 0
            ? <p className="text-[11px] text-muted-foreground/70">No tags stamped (index not loaded).</p>
            : (
              <table className="w-full text-[10px]">
                <tbody>
                  {tagAgg.slice(0, 60).map(([tag, count]) => (
                    <tr key={tag} className="text-foreground/75">
                      <td className="pr-2">{label(tag)}</td>
                      <td className={`${MONO} w-10 text-right text-muted-foreground`}>{count}</td>
                      <td className="pl-2" style={{ width: '55%' }}>
                        <span className="block h-1.5 rounded-full bg-violet-500/50" style={{ width: `${Math.round((count / tagAgg[0][1]) * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          {tagAgg.length > 60 && <p className="mt-1 text-[10px] text-muted-foreground/60">…{tagAgg.length - 60} more</p>}
        </Section>
      </div>
    </div>
  );
}

/**
 * The debug trigger, pinned below the Deck list button (same top-right dock on wide screens), opening
 * a right-side overlay drawer. Dev tool — always available while a session is live.
 */
export function BrewDebugButton({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const { brewContext, brewState } = useStore();
  // Deck list docks at header + 24 and is ~32px tall; sit just under it.
  const top = useHeaderAnchoredTop(24 + 40);
  if (!brewContext || !brewState) return null;

  return (
    <>
      <div style={{ right: 24, top }} className="flex justify-end mb-2 min-[1560px]:mb-0 min-[1560px]:fixed min-[1560px]:z-20">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => onToggle(!open)}
          className="h-8 gap-1.5 rounded-xl border border-border/50 bg-card/60 px-3 text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md hover:border-amber-400/40 hover:text-amber-100"
        >
          <Bug className="h-3.5 w-3.5" /> Debug
        </Button>
      </div>
      <Drawer open={open} onClose={() => onToggle(false)} position="right" onPositionChange={() => {}} defaultSizePercent={42} closeOnOutsideClick>
        {open && <BrewDebugContent onClose={() => onToggle(false)} />}
      </Drawer>
    </>
  );
}
