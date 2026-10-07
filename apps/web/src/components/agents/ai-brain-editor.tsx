'use client';

import { Cpu, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Field,
  Input,
  Select,
  Slider,
  cn,
} from '@agentos/ui';
import {
  TASK_CATEGORY_KEYS,
  type BrainConnectionOption,
  type BrainTarget,
  type BrainValue,
} from './brain-types';

const STRATEGIES = ['fixed', 'fallback_chain', 'smart_router'] as const;
const NONE = 'none';

const emptyValue = (): BrainValue => ({
  strategy: 'fixed',
  primary: { connectionId: '', model: '' },
  routes: [],
  fallbacks: [],
  budget: { onExceed: 'stop' },
});

const isSet = (target: BrainTarget) => Boolean(target.connectionId && target.model);

function TargetPicker({
  id,
  label,
  value,
  onChange,
  connections,
  allowDefault,
}: {
  id: string;
  label: string;
  value: BrainTarget;
  onChange: (value: BrainTarget) => void;
  connections: BrainConnectionOption[];
  /** Adds a "use primary" choice (Smart Router routes). */
  allowDefault?: boolean;
}) {
  const t = useTranslations('brain');
  const connection = connections.find((c) => c.id === value.connectionId);
  const price = (m: BrainConnectionOption['models'][number]) =>
    m.local
      ? t('local')
      : m.price
        ? t('pricePerM', { input: m.price.input, output: m.price.output })
        : t('priceUnknown');

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        id={`${id}-provider`}
        aria-label={`${label}: ${t('providerLabel')}`}
        value={value.connectionId || (allowDefault ? NONE : undefined)}
        placeholder={t('chooseProvider')}
        onValueChange={(connectionId) =>
          onChange(
            connectionId === NONE ? { connectionId: '', model: '' } : { connectionId, model: '' },
          )
        }
        options={[
          ...(allowDefault ? [{ value: NONE, label: t('useDefault') }] : []),
          ...connections.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <Select
        id={`${id}-model`}
        aria-label={`${label}: ${t('modelLabel')}`}
        value={value.model || undefined}
        placeholder={t('chooseModel')}
        disabled={!connection}
        onValueChange={(model) => onChange({ connectionId: value.connectionId, model })}
        options={(connection?.models ?? []).map((m) => ({
          value: m.id,
          label: `${m.label} · ${price(m)}`,
        }))}
      />
    </div>
  );
}

/**
 * Step 2's AI Brain section (PRD §7.3). Serializes to a hidden `modelConfig` field; the
 * server validates it again, including that every provider belongs to the workspace.
 */
export function AiBrainEditor({
  connections,
  initial,
}: {
  connections: BrainConnectionOption[];
  initial: BrainValue | null;
}) {
  const t = useTranslations('brain');
  const [value, setValue] = useState<BrainValue>(initial ?? emptyValue());
  const update = (patch: Partial<BrainValue>) => setValue((current) => ({ ...current, ...patch }));

  if (connections.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Cpu />}
          title={t('noProviders')}
          description={t('noProvidersHint')}
          action={
            <Button variant="secondary" asChild>
              <Link href="/settings/providers">{t('goToProviders')}</Link>
            </Button>
          }
          className="py-6"
        />
      </Card>
    );
  }

  const primaryModel = connections
    .find((c) => c.id === value.primary.connectionId)
    ?.models.find((m) => m.id === value.primary.model);
  const sampling = primaryModel?.sampling ?? true;
  const routeFor = (category: string) =>
    value.routes.find((r) => r.category === category) ?? { category, connectionId: '', model: '' };
  const serialized = isSet(value.primary)
    ? JSON.stringify({
        ...value,
        routes: value.routes.filter(isSet),
        fallbacks: value.fallbacks.filter(isSet),
        ...(!sampling && { temperature: undefined }),
      })
    : '';
  const number = (raw: string) => (raw.trim() === '' ? undefined : Number(raw));

  return (
    <Card>
      <CardContent className="space-y-6 pt-5">
        <input type="hidden" name="modelConfig" value={serialized} />
        <div>
          <h2 className="font-semibold">{t('title')}</h2>
          <p className="text-sm text-text-muted">{t('description')}</p>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('strategy')}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {STRATEGIES.map((strategy) => (
              <label
                key={strategy}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary',
                  value.strategy === strategy
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface-2 hover:border-border-strong',
                )}
              >
                <input
                  type="radio"
                  name="strategy-choice"
                  checked={value.strategy === strategy}
                  onChange={() => update({ strategy })}
                  className="mt-0.5 accent-(--color-primary)"
                />
                <span>
                  <span className="block font-medium">{t(`strategies.${strategy}`)}</span>
                  <span className="block text-xs text-text-muted">
                    {t(`strategyHints.${strategy}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('primary')}</p>
          <TargetPicker
            id="primary"
            label={t('primary')}
            value={value.primary}
            onChange={(primary) => update({ primary })}
            connections={connections}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm font-medium">{t('temperature')}</span>
              <span className="text-sm text-text-muted tabular-nums">
                {sampling ? (value.temperature ?? 1).toFixed(1) : '—'}
              </span>
            </div>
            <Slider
              aria-label={t('temperature')}
              min={0}
              max={2}
              step={0.1}
              disabled={!sampling}
              value={[value.temperature ?? 1]}
              onValueChange={([temperature]) => update({ temperature })}
            />
            {!sampling && (
              <p className="mt-1 text-xs text-text-subtle">{t('temperatureUnsupported')}</p>
            )}
          </div>
          <Field label={t('maxOutput')} htmlFor="maxOutputTokens" hint={t('maxOutputHint')}>
            <Input
              id="maxOutputTokens"
              type="number"
              min={1}
              max={128000}
              value={value.maxOutputTokens ?? ''}
              onChange={(e) => update({ maxOutputTokens: number(e.target.value) })}
            />
          </Field>
        </div>

        {value.strategy === 'smart_router' && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{t('routes')}</p>
              <p className="text-xs text-text-muted">{t('routesHint')}</p>
            </div>
            {TASK_CATEGORY_KEYS.map((category) => (
              <div key={category} className="grid items-center gap-2 lg:grid-cols-[12rem_1fr]">
                <span className="text-sm text-text-muted">{t(`categories.${category}`)}</span>
                <TargetPicker
                  id={`route-${category}`}
                  label={t(`categories.${category}`)}
                  value={routeFor(category)}
                  allowDefault
                  connections={connections}
                  onChange={(target) =>
                    update({
                      routes: [
                        ...value.routes.filter((r) => r.category !== category),
                        ...(target.connectionId ? [{ category, ...target }] : []),
                      ],
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}

        {value.strategy !== 'fixed' && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{t('fallbacks')}</p>
              <p className="text-xs text-text-muted">{t('fallbacksHint')}</p>
            </div>
            <ol className="space-y-2">
              {value.fallbacks.map((fallback, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="mt-2 w-5 text-sm text-text-subtle tabular-nums">
                    {index + 1}.
                  </span>
                  <div className="flex-1">
                    <TargetPicker
                      id={`fallback-${index}`}
                      label={`${t('fallbacks')} ${index + 1}`}
                      value={fallback}
                      connections={connections}
                      onChange={(target) =>
                        update({
                          fallbacks: value.fallbacks.map((f, i) => (i === index ? target : f)),
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('remove')} ${index + 1}`}
                    onClick={() =>
                      update({ fallbacks: value.fallbacks.filter((_, i) => i !== index) })
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
            {value.fallbacks.length < 5 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  update({ fallbacks: [...value.fallbacks, { connectionId: '', model: '' }] })
                }
              >
                <Plus aria-hidden />
                {t('addFallback')}
              </Button>
            )}
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('budget')}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('perTaskUsd')} htmlFor="perTaskUsd">
              <Input
                id="perTaskUsd"
                type="number"
                min={0}
                step={0.01}
                value={value.budget.perTaskUsd ?? ''}
                onChange={(e) =>
                  update({ budget: { ...value.budget, perTaskUsd: number(e.target.value) } })
                }
              />
            </Field>
            <Field label={t('dailyUsd')} htmlFor="dailyUsd">
              <Input
                id="dailyUsd"
                type="number"
                min={0}
                step={0.01}
                value={value.budget.dailyUsd ?? ''}
                onChange={(e) =>
                  update({ budget: { ...value.budget, dailyUsd: number(e.target.value) } })
                }
              />
            </Field>
            <Field label={t('onExceed')} htmlFor="onExceed">
              <Select
                id="onExceed"
                value={value.budget.onExceed}
                onValueChange={(onExceed) =>
                  update({
                    budget: { ...value.budget, onExceed: onExceed as 'stop' | 'request_approval' },
                  })
                }
                options={(['stop', 'request_approval'] as const).map((v) => ({
                  value: v,
                  label: t(`onExceedOptions.${v}`),
                }))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('maxToolCalls')} htmlFor="maxToolCalls">
              <Input
                id="maxToolCalls"
                type="number"
                min={0}
                max={200}
                value={value.budget.maxToolCalls ?? ''}
                placeholder="10"
                onChange={(e) =>
                  update({ budget: { ...value.budget, maxToolCalls: number(e.target.value) } })
                }
              />
            </Field>
            <Field label={t('maxRuntimeSeconds')} htmlFor="maxRuntimeSeconds">
              <Input
                id="maxRuntimeSeconds"
                type="number"
                min={10}
                max={86400}
                value={value.budget.maxRuntimeSeconds ?? ''}
                placeholder="300"
                onChange={(e) =>
                  update({ budget: { ...value.budget, maxRuntimeSeconds: number(e.target.value) } })
                }
              />
            </Field>
          </div>
          <p className="text-xs text-text-muted">
            {t('budgetHint')} {t('limitsHint')}
          </p>
        </fieldset>
      </CardContent>
    </Card>
  );
}
