// Plain module: server pages read these too, so they can't live in the 'use client' file.
export const AGENT_FILTERS = [
  'all',
  'active',
  'configured',
  'draft',
  'paused',
  'archived',
] as const;
export type AgentFilter = (typeof AGENT_FILTERS)[number];
