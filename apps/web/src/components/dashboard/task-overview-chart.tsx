'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@agentos/ui';

export type TaskOverviewDay = { date: string; completed: number; failed: number };

const SERIES = [
  { key: 'completed', color: 'var(--color-series-1)' },
  { key: 'failed', color: 'var(--color-series-2)' },
] as const;

// Geometry in CSS pixels. The SVG is drawn at its container's real width, so text keeps its
// size on narrow screens instead of shrinking with a scaled viewBox.
const DEFAULT_WIDTH = 420;
const HEIGHT = 200;
const PAD = { top: 8, right: 4, bottom: 24, left: 28 };
const BAR = 12; // ≤ 24px, leaves air in each band
const GAP = 2; // surface gap between the two bars of a day
const RADIUS = 4;

/** Clean tick step so the axis reads 0 / 5 / 10 … rather than 0 / 3.3 / 6.6. */
function niceMax(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 2, 4] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // Task counts are whole numbers, so the axis never steps by less than 1.
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough,
  );
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

/** Column with a 4px rounded data end and a square base on the baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, height, width / 2);
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

export function TaskOverviewChart({ days }: { days: TaskOverviewDay[] }) {
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

  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const longDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const label = (date: string) => weekday.format(new Date(`${date}T00:00:00Z`));

  const max = Math.max(0, ...days.flatMap((d) => [d.completed, d.failed]));
  const { top, ticks } = niceMax(max);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / days.length;
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const isEmpty = max === 0;
  const activeDay = active === null ? undefined : days[active];

  return (
    <figure aria-labelledby={titleId} className="space-y-3">
      <figcaption id={titleId} className="sr-only">
        {t('tableCaption')}
      </figcaption>

      <div className="flex items-center justify-between gap-3">
        <ul className="flex gap-4 text-sm text-text-muted">
          {SERIES.map((series) => (
            <li key={series.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: series.color }}
              />
              {t(series.key)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setShowTable((value) => !value)}
          className="text-xs text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          {showTable ? t('showChart') : t('showTable')}
        </button>
      </div>

      {showTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('tableCaption')}</caption>
          <thead className="text-xs text-text-muted">
            <tr>
              <th className="py-1.5 text-left font-medium">{t('day')}</th>
              <th className="py-1.5 text-right font-medium">{t('completed')}</th>
              <th className="py-1.5 text-right font-medium">{t('failed')}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {days.map((day) => (
              <tr key={day.date} className="border-t border-border">
                <td className="py-1.5">{longDate.format(new Date(`${day.date}T00:00:00Z`))}</td>
                <td className="py-1.5 text-right">{format.number(day.completed)}</td>
                <td className="py-1.5 text-right">{format.number(day.failed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" ref={containerRef}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            className="block w-full"
            role="group"
            aria-label={t('taskOverview')}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--color-grid)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-text-subtle text-[10px] tabular-nums"
                >
                  {format.number(tick)}
                </text>
              </g>
            ))}

            {days.map((day, index) => {
              const center = PAD.left + band * index + band / 2;
              const x0 = center - BAR - GAP / 2;
              return (
                <g
                  key={day.date}
                  tabIndex={0}
                  role="img"
                  aria-label={`${longDate.format(new Date(`${day.date}T00:00:00Z`))}: ${t('completed')} ${day.completed}, ${t('failed')} ${day.failed}`}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  {/* Hit target: the full band, larger than the marks. */}
                  <rect
                    x={PAD.left + band * index}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    className={cn('fill-transparent', active === index && 'fill-surface-2')}
                  />
                  {SERIES.map((series, s) => {
                    const value = day[series.key];
                    if (value <= 0) return null;
                    return (
                      <path
                        key={series.key}
                        d={barPath(x0 + s * (BAR + GAP), y(value), BAR, PAD.top + plotH - y(value))}
                        fill={series.color}
                      />
                    );
                  })}
                  <text
                    x={center}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    className="fill-text-muted text-[11px]"
                  >
                    {label(day.date)}
                  </text>
                </g>
              );
            })}
          </svg>

          {isEmpty && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center pb-6">
              <p className="rounded-md bg-surface px-3 py-1 text-sm text-text-muted">
                {t('tasksEmpty')}
              </p>
            </div>
          )}

          {activeDay && !isEmpty && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg"
              // Beside the hovered column, never over its bars; flips left near the right edge.
              style={
                active < days.length / 2
                  ? { left: PAD.left + band * (active + 1) + 4 }
                  : { right: width - (PAD.left + band * active) + 4 }
              }
            >
              <p className="mb-1 text-text-muted">
                {longDate.format(new Date(`${activeDay.date}T00:00:00Z`))}
              </p>
              {SERIES.map((series) => (
                <p key={series.key} className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3" style={{ background: series.color }} />
                  <strong className="font-semibold tabular-nums">
                    {format.number(activeDay[series.key])}
                  </strong>
                  <span className="text-text-muted">{t(series.key)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
