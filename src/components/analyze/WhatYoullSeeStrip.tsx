import { LayoutDashboard, Shield, Mountain, BarChart3, Gauge, DollarSign, ChartNetwork, Wand2 } from 'lucide-react';

const PILLARS = [
  { key: 'overview', label: 'Overview', desc: 'Health grade and at-a-glance gaps', color: 'text-emerald-400', icon: LayoutDashboard },
  { key: 'roles',    label: 'Roles',    desc: 'Ramp, removal, draw, wipes — vs targets', color: 'text-sky-400',     icon: Shield },
  { key: 'mana',     label: 'Mana',     desc: 'Land count, fixing, color sources', color: 'text-violet-400',  icon: Mountain },
  { key: 'tempo',    label: 'Tempo',    desc: 'Curve shape and pacing fit', color: 'text-amber-400',   icon: BarChart3 },
  { key: 'bracket',  label: 'Bracket',  desc: 'Estimated power level (1-5)', color: 'text-rose-400',    icon: Gauge },
  { key: 'cost',     label: 'Cost',     desc: 'Cheaper printings to trim the price', color: 'text-lime-400',    icon: DollarSign },
  { key: 'lift',     label: 'Lift Web', desc: 'Cards that pair unusually well with yours', color: 'text-fuchsia-400', icon: ChartNetwork },
  { key: 'cardfit',  label: 'Card Fit', desc: 'Misfits to cut, gaps to fill', color: 'text-cyan-400',    icon: Wand2 },
];

export function WhatYoullSeeStrip() {
  return (
    <div className="mt-8 max-w-5xl mx-auto">
      <p className="text-xs text-muted-foreground uppercase tracking-wider text-center mb-3">What we'll show you</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {PILLARS.map(p => (
          <div
            key={p.key}
            className="rounded-lg border border-border/40 bg-card/30 backdrop-blur-sm px-3 py-2.5 flex flex-col gap-1"
          >
            <div className="flex items-center gap-1.5">
              <p.icon className={`w-3.5 h-3.5 ${p.color}`} />
              <span className="text-sm font-semibold">{p.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground/80 leading-snug">{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
