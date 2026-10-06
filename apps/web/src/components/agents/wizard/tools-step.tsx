'use client';

import { Plug, Search } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useMemo, useState } from 'react';
import { Button, Card, CardContent, EmptyState, Input, StatusBadge, cn } from '@agentos/ui';
import { saveToolsAction, type AgentFormState } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { ServerIcon } from '@/components/mcp/server-icon';
import { stepHref } from './steps';
import { WizardNav } from './wizard-nav';

export type ToolOption = { id: string; name: string; description: string };
export type ServerOption = {
  id: string;
  name: string;
  serverType: string;
  connected: boolean;
  tools: ToolOption[];
};

/** Wizard step 3 (PRD §19, Screen 5): pick servers on the left, tools on the right. */
export function ToolsStep({
  agentId,
  servers,
  initial,
}: {
  agentId: string;
  servers: ServerOption[];
  initial: string[];
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    saveToolsAction.bind(null, agentId),
    {},
  );
  const [selected, setSelected] = useState(new Set(initial));
  const [active, setActive] = useState(servers[0]?.id);
  const [query, setQuery] = useState('');

  const q = query.toLowerCase();
  const visibleServers = useMemo(
    () =>
      servers.filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.tools.some((tool) => tool.name.toLowerCase().includes(q)),
      ),
    [servers, q],
  );
  const server = servers.find((s) => s.id === active);
  const tools = (server?.tools ?? []).filter(
    (tool) => !q || tool.name.toLowerCase().includes(q) || server?.name.toLowerCase().includes(q),
  );
  const count = (s: ServerOption) => s.tools.filter((tool) => selected.has(tool.id)).length;
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (servers.length === 0) {
    return (
      <form action={action}>
        <Card>
          <EmptyState
            icon={<Plug />}
            title={t('toolsStep.noServers')}
            description={t('toolsStep.noServersHint')}
            action={
              <Button variant="secondary" asChild>
                <Link href="/mcp">{t('toolsStep.goToHub')}</Link>
              </Button>
            }
          />
        </Card>
        <WizardNav backHref={stepHref(agentId, 'personality')} pending={pending} />
      </form>
    );
  }

  return (
    <form action={action}>
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="toolIds" value={id} />
      ))}
      {state.error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {errorText(state.error)}
        </p>
      )}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div>
            <h2 className="font-semibold">{t('toolsStep.serversTitle')}</h2>
            <p className="text-sm text-text-muted">{t('toolsStep.serversHint')}</p>
          </div>
          <div className="relative max-w-md">
            <Search aria-hidden className="absolute top-2.5 left-3 size-4 text-text-subtle" />
            <Input
              aria-label={t('toolsStep.search')}
              placeholder={t('toolsStep.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('toolsStep.available')}</h3>
              <ul className="space-y-1.5">
                {visibleServers.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setActive(s.id)}
                      aria-pressed={active === s.id}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left',
                        active === s.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-surface-2 hover:border-border-strong',
                      )}
                    >
                      <ServerIcon serverType={s.serverType} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="block text-xs text-text-muted">
                          {t('mcp.tools', { count: s.tools.length })}
                        </span>
                      </span>
                      {count(s) > 0 && (
                        <StatusBadge tone="info" dot={false}>
                          {count(s)}
                        </StatusBadge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {server && (
              <fieldset className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <legend className="text-sm font-medium">
                    {t('toolsStep.toolsOf', { name: server.name })}
                  </legend>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-text-muted">
                      {t('toolsStep.selected', {
                        selected: count(server),
                        total: server.tools.length,
                      })}
                    </span>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-(--color-primary)"
                        checked={server.tools.length > 0 && count(server) === server.tools.length}
                        onChange={(e) =>
                          server.tools.forEach((tool) => toggle(tool.id, e.target.checked))
                        }
                      />
                      {t('toolsStep.selectAll')}
                    </label>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {tools.map((tool) => (
                    <li key={tool.id}>
                      <label className="flex cursor-pointer items-start gap-3 py-2">
                        <input
                          type="checkbox"
                          className="mt-1 accent-(--color-primary)"
                          checked={selected.has(tool.id)}
                          onChange={(e) => toggle(tool.id, e.target.checked)}
                          aria-label={tool.name}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-xs">{tool.name}</span>
                          <span className="block text-sm text-text-muted">{tool.description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </div>
          {selected.size === 0 && (
            <p className="text-sm text-text-muted">{t('toolsStep.noneSelected')}</p>
          )}
        </CardContent>
      </Card>
      <WizardNav backHref={stepHref(agentId, 'personality')} pending={pending} />
    </form>
  );
}
