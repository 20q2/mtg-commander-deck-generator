import type { ReactNode } from 'react';

export interface PieChartSegment {
  color: string;
  value: number;
  label: string;
  colorKey: string;
  icon?: ReactNode;
}

export function PieChart({ data, size = 120, activeColorKey, onSegmentClick, centerLabel, centerSublabel }: {
  data: PieChartSegment[];
  size?: number;
  activeColorKey?: string | null;
  onSegmentClick?: (colorKey: string) => void;
  centerLabel?: string;
  centerSublabel?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const radius = size / 2;
  const innerRadius = radius * 0.6; // Donut style
  const midRadius = (radius + innerRadius) / 2;
  let currentAngle = -90; // Start from top

  const segments = data.filter(d => d.value > 0).map((d) => {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    const midAngle = startAngle + angle / 2;
    currentAngle = endAngle;

    // Icon position at midpoint of arc
    const midRad = (midAngle * Math.PI) / 180;
    const iconX = radius + midRadius * Math.cos(midRad);
    const iconY = radius + midRadius * Math.sin(midRad);

    // Full circle: SVG arcs can't draw a 360° arc, so use two semicircles
    if (angle >= 359.99) {
      const path = `
        M ${radius} 0
        A ${radius} ${radius} 0 1 1 ${radius} ${size}
        A ${radius} ${radius} 0 1 1 ${radius} 0
        Z
        M ${radius - innerRadius} ${radius}
        A ${innerRadius} ${innerRadius} 0 1 0 ${radius + innerRadius} ${radius}
        A ${innerRadius} ${innerRadius} 0 1 0 ${radius - innerRadius} ${radius}
        Z
      `;
      return { ...d, path, angle, iconX, iconY };
    }

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = radius + radius * Math.cos(startRad);
    const y1 = radius + radius * Math.sin(startRad);
    const x2 = radius + radius * Math.cos(endRad);
    const y2 = radius + radius * Math.sin(endRad);

    const ix1 = radius + innerRadius * Math.cos(startRad);
    const iy1 = radius + innerRadius * Math.sin(startRad);
    const ix2 = radius + innerRadius * Math.cos(endRad);
    const iy2 = radius + innerRadius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const path = `
      M ${x1} ${y1}
      A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
      L ${ix2} ${iy2}
      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1}
      Z
    `;

    return { ...d, path, angle, iconX, iconY };
  });

  // Min angle to show an icon (segment must be wide enough)
  const iconSize = size * 0.12;
  const minAngleForIcon = 20;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={onSegmentClick ? 'cursor-pointer' : ''}>
      {segments.map((seg, i) => (
        <path
          key={i}
          d={seg.path}
          fill={seg.color}
          fillRule="evenodd"
          className={`transition-opacity ${
            activeColorKey && seg.colorKey !== activeColorKey ? 'opacity-30' : 'hover:opacity-80'
          }`}
          onClick={() => onSegmentClick?.(seg.colorKey)}
        />
      ))}
      {segments.map((seg, i) => (
        seg.icon && seg.angle >= minAngleForIcon && (
          <foreignObject
            key={`icon-${i}`}
            x={seg.iconX - iconSize / 2}
            y={seg.iconY - iconSize / 2}
            width={iconSize}
            height={iconSize}
            className={`pointer-events-none transition-opacity ${activeColorKey && seg.colorKey !== activeColorKey ? 'opacity-30' : ''}`}
          >
            <div style={{ width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: iconSize * 0.75, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
              {seg.icon}
            </div>
          </foreignObject>
        )
      ))}
      {centerLabel && (
        <>
          <text x={radius} y={centerSublabel ? radius - 4 : radius} textAnchor="middle" dominantBaseline="central"
            fill="currentColor" fontSize={size * 0.17} fontWeight="700" className="text-foreground"
          >{centerLabel}</text>
          {centerSublabel && (
            <text x={radius} y={radius + size * 0.12} textAnchor="middle" dominantBaseline="central"
              fill="currentColor" fontSize={size * 0.09} className="text-muted-foreground" opacity={0.6}
            >{centerSublabel}</text>
          )}
        </>
      )}
    </svg>
  );
}
