import { expect, test } from '@playwright/test';
import { createAgentDraft, nextButton, nextLink, registerUser } from './helpers';

test.describe('agents (M3)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('create an agent through the five-step wizard (AC 3)', async ({ page }) => {
    const id = await createAgentDraft(page, {
      name: 'Fact Checker',
      role: 'Aviation Fact Checker',
      job: 'Verify every claim against authoritative sources.',
    });

    // Step 2: picking a preset updates the live preview from the real compiler.
    await page.getByRole('button', { name: 'Skeptical Reviewer' }).click();
    await expect(page.getByRole('button', { name: 'Skeptical Reviewer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('Verifies claims before relying on them')).toBeVisible();
    await nextButton(page).click();

    // Steps 3–4 are placeholders until M5.
    await expect(page.getByText(/choose this agent's tools here in M5/)).toBeVisible();
    await nextLink(page).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}/setup/permissions$`));
    await nextLink(page).click();

    await expect(page).toHaveURL(new RegExp(`/agents/${id}/setup/review$`));
    await expect(page.getByText('Aviation Fact Checker')).toBeVisible();
    await page.getByRole('button', { name: 'Create agent' }).click();

    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Fact Checker' })).toBeVisible();
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
    await expect(page.getByText('Skeptical Reviewer · Version 2')).toBeVisible();
    // Activation needs an AI model (M4).
    await expect(page.getByRole('button', { name: 'Activate' })).toBeDisabled();

    await page.goto('/agents');
    await expect(page.getByRole('link', { name: /Fact Checker/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Configured\s*\(1\)/ })).toBeVisible();
  });

  test('step 1 validation reports every missing field', async ({ page }) => {
    await page.goto('/agents/new');
    await page.waitForLoadState('networkidle');
    await nextButton(page).click();
    await expect(page.getByText('Enter a name for the agent.')).toBeVisible();
    await expect(page.getByText('Describe what this agent is for.')).toBeVisible();
    await expect(page).toHaveURL(/\/agents\/new$/);
  });

  test('cannot create without role and job; can save as draft', async ({ page }) => {
    const id = await createAgentDraft(page, { name: 'Unfinished', role: '', job: '' });
    await page.goto(`/agents/${id}/setup/review`);
    await expect(page.getByText("Enter the agent's role.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create agent' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  });

  test('reporting hierarchy: specialists report to managers (PRD §5.1)', async ({ page }) => {
    await createAgentDraft(page, { name: 'Content Director', type: 'manager' });
    const id = await createAgentDraft(page, { name: 'Script Writer', parent: 'Content Director' });
    await page.goto(`/agents/${id}`);
    await expect(page.getByRole('link', { name: 'Content Director' })).toBeVisible();

    await page.getByRole('link', { name: 'Content Director' }).click();
    await expect(page.getByRole('link', { name: /Script Writer/ })).toBeVisible();
  });

  test('archive and restore', async ({ page }) => {
    const id = await createAgentDraft(page, { name: 'Temp' });
    await page.goto(`/agents/${id}`);
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('This agent is archived.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Configured', { exact: true })).toBeVisible();
  });
});

test('another user gets 404 for an agent by id (AC 2)', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await registerUser(alice);
  await registerUser(bob);
  const id = await createAgentDraft(bob, { name: 'Bob Secret Agent' });

  for (const path of [`/agents/${id}`, `/agents/${id}/setup/basic`, `/agents/${id}/setup/review`]) {
    const response = await alice.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  await alice.goto('/agents');
  await expect(alice.getByText('Bob Secret Agent')).toHaveCount(0);
});
