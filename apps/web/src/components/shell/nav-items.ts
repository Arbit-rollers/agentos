import {
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  LayoutDashboard,
  ListChecks,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type NavKey =
  | 'dashboard'
  | 'agents'
  | 'mcpHub'
  | 'tasks'
  | 'workflows'
  | 'knowledge'
  | 'memory'
  | 'approvals'
  | 'schedules'
  | 'logs'
  | 'analytics'
  | 'settings';

/** Primary navigation, in PRD §3 order. */
export const NAV_ITEMS: { key: NavKey; href: string; icon: LucideIcon }[] = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'agents', href: '/agents', icon: Bot },
  { key: 'mcpHub', href: '/mcp', icon: Plug },
  { key: 'tasks', href: '/tasks', icon: ListChecks },
  { key: 'workflows', href: '/workflows', icon: Workflow },
  { key: 'knowledge', href: '/knowledge', icon: BookOpen },
  { key: 'memory', href: '/memory', icon: Brain },
  { key: 'approvals', href: '/approvals', icon: ShieldCheck },
  { key: 'schedules', href: '/schedules', icon: CalendarClock },
  { key: 'logs', href: '/logs', icon: ScrollText },
  { key: 'analytics', href: '/analytics', icon: BarChart3 },
  { key: 'settings', href: '/settings', icon: Settings },
];

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);
