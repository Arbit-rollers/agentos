// Shapes shared by the AI Brain server helper and client editor (plain module, no SDKs).
export type BrainModelOption = {
  id: string;
  label: string;
  sampling: boolean;
  local: boolean;
  price?: { input: number; output: number };
};

export type BrainConnectionOption = {
  id: string;
  name: string;
  provider: string;
  connected: boolean;
  models: BrainModelOption[];
};

export type BrainTarget = { connectionId: string; model: string };

export type BrainValue = {
  strategy: 'fixed' | 'smart_router' | 'fallback_chain';
  primary: BrainTarget;
  routes: (BrainTarget & { category: string })[];
  fallbacks: BrainTarget[];
  temperature?: number;
  maxOutputTokens?: number;
  budget: {
    dailyUsd?: number;
    perTaskUsd?: number;
    maxToolCalls?: number;
    maxRuntimeSeconds?: number;
    onExceed: 'stop' | 'request_approval';
  };
};

export const TASK_CATEGORY_KEYS = [
  'general',
  'research',
  'reasoning',
  'fast',
  'private',
  'vision',
] as const;
