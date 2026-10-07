'use client';

import { Check, ChevronsUpDown, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@agentos/ui';
import { switchWorkspaceAction } from '@/app/(app)/settings/members/switch';
import type { ShellWorkspace } from './top-bar';

/** Top bar: the current workspace, and the others this person belongs to. */
export function WorkspaceSwitcher({ workspaces }: { workspaces: ShellWorkspace[] }) {
  const t = useTranslations('team');
  const [pending, start] = useTransition();
  const current = workspaces.find((w) => w.current);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={t('switcher')}
          className="max-w-48"
        >
          <span className="truncate">{current?.name ?? '—'}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 opacity-60" />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel className="text-xs text-text-muted">{t('workspaces')}</MenuLabel>
        {workspaces.map((workspace) => (
          <MenuItem
            key={workspace.id}
            onSelect={() => !workspace.current && start(() => switchWorkspaceAction(workspace.id))}
          >
            {workspace.current ? <Check /> : <span className="size-4" />}
            {workspace.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/settings/members">
            <UserPlus />
            {t('inviteMembers')}
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
