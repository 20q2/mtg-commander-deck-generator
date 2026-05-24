// src/components/deck/optimizer/dashboard/ConditionalWarnings.tsx
import { AlertTriangle, Info as InfoIcon } from 'lucide-react';
import type { DashboardWarning } from '@/types';
import type { TabKey } from '../constants';

export interface ConditionalWarningsProps {
  warnings: DashboardWarning[];
  onNavigate?: (tab: TabKey) => void;
}

const SEVERITY_STYLES = {
  info:  { border: 'border-l-sky-500/50',    bg: 'bg-sky-500/5',    icon: 'text-sky-400' },
  warn:  { border: 'border-l-amber-500/50',  bg: 'bg-amber-500/5',  icon: 'text-amber-400' },
  error: { border: 'border-l-rose-500/50',   bg: 'bg-rose-500/5',   icon: 'text-rose-400' },
};

export function ConditionalWarnings({ warnings, onNavigate }: ConditionalWarningsProps) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {warnings.map(w => {
        const style = SEVERITY_STYLES[w.severity];
        const Icon = w.severity === 'info' ? InfoIcon : AlertTriangle;
        const clickable = !!w.navigateTo && !!onNavigate;
        const wrapperClass = `flex items-start gap-2.5 px-3 py-2 rounded border-l-2 ${style.border} ${style.bg} text-xs w-full text-left ${clickable ? 'hover:bg-opacity-80 cursor-pointer' : ''}`;
        const content = (
          <>
            <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${style.icon}`} />
            <span className="leading-snug text-foreground/90">{w.message}</span>
          </>
        );
        return clickable ? (
          <button key={w.id} type="button" onClick={() => onNavigate!(w.navigateTo as TabKey)} className={wrapperClass}>
            {content}
          </button>
        ) : (
          <div key={w.id} className={wrapperClass}>{content}</div>
        );
      })}
    </div>
  );
}
