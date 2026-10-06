// Permission and approval rules for tool calls (PRD §9, §10, §21). Pure functions: the
// gateway and the UI share them, and nothing here trusts prompts or tool output.

export const PERMISSION_MODES = ['AUTO_ALLOW', 'APPROVAL_REQUIRED', 'BLOCKED'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

const STRICTNESS: Record<PermissionMode, number> = {
  AUTO_ALLOW: 0,
  APPROVAL_REQUIRED: 1,
  BLOCKED: 2,
};

export const stricter = (a: PermissionMode, b: PermissionMode): PermissionMode =>
  STRICTNESS[a] >= STRICTNESS[b] ? a : b;

/** Modes an agent may choose for a tool: the workspace default or anything stricter. */
export const allowedModes = (workspaceDefault: PermissionMode): PermissionMode[] =>
  PERMISSION_MODES.filter((mode) => STRICTNESS[mode] >= STRICTNESS[workspaceDefault]);

/** High-risk action categories that can require approval (PRD §10 default candidates). */
export const RISK_CATEGORIES = [
  'send_email',
  'calendar_write',
  'publish_social',
  'payments',
  'delete_files',
  'run_code',
  'change_permissions',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export type ApprovalPolicy = {
  /** Master switch: high-risk tools in `categories` always need approval. */
  requireApprovalForHighRisk: boolean;
  categories: RiskCategory[];
};

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requireApprovalForHighRisk: true,
  categories: [...RISK_CATEGORIES],
};

export type Decision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export type DecisionReason =
  | 'not_granted'
  | 'tool_disabled'
  | 'connection_disabled'
  | 'blocked'
  | 'approval_required'
  | 'high_risk_category'
  | 'allowed';

export type ToolFacts = {
  enabled: boolean;
  connectionEnabled: boolean;
  workspaceDefault: PermissionMode;
  riskCategory: RiskCategory | null;
};

/**
 * Decides whether an agent may run a tool (PRD §9). Order matters: anything that blocks wins,
 * then anything that needs approval; only then is the call allowed. A tool the agent was
 * never granted is blocked, so connecting a server exposes nothing by itself.
 */
export function evaluateToolCall(
  tool: ToolFacts,
  agentGrant: PermissionMode | undefined,
  approvalPolicy: ApprovalPolicy,
): { decision: Decision; reason: DecisionReason } {
  if (!tool.connectionEnabled) return { decision: 'BLOCK', reason: 'connection_disabled' };
  if (!tool.enabled) return { decision: 'BLOCK', reason: 'tool_disabled' };
  if (!agentGrant) return { decision: 'BLOCK', reason: 'not_granted' };

  const mode = stricter(agentGrant, tool.workspaceDefault);
  if (mode === 'BLOCKED') return { decision: 'BLOCK', reason: 'blocked' };
  if (mode === 'APPROVAL_REQUIRED')
    return { decision: 'REQUIRE_APPROVAL', reason: 'approval_required' };
  if (
    approvalPolicy.requireApprovalForHighRisk &&
    tool.riskCategory &&
    approvalPolicy.categories.includes(tool.riskCategory)
  ) {
    return { decision: 'REQUIRE_APPROVAL', reason: 'high_risk_category' };
  }
  return { decision: 'ALLOW', reason: 'allowed' };
}

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

const DESTRUCTIVE =
  /(^|[_\-.\s])(delete|remove|destroy|drop|purge|erase|wipe|revoke|transfer)([_\-.\s]|$)/i;
const READ_ONLY =
  /(^|[_\-.\s])(search|read|list|get|fetch|find|query|lookup|view|describe|count|status)([_\-.\s]|$)/i;
const CATEGORY_PATTERNS: [RiskCategory, RegExp][] = [
  ['payments', /(pay|payment|charge|invoice|refund|transfer|purchase|checkout)/i],
  [
    'send_email',
    /(send|reply|forward)[_\-.\s]?(e?mail|message)|(gmail|mail|email)[_\-.\s]?(send|reply|forward)/i,
  ],
  [
    'publish_social',
    /(publish|post|tweet|share|upload)|(instagram|youtube|tiktok|twitter|linkedin)/i,
  ],
  [
    'calendar_write',
    /(calendar|event|meeting)[_\-.\s]?(create|update|delete|cancel)|(create|update|schedule)[_\-.\s]?(calendar|event|meeting)/i,
  ],
  [
    'delete_files',
    /(delete|remove|trash|erase)[_\-.\s]?(file|document|doc|folder|page|record)|(drive|file|document)[_\-.\s]?(delete|remove)/i,
  ],
  ['run_code', /(exec|execute|run|eval|shell|bash|command|script|deploy)/i],
  [
    'change_permissions',
    /(permission|share|invite|grant|role|access)[_\-.\s]?(add|update|set|change|grant)?/i,
  ],
];

/** Best-effort risk category from the tool's name and description. */
export function riskCategoryOf(name: string, description = ''): RiskCategory | null {
  const text = `${name} ${description}`;
  if (READ_ONLY.test(name) && !DESTRUCTIVE.test(name)) return null;
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/**
 * Default workspace permission for a newly discovered tool (PRD §19 step 4 defaults):
 * read-only → Auto allow, destructive → Blocked, everything else → Approval required.
 * The server's own annotations win over name heuristics when present; unknown tools are
 * never auto-allowed.
 */
export function defaultPermissionFor(
  name: string,
  annotations: ToolAnnotations = {},
): PermissionMode {
  if (annotations.destructiveHint === true || DESTRUCTIVE.test(name)) return 'BLOCKED';
  if (annotations.readOnlyHint === true) return 'AUTO_ALLOW';
  if (READ_ONLY.test(name)) return 'AUTO_ALLOW';
  return 'APPROVAL_REQUIRED';
}
