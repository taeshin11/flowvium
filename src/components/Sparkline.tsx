/**
 * Tiny SVG sparkline — no deps, accepts array of numbers, renders polyline.
 * Auto-scales to min/max. Color by last-vs-first direction.
 */
'use client';
import { useMemo } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** stroke-width; default 1.25. */
  stroke?: number;
  /** className forwarded to outer svg. */
  className?: string;
}

export default function Sparkline({ values, width = 60, height = 16, stroke = 1.25, className }: SparklineProps) {
  const { path, color } = useMemo(() => {
    if (!values || values.length < 2) return { path: '', color: 'currentColor' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    // Padding so last point isn't clipped
    const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
    const y = (v: number) => height - 1 - ((v - min) / range) * (height - 2);
    const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const up = values[values.length - 1] >= values[0];
    return { path: d, color: up ? '#10b981' : '#ef4444' }; // emerald-500 / red-500
  }, [values, width, height]);

  if (!path) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      role="img"
    >
      <path d={path} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
