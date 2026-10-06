'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useMemo, useState } from 'react';
import {
  PRESETS,
  PRESET_TRAITS,
  TRAITS,
  compilePersonality,
  detectPreset,
  type TraitScores,
} from '@agentos/personality';
import { Card, CardContent, Slider, cn } from '@agentos/ui';
import { savePersonalityAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { AiBrainEditor } from '../ai-brain-editor';
import type { BrainConnectionOption, BrainValue } from '../brain-types';
import { stepHref } from './steps';
import { WizardNav } from './wizard-nav';

/**
 * Wizard step 2 (PRD §6, §19). The preview runs the same compiler the runtime uses, so what
 * the user sees is exactly what the model will be told.
 */
export function PersonalityEditor({
  agentId,
  initial,
  connections,
  brain,
}: {
  agentId: string;
  initial: TraitScores;
  connections: BrainConnectionOption[];
  brain: BrainValue | null;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    savePersonalityAction.bind(null, agentId),
    {},
  );
  const [traits, setTraits] = useState(initial);
  const preset = detectPreset(traits);
  const compiled = useMemo(() => compilePersonality(traits), [traits]);
  const p = compiled.parameters;

  return (
    <form action={action}>
      <input type="hidden" name="traits" value={JSON.stringify(traits)} />
      {(state.error || state.fieldErrors) && (
        <div role="alert" className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {state.error && <p>{errorText(state.error)}</p>}
          {Object.values(state.fieldErrors ?? {})
            .flat()
            .filter((code): code is string => Boolean(code))
            .map((code) => (
              <p key={code}>{errorText(code)}</p>
            ))}
        </div>
      )}

      <div className="mb-6">
        <AiBrainEditor connections={connections} initial={brain} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardContent className="space-y-6 pt-5">
            <div>
              <h2 className="font-semibold">{t('wizard.personalityTitle')}</h2>
              <p className="text-sm text-text-muted">{t('wizard.personalityDescription')}</p>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('wizard.preset')}</legend>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={preset === name}
                    disabled={name === 'custom'}
                    onClick={() => setTraits({ ...PRESET_TRAITS[name] })}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                      preset === name
                        ? 'border-primary bg-primary/15 text-text'
                        : 'border-border bg-surface-2 text-text-muted hover:text-text',
                      name === 'custom' && preset !== 'custom' && 'hidden',
                    )}
                  >
                    {t(`presets.${name}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {TRAITS.map((trait) => (
                <div key={trait}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{t(`traits.${trait}.name`)}</span>
                    <span className="text-sm text-text-muted tabular-nums">{traits[trait]}</span>
                  </div>
                  <Slider
                    aria-label={t(`traits.${trait}.name`)}
                    min={0}
                    max={100}
                    step={5}
                    value={[traits[trait]]}
                    onValueChange={([value]) =>
                      setTraits((current) => ({ ...current, [trait]: value ?? current[trait] }))
                    }
                  />
                  <p className="mt-1 text-xs text-text-subtle">{t(`traits.${trait}.hint`)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="self-start lg:sticky lg:top-20">
          <CardContent className="space-y-4 pt-5">
            <div>
              <h2 className="font-semibold">{t('wizard.behaviorPreview')}</h2>
              <p className="text-sm text-text-muted">{t('wizard.previewHint')}</p>
            </div>
            {compiled.directives.length === 0 ? (
              <p className="text-sm text-text-muted">{t('wizard.noDirectives')}</p>
            ) : (
              <ul className="space-y-2 text-sm" aria-live="polite">
                {compiled.directives.map((directive) => (
                  <li key={directive.id} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {t(`directives.${directive.id}`)}
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-muted uppercase">
                {t('wizard.parameters')}
              </h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
                {(
                  [
                    ['verification', t(`wizard.levels.${p.verification}`)],
                    ['escalation', t(`wizard.levels.${p.escalation}`)],
                    ['autonomy', t(`wizard.levels.${p.autonomy}`)],
                    ['responseLength', t(`wizard.lengths.${p.responseLength}`)],
                    ['alternatives', String(p.alternatives)],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-text-muted">{t(`wizard.parameterNames.${key}`)}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </CardContent>
        </Card>
      </div>

      <WizardNav backHref={stepHref(agentId, 'basic')} pending={pending} />
    </form>
  );
}
