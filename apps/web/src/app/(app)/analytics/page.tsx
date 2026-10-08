import { Activity, CircleCheck, Coins, Hash, ShieldCheck, Timer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ANALYTICS_RANGES, getAnalytics, type AnalyticsRange } from '@agentos/core';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatTile,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@agentos/ui';
import { DailyBarChart } from '@/components/analytics/daily-bar-chart';
import { QueryTabs } from '@/components/common/query-tabs';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const DEFAULT_RANGE: AnalyticsRange = 30;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('analytics') };
}

/** Analytics (PRD Phase 8): tokens, cost by agent/model/provider, success rates, tools. */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { ctx } = await requireSession();
  const requested = Number((await searchParams).range);
  const range = (ANALYTICS_RANGES as readonly number[]).includes(requested)
    ? (requested as AnalyticsRange)
    : DEFAULT_RANGE;
  const report = await getAnalytics(getServices().db, ctx, range);
  const t = await getTranslations('analytics');
  const tp = await getTranslations('providers.kinds');
  const format = await getFormatter();

  const { totals, approvals } = report;
  const settled = (completed: number, failed: number) => completed + failed;
  const rate = (completed: number, failed: number) =>
    settled(completed, failed) === 0
      ? '—'
      : format.number(completed / settled(completed, failed), { style: 'percent' });
  const usd = (n: number) =>
    format.number(n, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: n !== 0 && n < 1 ? 4 : 2,
    });
  const compact = (n: number) => format.number(n, { notation: 'compact' });
  const duration = (seconds: number) =>
    seconds === 0
      ? '—'
      : seconds < 60
        ? format.number(seconds, {
            style: 'unit',
            unit: 'second',
            unitDisplay: 'narrow',
            maximumFractionDigits: 1,
          })
        : format.number(seconds / 60, {
            style: 'unit',
            unit: 'minute',
            unitDisplay: 'narrow',
            maximumFractionDigits: 1,
          });
  const provider = (kind: string) => (tp.has(kind as never) ? tp(kind as never) : kind);
  const num = (n: number) => format.number(n);

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="mb-5">
        <QueryTabs
          param="range"
          value={String(range)}
          defaultValue={String(DEFAULT_RANGE)}
          label={t('range')}
          tabs={ANALYTICS_RANGES.map((days) => ({
            value: String(days),
            label: t('lastDays', { days }),
          }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          icon={<Activity />}
          label={t('kpi.runs')}
          value={num(totals.runs)}
          detail={totals.failed > 0 ? t('kpi.failed', { count: totals.failed }) : undefined}
        />
        <StatTile
          icon={<CircleCheck />}
          label={t('kpi.successRate')}
          value={rate(totals.completed, totals.failed)}
        />
        <StatTile
          icon={<Hash />}
          label={t('kpi.tokens')}
          value={compact(totals.inputTokens + totals.outputTokens)}
          detail={t('kpi.tokenSplit', {
            input: compact(totals.inputTokens),
            output: compact(totals.outputTokens),
          })}
        />
        <StatTile
          icon={<Coins />}
          label={t('kpi.cost')}
          value={usd(totals.costUsd)}
          detail={
            totals.unpricedRuns > 0 ? t('kpi.unpriced', { count: totals.unpricedRuns }) : undefined
          }
        />
        <StatTile
          icon={<Timer />}
          label={t('kpi.avgRunTime')}
          value={duration(totals.avgSeconds)}
        />
        <StatTile
          icon={<ShieldCheck />}
          label={t('kpi.approvals')}
          value={num(approvals.approved + approvals.rejected + approvals.pending)}
          detail={[
            approvals.pending > 0 ? t('kpi.pending', { count: approvals.pending }) : null,
            approvals.medianMinutes !== null
              ? t('kpi.medianDecision', { time: duration(approvals.medianMinutes * 60) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('runsPerDay')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyBarChart
              days={report.days.map((d) => ({ date: d.day, values: [d.completed, d.failed] }))}
              series={[t('completed'), t('failed')]}
              unit="count"
              label={t('runsPerDayCaption', { days: range })}
              emptyText={t('noRuns')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('costPerDay')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyBarChart
              days={report.days.map((d) => ({ date: d.day, values: [d.costUsd] }))}
              series={[t('cost')]}
              unit="usd"
              label={t('costPerDayCaption', { days: range })}
              emptyText={t('noCost')}
            />
          </CardContent>
        </Card>
      </div>

      <Section title={t('byAgent')} empty={report.agents.length === 0 ? t('noRuns') : undefined}>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>{t('agent')}</TableHeaderCell>
              <Num>{t('runs')}</Num>
              <Num>{t('successRate')}</Num>
              <Num>{t('toolCalls')}</Num>
              <Num>{t('tokens')}</Num>
              <Num>{t('cost')}</Num>
              <Num>{t('avgRunTime')}</Num>
            </tr>
          </TableHead>
          <tbody className="tabular-nums">
            {report.agents.map((a) => (
              <TableRow key={a.agentId}>
                <TableCell>
                  <Link href={`/agents/${a.agentId}`} className="hover:text-primary">
                    {a.name}
                  </Link>
                </TableCell>
                <NumCell>{num(a.runs)}</NumCell>
                <NumCell>{rate(a.completed, a.failed)}</NumCell>
                <NumCell>{num(a.toolCalls)}</NumCell>
                <NumCell>{compact(a.inputTokens + a.outputTokens)}</NumCell>
                <NumCell>{usd(a.costUsd)}</NumCell>
                <NumCell>{duration(a.avgSeconds)}</NumCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title={t('byModel')} empty={report.models.length === 0 ? t('noRuns') : undefined}>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>{t('model')}</TableHeaderCell>
              <TableHeaderCell>{t('provider')}</TableHeaderCell>
              <Num>{t('runs')}</Num>
              <Num>{t('failed')}</Num>
              <Num>{t('fallbacks')}</Num>
              <Num>{t('tokens')}</Num>
              <Num>{t('cost')}</Num>
            </tr>
          </TableHead>
          <tbody className="tabular-nums">
            {report.models.map((m) => (
              <TableRow key={`${m.provider}/${m.model}`}>
                <TableCell className="font-mono text-xs">{m.model}</TableCell>
                <TableCell>{provider(m.provider)}</TableCell>
                <NumCell>{num(m.runs)}</NumCell>
                <NumCell>{num(m.failed)}</NumCell>
                <NumCell>{num(m.fallbacksFrom)}</NumCell>
                <NumCell>{compact(m.inputTokens + m.outputTokens)}</NumCell>
                <NumCell>{usd(m.costUsd)}</NumCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
        <p className="px-4 pt-3 text-xs text-text-subtle">{t('fallbacksHint')}</p>
      </Section>

      <Section title={t('byTool')} empty={report.tools.length === 0 ? t('noTools') : undefined}>
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>{t('tool')}</TableHeaderCell>
              <TableHeaderCell>{t('server')}</TableHeaderCell>
              <Num>{t('calls')}</Num>
              <Num>{t('succeeded')}</Num>
              <Num>{t('failed')}</Num>
              <Num>{t('blocked')}</Num>
              <Num>{t('neededApproval')}</Num>
            </tr>
          </TableHead>
          <tbody className="tabular-nums">
            {report.tools.map((tool) => (
              <TableRow key={`${tool.server}/${tool.toolName}`}>
                <TableCell className="font-mono text-xs">{tool.toolName}</TableCell>
                <TableCell>{tool.server ?? '—'}</TableCell>
                <NumCell>{num(tool.calls)}</NumCell>
                <NumCell>{num(tool.succeeded)}</NumCell>
                <NumCell>{num(tool.failed)}</NumCell>
                <NumCell>{num(tool.blocked)}</NumCell>
                <NumCell>{num(tool.needingApproval)}</NumCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section
        title={t('byWorkflow')}
        empty={report.workflows.length === 0 ? t('noWorkflows') : undefined}
      >
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>{t('workflow')}</TableHeaderCell>
              <Num>{t('runs')}</Num>
              <Num>{t('successRate')}</Num>
              <Num>{t('avgRunTime')}</Num>
            </tr>
          </TableHead>
          <tbody className="tabular-nums">
            {report.workflows.map((w) => (
              <TableRow key={w.workflowId}>
                <TableCell>
                  <Link href={`/workflows/${w.workflowId}`} className="hover:text-primary">
                    {w.name}
                  </Link>
                </TableCell>
                <NumCell>{num(w.runs)}</NumCell>
                <NumCell>{rate(w.completed, w.failed)}</NumCell>
                <NumCell>{duration(w.avgSeconds)}</NumCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-4">
        {empty ? <p className="px-5 py-4 text-sm text-text-muted">{empty}</p> : children}
      </CardContent>
    </Card>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <TableHeaderCell className="text-right">{children}</TableHeaderCell>;
}

function NumCell({ children }: { children: ReactNode }) {
  return <TableCell className="text-right">{children}</TableCell>;
}
