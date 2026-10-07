import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listChildTasks, type Task, type TenantContext } from '@agentos/db';
import { StatusBadge } from '@agentos/ui';
import { getServices } from '@/server/services';
import { TASK_TONE } from './task-table';

type Node = Task & { agentName: string; children: Node[] };

/** Loads the tasks `taskId` delegated, recursively (delegation is at most three levels deep). */
export async function loadDelegationTree(
  ctx: TenantContext,
  taskId: string,
  depth = 0,
): Promise<Node[]> {
  if (depth >= 4) return [];
  const children = await listChildTasks(getServices().db, ctx, taskId);
  return Promise.all(
    children.map(async (child) => ({
      ...child,
      children: await loadDelegationTree(ctx, child.id, depth + 1),
    })),
  );
}

/** Delegation tree view (ROADMAP v0.4): who did which part, and how it ended. */
export async function DelegationTree({ nodes }: { nodes: Node[] }) {
  const t = await getTranslations();
  return (
    <ul className="space-y-2" aria-label={t('tasksPage.delegation')}>
      {nodes.map((node) => (
        <li key={node.id} data-delegated={node.agentName}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{node.agentName}</span>
            <StatusBadge tone={TASK_TONE[node.state]}>{t(`taskStates.${node.state}`)}</StatusBadge>
            <Link
              href={`/tasks/${node.id}`}
              className="min-w-0 truncate text-text-muted hover:text-primary"
            >
              {node.objective}
            </Link>
          </div>
          {node.output && (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{node.output}</p>
          )}
          {node.children.length > 0 && (
            <div className="mt-2 border-l border-border pl-4">
              <DelegationTree nodes={node.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
