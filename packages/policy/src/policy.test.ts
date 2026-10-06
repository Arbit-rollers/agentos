import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPROVAL_POLICY,
  allowedModes,
  defaultPermissionFor,
  evaluateToolCall,
  riskCategoryOf,
  stricter,
  type ToolFacts,
} from './index';

const tool = (overrides: Partial<ToolFacts> = {}): ToolFacts => ({
  enabled: true,
  connectionEnabled: true,
  workspaceDefault: 'AUTO_ALLOW',
  riskCategory: null,
  ...overrides,
});
const noApprovals = { requireApprovalForHighRisk: false, categories: [] };

describe('evaluateToolCall (PRD §9)', () => {
  it('blocks tools the agent was never granted (connecting exposes nothing)', () => {
    expect(evaluateToolCall(tool(), undefined, noApprovals)).toEqual({
      decision: 'BLOCK',
      reason: 'not_granted',
    });
  });

  it('BLOCKED never runs; APPROVAL_REQUIRED pauses (AC 16, 17)', () => {
    expect(evaluateToolCall(tool(), 'BLOCKED', noApprovals).decision).toBe('BLOCK');
    expect(evaluateToolCall(tool(), 'APPROVAL_REQUIRED', noApprovals).decision).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(evaluateToolCall(tool(), 'AUTO_ALLOW', noApprovals).decision).toBe('ALLOW');
  });

  it('the workspace default caps the agent grant', () => {
    expect(
      evaluateToolCall(tool({ workspaceDefault: 'BLOCKED' }), 'AUTO_ALLOW', noApprovals).decision,
    ).toBe('BLOCK');
    expect(
      evaluateToolCall(tool({ workspaceDefault: 'APPROVAL_REQUIRED' }), 'AUTO_ALLOW', noApprovals)
        .decision,
    ).toBe('REQUIRE_APPROVAL');
  });

  it('disabled tools and connections are blocked even when granted', () => {
    expect(evaluateToolCall(tool({ enabled: false }), 'AUTO_ALLOW', noApprovals).reason).toBe(
      'tool_disabled',
    );
    expect(
      evaluateToolCall(tool({ connectionEnabled: false }), 'AUTO_ALLOW', noApprovals).reason,
    ).toBe('connection_disabled');
  });

  it('high-risk categories need approval when the agent policy says so', () => {
    const mail = tool({ riskCategory: 'send_email' });
    expect(evaluateToolCall(mail, 'AUTO_ALLOW', DEFAULT_APPROVAL_POLICY)).toEqual({
      decision: 'REQUIRE_APPROVAL',
      reason: 'high_risk_category',
    });
    expect(
      evaluateToolCall(mail, 'AUTO_ALLOW', {
        requireApprovalForHighRisk: true,
        categories: ['payments'],
      }).decision,
    ).toBe('ALLOW');
  });
});

describe('modes', () => {
  it('orders strictness and limits agent choices to the default or stricter', () => {
    expect(stricter('AUTO_ALLOW', 'BLOCKED')).toBe('BLOCKED');
    expect(allowedModes('APPROVAL_REQUIRED')).toEqual(['APPROVAL_REQUIRED', 'BLOCKED']);
    expect(allowedModes('AUTO_ALLOW')).toHaveLength(3);
  });
});

describe('classification', () => {
  it.each([
    ['gmail_search', 'AUTO_ALLOW'],
    ['drive_read', 'AUTO_ALLOW'],
    ['calendar_list', 'AUTO_ALLOW'],
    ['gmail_send', 'APPROVAL_REQUIRED'],
    ['calendar_create', 'APPROVAL_REQUIRED'],
    ['drive_delete', 'BLOCKED'],
    ['remove_member', 'BLOCKED'],
  ] as const)('%s → %s', (name, mode) => {
    expect(defaultPermissionFor(name)).toBe(mode);
  });

  it('prefers server annotations over names', () => {
    expect(defaultPermissionFor('archive_thread', { destructiveHint: true })).toBe('BLOCKED');
    expect(defaultPermissionFor('summarize', { readOnlyHint: true })).toBe('AUTO_ALLOW');
    expect(defaultPermissionFor('do_something')).toBe('APPROVAL_REQUIRED');
  });

  it.each([
    ['gmail_send', 'send_email'],
    ['instagram_publish', 'publish_social'],
    ['calendar_create', 'calendar_write'],
    ['drive_delete_file', 'delete_files'],
    ['create_payment', 'payments'],
    ['run_script', 'run_code'],
    ['gmail_search', null],
  ] as const)('%s → %s', (name, category) => {
    expect(riskCategoryOf(name)).toBe(category);
  });
});
