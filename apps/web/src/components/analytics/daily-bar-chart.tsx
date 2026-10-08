'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@agentos/ui';

export type DailyPoint = { date: string; values: number[] };

// Categorical colours in fixed order (validated pair, see theme.css).
const COLORS = ['var(--color-series-1)', 'var(--color-series-2)'] as const;

const DEFAULT_WIDTH = 520;
const HEIGHT = 200;
const PAD = { top: 8, right: 4, bottom: 24, left: 44 };
const GAP = 2; // surface gap between stacked segments
const RADIUS = 4;
const LABEL_SPACE = 64; // px per date label on the x-axis

/** Clean axis steps (1 / 2 / 5 × 10ⁿ); counts never step by less than 1. */
function niceMax(max: number, whole: boolean): { top: number; ticks: number[] } {
  if (max <= 0) return { top: whole ? 4 : 1, ticks: whole ? [0, 2, 4] : [0, 0.5, 1] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  if (whole) step = Math.max(1, step);
  const count = Math.ceil(max / step - 1e-9);
  return {
    top: count * step,
    ticks: Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12))),
  };
}

/** Segment path; only the top segment of a column gets the 4px rounded data end. */
function segmentPath(x: number, y: number, width: number, height: number, round: boolean) {
  const r = round ? Math.min(RADIUS, height, width / 2) : 0;
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}

/**
 * Daily column chart for 7–90 days: one series, or several stacked. Hover/focus tooltip and a
 * table view. One measure per chart; different measures get separate charts (no dual axis).
 */
export function DailyBarChart({
  days,
  series,
  unit,
  label,
  emptyText,
}: {
  days: DailyPoint[];
  series: string[];
  unit: 'count' | 'usd';
  /** Names the chart for assistive tech and the table caption. */
  label: string;
  emptyText: string;
}) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const locale = useLocale();
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [showTable]);

  const value = (n: number) =>
    unit === 'usd'
      ? format.number(n, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
        })
      : format.number(n);
  const shortDate = new Intl.DateTimeFormat(
    locale,
    days.length <= 7
      ? { weekday: 'short', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' },
  );
  const longDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

  const totals = days.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(0, ...totals);
  const { top, ticks } = niceMax(max, unit === 'count');
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / days.length;
  const bar = Math.max(2, Math.min(24, band * 0.6));
  const scale = (n: number) => (n / top) * plotH;
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(plotW / LABEL_SPACE)));
  const isEmpty = max === 0;
  // Short weekday labels fit their band; longer dates would spill past the right edge.
  const endLabel = (index: number) => index === days.length - 1 && days.length > 7;
  const activeDay = active === null ? undefined : days[active];
  const colors = series.map((_, i) => COLORS[i % COLORS.length]!);

  return (
    <figure aria-labelledby={titleId} className="space-y-3">
      <figcaption id={titleId} className="sr-only">
        {label}
      </figcaption>

      <div className="flex items-center justify-between gap-3">
        {series.length > 1 ? (
          <ul className="flex gap-4 text-sm text-text-muted">
            {series.map((name, i) => (
              <li key={name} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ background: colors[i] }}
                />
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-xs text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          {showTable ? t('showChart') : t('showTable')}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="text-xs text-text-muted">
              <tr>
                <th className="py-1.5 text-left font-medium">{t('day')}</th>
                {series.map((name) => (
                  <th key={name} className="py-1.5 text-right font-medium">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {days.map((day) => (
                <tr key={day.date} className="border-t border-border">
                  <td className="py-1.5">{longDate.format(asDate(day.date))}</td>
                  {day.values.map((v, i) => (
                    <td key={series[i]} className="py-1.5 text-right">
                      {value(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={containerRef}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            className="block w-full"
            role="group"
            aria-label={label}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((tick) => {
              const y = PAD.top + plotH - scale(tick);
              return (
                <g key={tick}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--color-grid)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={PAD.left - 8}
                    y={y}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-text-subtle text-[10px] tabular-nums"
                  >
                    {value(tick)}
                  </text>
                </g>
              );
            })}

            {days.map((day, index) => {
              const center = PAD.left + band * index + band / 2;
              const x = center - bar / 2;
              const visible = day.values.map((v, i) => ({ v, i })).filter((s) => s.v > 0);
              let base = PAD.top + plotH;
              return (
                <g
                  key={day.date}
                  tabIndex={0}
                  role="img"
                  aria-label={`${longDate.format(asDate(day.date))}: ${day.values
                    .map((v, i) => `${series[i]} ${value(v)}`)
                    .join(', ')}`}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  <rect
                    x={PAD.left + band * index}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    className={cn('fill-transparent', active === index && 'fill-surface-2')}
                  />
                  {visible.map((s, k) => {
                    const gap = k > 0 ? GAP : 0;
                    const h = Math.max(1, scale(s.v) - gap);
                    base -= gap;
                    const y = base - h;
                    const path = segmentPath(x, y, bar, h, k === visible.length - 1);
                    base = y;
                    return <path key={s.i} d={path} fill={colors[s.i]} />;
                  })}
                  {(days.length - 1 - index) % labelEvery === 0 && (
                    // Labels count back from today; the last one ends at the edge, never clipped.
                    <text
                      x={endLabel(index) ? width - PAD.right : center}
                      y={HEIGHT - 6}
                      textAnchor={endLabel(index) ? 'end' : 'middle'}
                      className="fill-text-muted text-[11px]"
                    >
                      {shortDate.format(asDate(day.date))}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {isEmpty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center pb-6">
              <p className="rounded-md bg-surface px-3 py-1 text-sm text-text-muted">{emptyText}</p>
            </div>
          )}

          {activeDay && !isEmpty && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs whitespace-nowrap shadow-lg"
              style={
                active < days.length / 2
                  ? { left: PAD.left + band * (active + 1) + 4 }
                  : { right: width - (PAD.left + band * active) + 4 }
              }
            >
              <p className="mb-1 text-text-muted">{longDate.format(asDate(activeDay.date))}</p>
              {activeDay.values.map((v, i) => (
                <p key={series[i]} className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3" style={{ background: colors[i] }} />
                  <strong className="font-semibold tabular-nums">{value(v)}</strong>
                  <span className="text-text-muted">{series[i]}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
