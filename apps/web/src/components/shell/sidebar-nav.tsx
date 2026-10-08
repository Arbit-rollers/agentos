'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@agentos/ui';
import { NAV_ITEMS, isActive, type NavKey } from './nav-items';

export function SidebarNav({
  onNavigate,
  badges = {},
}: {
  onNavigate?: () => void;
  badges?: Partial<Record<NavKey, number>>;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const approvals = usePendingApprovals(badges.approvals ?? 0, pathname);
  return (
    <nav aria-label={t('label')} className="flex flex-col gap-0.5 p-3">
      {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary text-primary-fg'
                : 'text-text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{t(key)}</span>
            {key === 'approvals' ? (
              <CountBadge count={approvals} />
            ) : (
              <CountBadge count={badges[key] ?? 0} />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Logo() {
  return (
    <Link
      href="/dashboard"
      className="flex h-14 items-center px-6 text-lg font-semibold tracking-tight"
    >
      AgentOS
    </Link>
  );
}

/** A yellow circle with the count; nothing when zero. */
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1 text-[11px] leading-none font-semibold text-bg tabular-nums"
      aria-label={`(${count})`}
      data-testid="approvals-badge"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * Pending approvals keep arriving while you work (agents and workflows ask for them), but the
 * sidebar isn't re-rendered on navigation. One shared poller per page (the sidebar exists
 * twice: desktop and the mobile drawer) re-checks every 10 s, when the tab regains focus,
 * and on page changes.
 */
const approvalsStore = (() => {
  let count: number | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  const listeners = new Set<() => void>();
  const check = async () => {
    if (inFlight || document.visibilityState !== 'visible') return;
    inFlight = true;
    try {
      const response = await fetch('/api/approvals/count', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        count = ((await response.json()) as { pending: number }).pending;
        listeners.forEach((listener) => listener());
      }
    } catch {
      // Offline, slow or signed out: keep the last count.
    } finally {
      inFlight = false;
    }
  };
  return {
    check,
    get: () => count,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        timer = setInterval(check, 10_000);
        document.addEventListener('visibilitychange', check);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', check);
        }
      };
    },
  };
})();

function usePendingApprovals(initial: number, pathname: string) {
  const live = useSyncExternalStore(approvalsStore.subscribe, approvalsStore.get, () => null);
  useEffect(() => {
    void approvalsStore.check();
  }, [pathname]);
  return live ?? initial;
}
