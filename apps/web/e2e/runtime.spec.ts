import { expect, test } from '@playwright/test';
import { registerUser, sendChat, setupWorkingAgent } from './helpers';

test.describe('runtime, chat and approvals (M6)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('the v0.1 flow: chat, tool call, approval in the inbox, logs (AC 17, 18, 23)', async ({
    page,
  }) => {
    const id = await setupWorkingAgent(page);

    // An allowed tool runs straight away.
    await sendChat(page, 'Find topics [[call:search:{"query":"aviation"}]]');
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'results for aviation',
    );
    await expect(page.getByText('search_documents · done')).toBeVisible();

    // A send-email call waits for a person.
    await sendChat(page, 'Email it [[call:gmail_send:{"to":"team@example.com","body":"Script"}]]');
    const card = page.getByRole('article', { name: 'Approval needed' });
    await expect(card).toBeVisible();
    await expect(page.getByText('gmail_send · needs approval')).toBeVisible();
    await expect(page.getByText(/sent to team@example.com/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Approvals/ })).toContainText('1');

    await page.goto('/approvals');
    await expect(page.getByText('team@example.com')).toBeVisible();
    await page.getByRole('button', { name: 'Approve once' }).click();
    await expect(page.getByText('Nothing waiting for approval.')).toBeVisible();

    await page.goto(`/agents/${id}`);
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'sent to team@example.com',
      { timeout: 15_000 },
    );

    await page.goto('/logs');
    await page.locator('details summary').first().click();
    await expect(page.locator('[data-event="approval.decided"]').first()).toContainText(
      'Decision: Approved',
    );
    await expect(page.locator('[data-event="tool.result"]').first()).toContainText(
      'gmail_send returned a result',
    );
    await expect(page.getByText(/in · .* out/).first()).toBeVisible();

    await page.goto('/tasks');
    await expect(page.getByRole('cell', { name: /Email it/ })).toBeVisible();
    await expect(page.getByText('Completed').first()).toBeVisible();
  });

  test('edit & approve from the chat, and reject', async ({ page }) => {
    const id = await setupWorkingAgent(page);
    await sendChat(page, 'Email [[call:gmail_send:{"to":"a@example.com","body":"x"}]]');
    const card = page.getByRole('article', { name: 'Approval needed' });
    await card.getByRole('button', { name: 'Edit & approve' }).click();
    await card.getByLabel('Parameters').fill('{"to":"boss@example.com","body":"x"}');
    await card.getByRole('button', { name: 'Approve with changes' }).click();
    // The decision is saved once the card leaves the chat.
    await expect(card).toHaveCount(0);
    await page.goto(`/agents/${id}`);
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'sent to boss@example.com',
      { timeout: 15_000 },
    );

    await sendChat(page, 'Email [[call:gmail_send:{"to":"c@example.com","body":"y"}]]');
    const rejectCard = page.getByRole('article', { name: 'Approval needed' });
    await rejectCard.getByRole('button', { name: 'Reject' }).click();
    await expect(rejectCard).toHaveCount(0);
    await page.goto(`/agents/${id}`);
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'rejected this action',
      { timeout: 15_000 },
    );
    await expect(page.getByText('gmail_send · rejected')).toBeVisible();
  });

  test('workspace tabs and settings drawer (PRD §20)', async ({ page }) => {
    const id = await setupWorkingAgent(page, 'Tabs Agent');
    const tabs = page.getByRole('navigation', { name: 'Agent workspace' });
    for (const tab of ['Chat', 'Tasks', 'Tools', 'Files', 'Memory', 'Logs']) {
      await expect(tabs.getByRole('link', { name: new RegExp(`^${tab}`) })).toBeVisible();
    }
    await tabs.getByRole('link', { name: /^Tools/ }).click();
    await expect(page.getByText('Approval required')).toBeVisible();
    await tabs.getByRole('link', { name: /^Memory/ }).click();
    await expect(page.getByText('No memories yet.')).toBeVisible();
    await tabs.getByRole('link', { name: /^Files/ }).click();
    await expect(page.getByText('No files attached to this agent yet.')).toBeVisible();
    await page.goto(`/agents/${id}`);
    await page.getByRole('button', { name: 'Agent settings' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Agent settings' }).getByText('Runtime directives'),
    ).toBeVisible();
  });
});
