'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  RISK_CATEGORIES,
  allowedModes,
  type PermissionMode,
  type RiskCategory,
} from '@agentos/policy';
import { Card, CardContent, FilterTabs, Select, Switch, cn } from '@agentos/ui';
import { savePermissionsAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { stepHref } from './steps';
import { WizardNav } from './wizard-nav';

export type GrantRow = {
  toolId: string;
  name: string;
  description: string;
  serverName: string;
  mode: PermissionMode;
  workspaceDefault: PermissionMode;
};

type Filter = 'all' | PermissionMode;

const TONE: Record<PermissionMode, string> = {
  AUTO_ALLOW: 'text-success',
  APPROVAL_REQUIRED: 'text-warning',
  BLOCKED: 'text-danger',
};

/** Wizard step 4 (PRD §9, §10, Screen 6). */
export function PermissionsStep({
  agentId,
  grants,
  approvalPolicy,
}: {
  agentId: string;
  grants: GrantRow[];
  approvalPolicy: { requireApprovalForHighRisk: boolean; categories: string[] };
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    savePermissionsAction.bind(null, agentId),
    {},
  );
  const [modes, setModes] = useState(
    Object.fromEntries(grants.map((g) => [g.toolId, g.mode])) as Record<string, PermissionMode>,
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [requireApproval, setRequireApproval] = useState(approvalPolicy.requireApprovalForHighRisk);
  const [categories, setCategories] = useState(new Set(approvalPolicy.categories));

  const count = (mode: PermissionMode) => grants.filter((g) => modes[g.toolId] === mode).length;
  const shown = grants.filter((g) => filter === 'all' || modes[g.toolId] === filter);
  const errors = [state.error, ...Object.values(state.fieldErrors ?? {}).flat()].filter(
    (c): c is string => Boolean(c),
  );

  return (
    <form action={action}>
      {Object.entries(modes).map(([toolId, mode]) => (
        <input key={toolId} type="hidden" name={`mode:${toolId}`} value={mode} />
      ))}
      {[...categories].map((c) => (
        <input key={c} type="hidden" name="categories" value={c} />
      ))}
      {requireApproval && <input type="hidden" name="requireApprovalForHighRisk" value="on" />}
      {errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errors.map((code) => (
            <p key={code}>{errorText(code)}</p>
          ))}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <h2 className="font-semibold">{t('permissionsStep.title')}</h2>
              <p className="text-sm text-text-muted">{t('permissionsStep.hint')}</p>
            </div>
            {grants.length === 0 ? (
              <p className="text-sm text-text-muted">{t('permissionsStep.noTools')}</p>
            ) : (
              <>
                <FilterTabs
                  label={t('permissionsStep.filtersLabel')}
                  value={filter}
                  onValueChange={setFilter}
                  tabs={[
                    { value: 'all', label: t('permissionsStep.filters.all'), count: grants.length },
                    ...(['AUTO_ALLOW', 'APPROVAL_REQUIRED', 'BLOCKED'] as const).map((mode) => ({
                      value: mode,
                      label: t(`permissionsStep.filters.${mode}`),
                      count: count(mode),
                    })),
                  ]}
                />
                <ul className="divide-y divide-border">
                  {shown.map((grant) => (
                    <li key={grant.toolId} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs">{grant.name}</p>
                        <p className="truncate text-sm text-text-muted">
                          {grant.serverName} · {grant.description}
                        </p>
                      </div>
                      <div className="w-52">
                        <Select
                          aria-label={`${t('mcp.detail.permission')}: ${grant.name}`}
                          value={modes[grant.toolId]}
                          className={TONE[modes[grant.toolId]!]}
                          onValueChange={(value) =>
                            setModes((m) => ({ ...m, [grant.toolId]: value as PermissionMode }))
                          }
                          options={allowedModes(grant.workspaceDefault).map((mode) => ({
                            value: mode,
                            label: t(`permissions.${mode}`),
                          }))}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardContent className="space-y-4 pt-5">
            <h2 className="font-semibold">{t('permissionsStep.approvalTitle')}</h2>
            <label className="flex items-start gap-3">
              <Switch
                checked={requireApproval}
                onCheckedChange={setRequireApproval}
                aria-describedby="approval-hint"
              />
              <span>
                <span className="block text-sm font-medium">
                  {t('permissionsStep.approvalToggle')}
                </span>
                <span id="approval-hint" className="block text-xs text-text-muted">
                  {t('permissionsStep.approvalHint')}
                </span>
              </span>
            </label>
            <fieldset disabled={!requireApproval} className={cn(!requireApproval && 'opacity-50')}>
              <legend className="mb-2 text-sm font-medium">{t('permissionsStep.highRisk')}</legend>
              <ul className="space-y-2">
                {RISK_CATEGORIES.map((category: RiskCategory) => (
                  <li key={category}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-(--color-primary)"
                        checked={categories.has(category)}
                        onChange={(e) =>
                          setCategories((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(category);
                            else next.delete(category);
                            return next;
                          })
                        }
                      />
                      {t(`riskCategories.${category}`)}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </CardContent>
        </Card>
      </div>
      <WizardNav backHref={stepHref(agentId, 'tools')} pending={pending} />
    </form>
  );
}
