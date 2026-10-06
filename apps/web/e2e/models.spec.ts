import { expect, test } from '@playwright/test';
import {
  FAKE_PROVIDER,
  addProvider,
  createAgentDraft,
  nextButton,
  pickModel,
  registerUser,
} from './helpers';

test.describe('model gateway (M4)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('connect providers; an unreachable one shows an error', async ({ page }) => {
    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Cloud',
      endpoint: `${FAKE_PROVIDER}/openai/v1`,
    });
    await expect(page.getByText('Connected').first()).toBeVisible();
    await expect(page.getByText(/4 models/)).toBeVisible();

    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Broken',
      endpoint: 'http://127.0.0.1:1/v1',
    });
    await expect(page.getByText("Couldn't reach the provider.")).toBeVisible();
  });

  test('fallback chain: activate, test, and see the fallback recorded (AC 9, 11, 23)', async ({
    page,
  }) => {
    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Cloud',
      endpoint: `${FAKE_PROVIDER}/openai/v1`,
    });
    const id = await createAgentDraft(page, {
      name: 'Resilient',
      role: 'Researcher',
      job: 'Research things',
    });

    await page.getByLabel(/^Fallback chain/).check();
    await pickModel(page, 'Primary model', 'Cloud', 'fake-down');
    await page.getByRole('button', { name: 'Add fallback' }).click();
    await pickModel(page, 'Fallbacks 1', 'Cloud', 'fake-echo');
    await nextButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}/setup/tools$`));
    await nextButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/setup/permissions$`));
    await nextButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/setup/review$`));
    await page.getByRole('button', { name: 'Create agent' }).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));

    // Has a working model now, so it can be activated.
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

    await page.getByLabel('Prompt', { exact: true }).fill('hello world');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('agent-response')).toHaveText('echo: hello world');
    await expect(page.getByText(/Served by openai_compatible\/fake-echo/)).toBeVisible();

    await page.locator('details summary').first().click();
    await expect(page.locator('[data-event="model.fallback"]')).toContainText(
      'fake-down failed (unavailable)',
    );
    await expect(page.locator('[data-event="model.completed"]')).toContainText('fake-echo');
  });

  test('cloud and local agents side by side (AC 6, 7)', async ({ page }) => {
    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Cloud',
      endpoint: `${FAKE_PROVIDER}/openai/v1`,
    });
    await addProvider(page, {
      kind: 'Ollama (local)',
      name: 'Local Ollama',
      endpoint: `${FAKE_PROVIDER}/openai`,
    });

    for (const [name, provider, model] of [
      ['Cloud Agent', 'Cloud', 'fake-echo'],
      ['Local Agent', 'Local Ollama', 'fake-local'],
    ] as const) {
      const id = await createAgentDraft(page, { name });
      await pickModel(page, 'Primary model', provider, model);
      await nextButton(page).click();
      await expect(page).toHaveURL(/\/setup\/tools$/);
      await page.goto(`/agents/${id}`);
      await page.getByLabel('Prompt', { exact: true }).fill(`hi from ${name}`);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByTestId('agent-response')).toHaveText(`echo: hi from ${name}`);
    }
    await expect(page.getByText(/Served by ollama\/fake-local/)).toBeVisible();
  });

  test('a provider in use cannot be removed', async ({ page }) => {
    await addProvider(page, {
      kind: 'OpenAI-compatible',
      name: 'Cloud',
      endpoint: `${FAKE_PROVIDER}/openai/v1`,
    });
    await createAgentDraft(page, { name: 'User of Cloud' });
    await pickModel(page, 'Primary model', 'Cloud', 'fake-echo');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/setup\/tools$/);

    await page.goto('/settings/providers');
    await page.getByRole('button', { name: 'Remove Cloud' }).click();
    await expect(page.getByText('Agents still use this provider.')).toBeVisible();
  });
});
