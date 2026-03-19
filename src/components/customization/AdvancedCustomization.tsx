import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Sparkles, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PieChart } from '@/components/ui/pie-chart';
import { CardTypeIcon } from '@/components/ui/mtg-icons';
import { useStore } from '@/store';
import { calculateCurvePercentages, calculateTypePercentages } from '@/services/deckBuilder/curveUtils';
import { getDeckFormatConfig } from '@/lib/constants/archetypes';
import type { AdvancedTargets } from '@/types';

// --- Color constants ---

const CURVE_COLORS: Record<number, string> = {
  0: '#93c5fd', 1: '#60a5fa', 2: '#3b82f6', 3: '#2563eb',
  4: '#7c3aed', 5: '#6d28d9', 6: '#5b21b6', 7: '#4c1d95',
};

const CURVE_LABELS: Record<number, string> = {
  0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7+',
};

const TYPE_COLORS: Record<string, string> = {
  land: '#a3a3a3',         // neutral-400
  creature: '#22c55e', instant: '#3b82f6', sorcery: '#ef4444',
  artifact: '#a78bfa', enchantment: '#fbbf24', planeswalker: '#c084fc',
};

const TYPE_LABELS: Record<string, string> = {
  creature: 'Creatures', instant: 'Instants', sorcery: 'Sorceries',
  artifact: 'Artifacts', enchantment: 'Enchantments', planeswalker: 'Planeswalkers',
};

const ROLE_COLORS: Record<string, string> = {
  ramp: '#10b981', removal: '#ef4444', boardwipe: '#f97316', cardDraw: '#3b82f6', other: '#6b7280',
};

const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp', removal: 'Removal', boardwipe: 'Board Wipes', cardDraw: 'Card Advantage',
};

const FALLBACK_CURVE: Record<number, number> = {
  0: 2, 1: 12, 2: 20, 3: 25, 4: 18, 5: 12, 6: 6, 7: 5,
};

const FALLBACK_TYPES: Record<string, number> = {
  creature: 45, instant: 12, sorcery: 12, artifact: 12, enchantment: 12, planeswalker: 3,
};

function getDefaultRoleTargets(format: number): Record<string, number> {
  if (format >= 99) return { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };
  if (format >= 60) return { ramp: 4, removal: 5, boardwipe: 2, cardDraw: 4 };
  if (format >= 40) return { ramp: 2, removal: 3, boardwipe: 1, cardDraw: 2 };
  const ratio = format / 99;
  return {
    ramp: Math.max(1, Math.round(10 * ratio)),
    removal: Math.max(1, Math.round(8 * ratio)),
    boardwipe: Math.max(0, Math.round(3 * ratio)),
    cardDraw: Math.max(1, Math.round(10 * ratio)),
  };
}

// --- Sub-components ---

function ColorSlider({ value, min, max, color, onChange }: {
  value: number; min: number; max: number; color: string;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="relative w-full">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2.5 rounded-full appearance-none cursor-pointer slider-colored"
        style={{
          background: `linear-gradient(to right, ${color} ${pct}%, hsl(var(--secondary)) ${pct}%)`,
        }}
      />
    </div>
  );
}

function EditableValue({ value, onChange, unit, min, max }: {
  value: number; onChange: (v: number) => void; unit?: string; min: number; max: number;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setInputVal(String(Math.round(value)));
    setEditing(true);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = parseInt(inputVal, 10);
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-12 text-xs font-mono text-center bg-secondary/80 border border-primary/50 rounded px-1 py-0.5 outline-none"
        min={min}
        max={max}
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="text-xs font-mono text-foreground bg-secondary/50 hover:bg-secondary rounded px-1.5 py-0.5 transition-colors min-w-[2.5rem] text-center cursor-text"
      title="Click to type a value"
    >
      {Math.round(value)}{unit ?? '%'}
    </button>
  );
}

function SliderRow({ label, value, min, max, color, unit, cardCount, onChange, onHover, highlighted, icon, editMin, editMax }: {
  label: string; value: number; min: number; max: number; color: string;
  unit?: string; cardCount?: number; icon?: React.ReactNode;
  editMin?: number; editMax?: number;
  onChange: (v: number) => void; onHover?: (hovering: boolean) => void; highlighted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-lg transition-colors ${highlighted ? 'bg-secondary/60' : 'hover:bg-secondary/30'}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      {icon ? (
        <div className="w-6 h-6 shrink-0 flex items-center justify-center">{icon}</div>
      ) : (
        <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10" style={{ backgroundColor: color }} />
      )}
      {label && <span className="text-xs text-muted-foreground w-[5.5rem] shrink-0 truncate">{label}</span>}
      <div className="flex-1 min-w-0">
        <ColorSlider value={value} min={min} max={max} color={color} onChange={onChange} />
      </div>
      <EditableValue value={value} onChange={onChange} unit={unit} min={editMin ?? min} max={editMax ?? max} />
      {cardCount !== undefined && (
        <span className="text-[10px] text-muted-foreground/60 w-8 text-right shrink-0" title="Approx. cards">
          ~{cardCount}
        </span>
      )}
    </div>
  );
}

function SectionHeader({ title, isActive, onReset, total, onNormalize }: {
  title: string; isActive: boolean; onReset: () => void;
  total?: number; onNormalize?: () => void;
}) {
  const isGood = total !== undefined && Math.abs(total - 100) < 0.5;
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {isActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">Custom</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {total !== undefined && (
          <span className={`text-[11px] font-mono font-semibold ${isGood ? 'text-emerald-400' : total > 100 ? 'text-red-400' : 'text-amber-400'}`}>
            {Math.round(total)}%
          </span>
        )}
        {total !== undefined && onNormalize && !isGood && (
          <button
            onClick={onNormalize}
            className="text-[10px] px-3 py-0.5 rounded border border-primary text-primary hover:bg-primary/10 transition-colors"
            title="Scale values to sum to 100%"
          >
            Fix
          </button>
        )}
        {isActive && (
          <button onClick={onReset} className="text-muted-foreground hover:text-foreground transition-colors p-0.5" title="Reset to defaults">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Main Component ---

export function AdvancedCustomization({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { customization, updateCustomization, edhrecStats, partnerCommander } = useStore();
  const { advancedTargets, deckFormat, landCount, balancedRoles } = customization;
  const commanderCount = partnerCommander ? 2 : 1;
  const totalDeckCards = deckFormat === 99 ? (100 - commanderCount) : (deckFormat - commanderCount);
  const nonLandCards = totalDeckCards - landCount;

  // Hover state for highlighting pie segments
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Compute EDHREC-based defaults
  const edhrecCurveDefaults = useMemo(() => {
    if (!edhrecStats?.manaCurve || Object.keys(edhrecStats.manaCurve).length === 0) return FALLBACK_CURVE;
    const pcts = calculateCurvePercentages(edhrecStats.manaCurve);
    if (Object.keys(pcts).length === 0) return FALLBACK_CURVE;
    const result: Record<number, number> = {};
    let allocated = 0;
    for (let i = 0; i <= 7; i++) {
      result[i] = Math.round(pcts[i] ?? 0);
      allocated += result[i];
    }
    // Adjust largest bucket for rounding error
    const diff = 100 - allocated;
    if (diff !== 0) {
      const largest = Object.entries(result).reduce((m, [k, v]) => v > result[Number(m)] ? k : m, '0');
      result[Number(largest)] += diff;
    }
    return result;
  }, [edhrecStats]);

  const edhrecTypeDefaults = useMemo(() => {
    if (!edhrecStats) return FALLBACK_TYPES;
    const pcts = calculateTypePercentages(edhrecStats);
    if (Object.keys(pcts).length === 0) return FALLBACK_TYPES;
    const types = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'];
    const result: Record<string, number> = {};
    let allocated = 0;
    for (const t of types) {
      result[t] = Math.round(pcts[t] ?? 0);
      allocated += result[t];
    }
    const diff = 100 - allocated;
    if (diff !== 0) result.creature += diff;
    return result;
  }, [edhrecStats]);

  const roleDefaults = useMemo(() => getDefaultRoleTargets(deckFormat), [deckFormat]);

  // Derive displayed values: store overrides > EDHREC defaults > hardcoded fallback
  // No local state needed — sliders commit to store immediately
  const curveValues = advancedTargets.curvePercentages ?? edhrecCurveDefaults;
  const typeValues = advancedTargets.typePercentages ?? edhrecTypeDefaults;
  const roleValues = advancedTargets.roleTargets ?? roleDefaults;

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const curveTotal = Object.values(curveValues).reduce((s, v) => s + v, 0);
  const typeTotal = Object.values(typeValues).reduce((s, v) => s + v, 0);

  const commitToStore = useCallback((patch: Partial<AdvancedTargets>) => {
    const current = useStore.getState().customization.advancedTargets;
    updateCustomization({ advancedTargets: { ...current, ...patch } });
  }, [updateCustomization]);

  const updateCurve = useCallback((cmc: number, value: number) => {
    const next = { ...useStore.getState().customization.advancedTargets.curvePercentages ?? curveValues, [cmc]: value };
    commitToStore({ curvePercentages: next });
  }, [curveValues, commitToStore]);

  const updateType = useCallback((type: string, value: number) => {
    const next = { ...useStore.getState().customization.advancedTargets.typePercentages ?? typeValues, [type]: value };
    commitToStore({ typePercentages: next });
  }, [typeValues, commitToStore]);

  const updateRole = useCallback((role: string, value: number) => {
    const next = { ...useStore.getState().customization.advancedTargets.roleTargets ?? roleValues, [role]: value };
    commitToStore({ roleTargets: next });
  }, [roleValues, commitToStore]);

  const resetCurve = useCallback(() => {
    commitToStore({ curvePercentages: null });
  }, [commitToStore]);

  const resetTypes = useCallback(() => {
    commitToStore({ typePercentages: null });
  }, [commitToStore]);

  const resetRoles = useCallback(() => {
    commitToStore({ roleTargets: null });
  }, [commitToStore]);

  const resetAll = useCallback(() => {
    updateCustomization({ advancedTargets: { curvePercentages: null, typePercentages: null, roleTargets: null } });
  }, [updateCustomization]);

  const normalizeCurve = useCallback(() => {
    if (curveTotal === 0) return;
    const MAX = 50; // slider max for curve
    const keys = Object.keys(curveValues).map(Number).sort((a, b) => a - b);
    const normalized: Record<number, number> = {};

    // First pass: scale proportionally and cap at max
    let capped = 0;
    let uncappedTotal = 0;
    for (const k of keys) {
      const scaled = Math.round((curveValues[k] / curveTotal) * 100);
      if (scaled > MAX) {
        normalized[k] = MAX;
        capped += MAX;
      } else {
        normalized[k] = scaled;
        uncappedTotal += scaled;
      }
    }

    // Second pass: distribute remainder from capped values to uncapped ones
    const remainder = 100 - capped - uncappedTotal;
    if (remainder > 0 && uncappedTotal > 0) {
      const uncappedKeys = keys.filter(k => normalized[k] < MAX);
      let distributed = 0;
      for (const k of uncappedKeys) {
        const share = Math.round((normalized[k] / uncappedTotal) * remainder);
        normalized[k] = Math.min(MAX, normalized[k] + share);
        distributed += share;
      }
      // Fix rounding leftovers
      const leftover = remainder - distributed;
      if (leftover !== 0 && uncappedKeys.length > 0) {
        const target = uncappedKeys.reduce((m, k) => normalized[k] > normalized[m] ? k : m, uncappedKeys[0]);
        normalized[target] = Math.min(MAX, normalized[target] + leftover);
      }
    }

    commitToStore({ curvePercentages: normalized });
  }, [curveValues, curveTotal, commitToStore]);

  const normalizeTypes = useCallback(() => {
    if (typeTotal === 0) return;
    const MAX = 80; // slider max for types
    const keys = Object.keys(typeValues);
    const normalized: Record<string, number> = {};

    // First pass: scale proportionally and cap at max
    let capped = 0;
    let uncappedTotal = 0;
    for (const k of keys) {
      const scaled = Math.round((typeValues[k] / typeTotal) * 100);
      if (scaled > MAX) {
        normalized[k] = MAX;
        capped += MAX;
      } else {
        normalized[k] = scaled;
        uncappedTotal += scaled;
      }
    }

    // Second pass: distribute remainder to uncapped sliders
    const remainder = 100 - capped - uncappedTotal;
    if (remainder > 0 && uncappedTotal > 0) {
      const uncappedKeys = keys.filter(k => normalized[k] < MAX);
      let distributed = 0;
      for (const k of uncappedKeys) {
        const share = Math.round((normalized[k] / uncappedTotal) * remainder);
        normalized[k] = Math.min(MAX, normalized[k] + share);
        distributed += share;
      }
      const leftover = remainder - distributed;
      if (leftover !== 0 && uncappedKeys.length > 0) {
        normalized[uncappedKeys[0]] = Math.min(MAX, normalized[uncappedKeys[0]] + leftover);
      }
    } else if (remainder > 0) {
      // All sliders at max or zero — spread evenly to zero sliders
      const zeroKeys = keys.filter(k => normalized[k] === 0);
      if (zeroKeys.length > 0) {
        const each = Math.floor(remainder / zeroKeys.length);
        let given = 0;
        for (const k of zeroKeys) { normalized[k] = each; given += each; }
        normalized[zeroKeys[0]] += remainder - given;
      }
    }

    commitToStore({ typePercentages: normalized });
  }, [typeValues, typeTotal, commitToStore]);

  // Average CMC from curve percentages (weighted average)
  const avgCmc = useMemo(() => {
    if (curveTotal === 0) return 0;
    const weighted = Object.entries(curveValues).reduce((sum, [cmc, pct]) => sum + Number(cmc) * pct, 0);
    return weighted / curveTotal;
  }, [curveValues, curveTotal]);

  // Pie chart data
  const curvePieData = useMemo(() =>
    Object.entries(curveValues).map(([cmc, val]) => ({
      color: CURVE_COLORS[Number(cmc)] || '#6b7280',
      value: val, label: CURVE_LABELS[Number(cmc)] || `${cmc}`,
      colorKey: `cmc-${cmc}`,
      icon: <span style={{ fontSize: '0.7em', fontWeight: 700 }}>{CURVE_LABELS[Number(cmc)] || cmc}</span>,
    })),
  [curveValues]);

  const landRange = getDeckFormatConfig(deckFormat).landRange;
  const TYPE_ICONS: Record<string, string> = {
    land: 'ms-land', creature: 'ms-creature', instant: 'ms-instant',
    sorcery: 'ms-sorcery', artifact: 'ms-artifact', enchantment: 'ms-enchantment',
    planeswalker: 'ms-planeswalker',
  };

  const typePieData = useMemo(() => {
    // Show lands as a proportion of total deck, non-land types as their share
    const landPct = totalDeckCards > 0 ? (landCount / totalDeckCards) * 100 : 0;
    const nonLandPct = 100 - landPct;
    const segments = Object.entries(typeValues)
      .filter(([t]) => t in TYPE_LABELS)
      .map(([type, val]) => ({
        color: TYPE_COLORS[type], value: typeTotal > 0 ? (val / typeTotal) * nonLandPct : 0,
        label: TYPE_LABELS[type] || type, colorKey: type,
        icon: <i className={`ms ${TYPE_ICONS[type]}`} />,
      }));
    segments.unshift({ color: TYPE_COLORS.land, value: landPct, label: 'Lands', colorKey: 'land', icon: <i className="ms ms-land" /> });
    return segments;
  }, [typeValues, typeTotal, landCount, totalDeckCards]);

  const roleTotal = Object.values(roleValues).reduce((s, v) => s + v, 0);
  const otherCount = Math.max(0, nonLandCards - roleTotal);

  const rolePieData = useMemo(() =>
    Object.entries(roleValues).filter(([r]) => r in ROLE_LABELS).map(([role, val]) => ({
      color: ROLE_COLORS[role], value: val,
      label: ROLE_LABELS[role] || role, colorKey: role,
      icon: <span style={{ fontSize: '0.7em', fontWeight: 700 }}>{val}</span>,
    })),
  [roleValues]);

  const hasAnyOverride = advancedTargets.curvePercentages !== null
    || advancedTargets.typePercentages !== null
    || advancedTargets.roleTargets !== null;

  // Closing animation state
  const [closing, setClosing] = useState(false);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
      const timer = setTimeout(() => { setVisible(false); setClosing(false); }, 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex justify-end ${closing ? 'animate-fade-out' : 'animate-fade-in'}`} onClick={handleClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className={`relative w-full max-w-lg bg-card border-l border-border shadow-2xl h-full overflow-y-auto ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-md border-b border-border px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold">Deck Tuning</h2>
          </div>
          <div className="flex items-center gap-2">
            {hasAnyOverride && (
              <Button variant="ghost" size="sm" onClick={resetAll} className="text-xs h-7 px-2">
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset to commander defaults
              </Button>
            )}
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Fine-tune the framework your deck is built around. <strong className="text-foreground">These values are used as suggestions for the algorithm, not hard targets</strong> — we'll do our best to match them given the data available for your commander.
          </p>

          {/* ── Card Types ── */}
          <section>
            <SectionHeader
              title="Card Types"
              isActive={advancedTargets.typePercentages !== null}
              onReset={resetTypes}
              total={typeTotal}
              onNormalize={normalizeTypes}
            />
            <div className="flex justify-center mb-3">
              <PieChart data={typePieData} size={130} activeColorKey={hoveredKey} centerLabel={String(totalDeckCards)} centerSublabel="cards" />
            </div>
            <div className="space-y-0.5">
              <SliderRow
                label="Lands"
                value={landCount}
                min={landRange[0]} max={landRange[1]}
                editMin={1} editMax={totalDeckCards - 1}
                color={TYPE_COLORS.land}
                icon={<CardTypeIcon type="land" size="sm" className="opacity-80" />}
                unit=""
                cardCount={landCount}
                onChange={(v) => {
                  const newNonBasic = Math.min(customization.nonBasicLandCount, v);
                  updateCustomization({ landCount: v, nonBasicLandCount: newNonBasic });
                }}
                onHover={(h) => setHoveredKey(h ? 'land' : null)}
                highlighted={hoveredKey === 'land'}
              />
              <div className="border-t border-border/20 my-1" />
              {Object.keys(TYPE_LABELS).map(type => (
                <SliderRow
                  key={type}
                  label={TYPE_LABELS[type]}
                  value={typeValues[type] ?? 0}
                  min={0} max={80}
                  color={TYPE_COLORS[type]}
                  icon={<CardTypeIcon type={type} size="sm" className="opacity-80" />}
                  cardCount={typeTotal > 0 ? Math.round(((typeValues[type] ?? 0) / typeTotal) * nonLandCards) : 0}
                  onChange={(v) => updateType(type, v)}
                  onHover={(h) => setHoveredKey(h ? type : null)}
                  highlighted={hoveredKey === type}
                />
              ))}
            </div>
          </section>

          <div className="border-t border-border/30" />

          {/* ── Mana Curve ── */}
          <section>
            <SectionHeader
              title="Mana Curve"
              isActive={advancedTargets.curvePercentages !== null}
              onReset={resetCurve}
              total={curveTotal}
              onNormalize={normalizeCurve}
            />
            <div className="flex justify-center mb-3">
              <PieChart data={curvePieData} size={130} activeColorKey={hoveredKey} centerLabel={avgCmc.toFixed(1)} centerSublabel="avg cmc" />
            </div>
            <div className="space-y-0.5">
              {[0, 1, 2, 3, 4, 5, 6, 7].map(cmc => (
                <SliderRow
                  key={cmc}
                  label=""
                  value={curveValues[cmc] ?? 0}
                  min={0} max={50}
                  color={CURVE_COLORS[cmc]}
                  icon={<span className="text-xs font-semibold text-muted-foreground">{cmc <= 6 ? cmc : '7+'}</span>}
                  cardCount={curveTotal > 0 ? Math.round(((curveValues[cmc] ?? 0) / curveTotal) * nonLandCards) : 0}
                  onChange={(v) => updateCurve(cmc, v)}
                  onHover={(h) => setHoveredKey(h ? `cmc-${cmc}` : null)}
                  highlighted={hoveredKey === `cmc-${cmc}`}
                />
              ))}
            </div>
          </section>

          <div className="border-t border-border/30" />

          {/* ── Role Targets ── */}
          <section className={!balancedRoles ? 'opacity-40 pointer-events-none' : ''}>
            <SectionHeader
              title="Role Targets"
              isActive={advancedTargets.roleTargets !== null}
              onReset={resetRoles}
            />
            <p className="text-[10px] text-muted-foreground mb-3">
              Role targets are card counts, not percentages. Setting these overrides the balanced roles system.
            </p>
            {!balancedRoles ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Role targets are disabled while Classic Build mode is on. Toggle it off to use this section.
              </p>
            ) : (
              <>
                <div className="flex justify-center mb-3">
                  <PieChart data={rolePieData} size={130} activeColorKey={hoveredKey} />
                </div>
                <div className="space-y-0.5">
                  {Object.keys(ROLE_LABELS).map(role => (
                    <SliderRow
                      key={role}
                      label={ROLE_LABELS[role]}
                      value={roleValues[role] ?? 0}
                      min={0} max={20}
                      color={ROLE_COLORS[role]}
                      unit=""
                      onChange={(v) => updateRole(role, v)}
                      onHover={(h) => setHoveredKey(h ? role : null)}
                      highlighted={hoveredKey === role}
                    />
                  ))}
                  <div className="flex items-center gap-2.5 py-1.5 px-2 -mx-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: ROLE_COLORS.other }} />
                    <span className="text-xs text-muted-foreground/60 w-[5.5rem] shrink-0 flex items-center gap-1">
                      Other
                      <span className="relative group">
                        <Info className="w-3 h-3 text-muted-foreground/40 cursor-help" />
                        <span className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 w-48 px-2.5 py-1.5 rounded bg-popover border border-border text-[10px] text-popover-foreground leading-tight opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                          Remaining slots filled with engines, combo pieces, and synergy cards for your commander.
                        </span>
                      </span>
                    </span>
                    <div className="flex-1" />
                    <span className="text-xs font-mono text-muted-foreground/60">{otherCount}</span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
