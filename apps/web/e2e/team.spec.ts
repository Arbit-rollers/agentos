import { expect, test, type Page } from '@playwright/test';
import {
  FAKE_PROVIDER,
  addProvider,
  connectMcp,
  createAgentDraft,
  nextButton,
  pickModel,
  registerUser,
  sendChat,
} from './helpers';

/** Wizard steps 2–5 for a draft from createAgentDraft, then Activate. */
async function finishAgent(page: Page, id: string, tools: string[] = []) {
  await pickModel(page, 'Primary model', 'Cloud', 'fake-echo');
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/tools$/);
  for (const tool of tools) await page.getByRole('checkbox', { name: tool }).check();
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/permissions$/);
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/review$/);
  await page.getByRole('button', { name: 'Create agent' }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
  await page.getByRole('button', { name: 'Agent settings' }).click();
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
}

const delegate = (agent: string, objective: string, details?: string) =>
  `[[call:delegate:${JSON.stringify({ agent, objective, ...(details && { details }) })}]]`;

test.describe('multi-agent orchestration (v0.4)', () => {
  test.beforeEach(async ({ page }) => {
    // Builds three agents through the wizard before the scenario starts.
    test.slow();
    await registerUser(page);
  });

  test('an orchestrator delegates to its team, one step waits for approval (AC 19)', async ({
    page,
  }) => {
    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Cloud',
      endpoint: `${FAKE_PROVIDER}/openai/v1`,
    });
    await connectMcp(page, { name: 'Workspace' });
    const boss = await createAgentDraft(page, {
      name: 'Orchestrator',
      type: 'master_orchestrator',
    });
    await finishAgent(page, boss);
    const researcher = await createAgentDraft(page, { name: 'Researcher', parent: 'Orchestrator' });
    await finishAgent(page, researcher, ['search_documents']);
    const mailer = await createAgentDraft(page, { name: 'Mailer', parent: 'Orchestrator' });
    await finishAgent(page, mailer, ['gmail_send']);

    await page.goto(`/agents/${boss}?settings=1`);
    await expect(page.getByTestId('team-hint')).toContainText('Mailer, Researcher');
    await page.goto(`/agents/${boss}`);
    await page.waitForLoadState('networkidle');
    await sendChat(
      page,
      `Make the reel ${delegate('Researcher', 'Research reels', '<<call:search:{"query":"reels"}>>')} ${delegate('Mailer', 'Send the draft', '<<call:gmail:{"to":"team@example.com","body":"Draft"}>>')}`,
    );
    // The mail needs a person; the orchestrator waits for its team.
    await expect(page.getByText(/^Waiting for .*Mailer/)).toBeVisible({ timeout: 20_000 });
    await page.goto('/approvals');
    await expect(async () => {
      await page.reload();
      await expect(page.getByText('team@example.com')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Approve once' }).click();
    await expect(page.getByText('Nothing waiting for approval.')).toBeVisible();

    await page.goto(`/agents/${boss}`);
    const answer = page.getByTestId('assistant-message').last();
    await expect(async () => {
      await page.reload();
      await expect(answer).toContainText('sent to team@example.com', { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(answer).toContainText('results for reels');

    // The task shows who did what.
    await page.goto('/tasks');
    const link = page.getByRole('link', { name: /^Make the reel/ });
    await page.goto((await link.getAttribute('href'))!);
    const tree = page.getByRole('list', { name: 'Delegation' });
    await expect(tree.locator('[data-delegated="Researcher"]')).toContainText('Completed');
    await expect(tree.locator('[data-delegated="Mailer"]')).toContainText('Completed');
    await tree.getByRole('link', { name: 'Send the draft' }).click();
    await expect(page.getByText('Delegated by Orchestrator')).toBeVisible();

    await page.goto(`/agents/${boss}?tab=logs`);
    await page.locator('details summary').first().click();
    await expect(page.locator('[data-event="delegation.started"]').first()).toContainText(
      'Delegated to',
    );
  });
});
