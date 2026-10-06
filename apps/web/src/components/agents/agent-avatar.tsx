import {
  Bot,
  Brain,
  ChartLine,
  Code,
  Compass,
  Megaphone,
  PenTool,
  Plane,
  Search,
  Shield,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@agentos/ui';

/** Built-in avatar gallery (stored as `preset:<key>`). Uploaded images come later. */
export const AVATAR_PRESETS: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  bot: { icon: Bot, from: '#3b5bff', to: '#7c3aed' },
  sparkles: { icon: Sparkles, from: '#d946ef', to: '#f97316' },
  search: { icon: Search, from: '#0ea5e9', to: '#22c55e' },
  pen: { icon: PenTool, from: '#f59e0b', to: '#ef4444' },
  code: { icon: Code, from: '#14b8a6', to: '#3b82f6' },
  plane: { icon: Plane, from: '#38bdf8', to: '#3b5bff' },
  video: { icon: Video, from: '#ef4444', to: '#a855f7' },
  chart: { icon: ChartLine, from: '#22c55e', to: '#0ea5e9' },
  brain: { icon: Brain, from: '#ec4899', to: '#8b5cf6' },
  shield: { icon: Shield, from: '#64748b', to: '#3b5bff' },
  megaphone: { icon: Megaphone, from: '#f97316', to: '#eab308' },
  compass: { icon: Compass, from: '#10b981', to: '#14b8a6' },
};

export const AVATAR_KEYS = Object.keys(AVATAR_PRESETS);

const SIZES = {
  sm: 'size-8 [&_svg]:size-4',
  md: 'size-11 [&_svg]:size-5',
  lg: 'size-16 [&_svg]:size-7',
  xl: 'size-24 [&_svg]:size-10',
};

export function AgentAvatar({
  avatar,
  size = 'md',
  className,
}: {
  avatar: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const preset = AVATAR_PRESETS[avatar.replace(/^preset:/, '')] ?? AVATAR_PRESETS.bot!;
  const Icon = preset.icon;
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-white',
        SIZES[size],
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
    >
      <Icon />
    </span>
  );
}
