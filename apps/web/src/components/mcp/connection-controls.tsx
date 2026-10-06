'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button, Switch } from '@agentos/ui';
import { reauthorizeMcpAction, setMcpEnabledAction } from '@/app/(app)/mcp/actions';
import { useErrorText } from '@/components/error-text';

export function ReauthorizeButton({ id }: { id: string }) {
  const t = useTranslations('mcp.detail');
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (url) window.location.assign(url);
  }, [url]);
  return (
    <div className="space-y-1">
      <Button
        disabled={pending || Boolean(url)}
        onClick={() =>
          start(async () => {
            const result = await reauthorizeMcpAction(id);
            setError(result.error ?? result.fieldErrors?.endpoint?.[0]);
            setUrl(result.authorizationUrl);
          })
        }
      >
        {t('reauthorize')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

export function EnabledSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const t = useTranslations('mcp.detail');
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-3">
      <Switch
        checked={enabled}
        disabled={pending}
        onCheckedChange={(next) => start(async () => void (await setMcpEnabledAction(id, next)))}
        aria-describedby="enabled-hint"
      />
      <span>
        <span className="block text-sm font-medium">{t('settingsEnabled')}</span>
        <span id="enabled-hint" className="block text-xs text-text-muted">
          {t('settingsEnabledHint')}
        </span>
      </span>
    </label>
  );
}
