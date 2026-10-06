'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { PERMISSION_MODES, type PermissionMode } from '@agentos/policy';
import {
  Button,
  Input,
  Select,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  cn,
} from '@agentos/ui';
import { testMcpAction, updateToolDefaultAction } from '@/app/(app)/mcp/actions';

export type ToolRow = {
  id: string;
  name: string;
  description: string;
  defaultPermission: PermissionMode;
  enabled: boolean;
  available: boolean;
};

const TONE: Record<PermissionMode, string> = {
  AUTO_ALLOW: 'text-success',
  APPROVAL_REQUIRED: 'text-warning',
  BLOCKED: 'text-danger',
};

/** Connection detail → Tools (Screen 3): workspace defaults per tool. */
export function ToolsTable({ connectionId, tools }: { connectionId: string; tools: ToolRow[] }) {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [pending, start] = useTransition();
  const shown = tools.filter((tool) =>
    `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="absolute top-2.5 left-3 size-4 text-text-subtle" />
          <Input
            aria-label={t('mcp.detail.searchTools')}
            placeholder={t('mcp.detail.searchTools')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => void (await testMcpAction(connectionId)))}
        >
          <RefreshCw aria-hidden className={cn(pending && 'animate-spin')} />
          {pending ? t('mcp.detail.refreshing') : t('mcp.detail.refreshTools')}
        </Button>
      </div>
      <p className="text-xs text-text-muted">{t('mcp.detail.defaultsHint')}</p>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>{t('mcp.detail.toolName')}</TableHeaderCell>
            <TableHeaderCell>{t('mcp.detail.description')}</TableHeaderCell>
            <TableHeaderCell>{t('mcp.detail.permission')}</TableHeaderCell>
            <TableHeaderCell className="text-right">{t('mcp.detail.enabled')}</TableHeaderCell>
          </tr>
        </TableHead>
        <tbody>
          {shown.map((tool) => (
            <TableRow key={tool.id} className={cn(!tool.available && 'opacity-50')}>
              <TableCell className="font-mono text-xs">
                {tool.name}
                {!tool.available && (
                  <p className="font-sans text-text-subtle">{t('mcp.detail.unavailable')}</p>
                )}
              </TableCell>
              <TableCell className="text-text-muted">{tool.description}</TableCell>
              <TableCell className="w-52">
                <Select
                  aria-label={`${t('mcp.detail.permission')}: ${tool.name}`}
                  value={tool.defaultPermission}
                  className={TONE[tool.defaultPermission]}
                  onValueChange={(value) =>
                    start(async () => {
                      await updateToolDefaultAction(connectionId, tool.id, {
                        defaultPermission: value as PermissionMode,
                      });
                    })
                  }
                  options={PERMISSION_MODES.map((mode) => ({
                    value: mode,
                    label: t(`permissions.${mode}`),
                  }))}
                />
              </TableCell>
              <TableCell className="text-right">
                <Switch
                  aria-label={`${t('mcp.detail.enabled')}: ${tool.name}`}
                  checked={tool.enabled}
                  onCheckedChange={(enabled) =>
                    start(async () => {
                      await updateToolDefaultAction(connectionId, tool.id, { enabled });
                    })
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
