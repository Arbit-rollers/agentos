import { expect, test, type Page } from '@playwright/test';
import { registerUser, sendChat, setupWorkingAgent } from './helpers';

async function addNote(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: 'Add source' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Text').fill(text);
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toBeHidden();
}

const row = (page: Page, name: string) => page.locator(`tr[data-source="${name}"]`);

test.describe('knowledge, memory and feedback (v0.3)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('embedding model, sources and retrieval in a run (AC 21)', async ({ page }) => {
    const id = await setupWorkingAgent(page);

    // Pick the embedding model; it is tested before it is saved.
    await page.goto('/settings/knowledge');
    await expect(page.getByTestId('embedding-status')).toContainText('Keyword search only');
    await page.getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name: 'Cloud' }).click();
    await page.getByLabel('Model').fill('fake-embed-small-dim');
    await page.getByRole('button', { name: 'Save and re-index' }).click();
    await expect(page.getByText("This model's vectors aren't 768-dimensional")).toBeVisible();
    await page.getByLabel('Model').fill('fake-embed');
    await page.getByRole('button', { name: 'Save and re-index' }).click();
    await expect(page.getByTestId('embedding-status')).toContainText('In use: Cloud · fake-embed');

    // A note and an uploaded file are indexed by the worker.
    await page.goto('/knowledge');
    await addNote(page, 'Style guide', 'Our airline code is ZQ. Always write dates as ISO 8601.');
    await page.getByRole('button', { name: 'Add source' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'File' }).click();
    await dialog.getByLabel('File').setInputFiles({
      name: 'fleet.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Fleet\n\nThe A350 fleet grew by twelve aircraft this year.'),
    });
    await dialog.getByRole('button', { name: 'Add source' }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, 'Style guide')).toContainText('Ready', { timeout: 20_000 });
    await expect(row(page, 'Style guide')).toContainText('1 excerpt');
    await expect(row(page, 'fleet.md')).toContainText('Ready', { timeout: 20_000 });

    // The agent gets the relevant excerpt, and the log shows what it used.
    await page.goto(`/agents/${id}`);
    await sendChat(page, 'What is our airline code?');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 15_000 });
    await page.goto(`/agents/${id}?tab=logs`);
    await page.locator('details summary').first().click();
    await expect(page.locator('[data-event="context.retrieved"]').first()).toContainText(
      /1 knowledge excerpt: Style guide|knowledge excerpts: .*Style guide/,
    );

    // Deleting a source takes it out of the list (and of retrieval).
    await page.goto('/knowledge');
    await row(page, 'fleet.md').getByRole('button', { name: 'Delete: fleet.md' }).click();
    await row(page, 'fleet.md')
      .getByRole('button', { name: 'Click again to delete: fleet.md' })
      .click();
    await expect(row(page, 'fleet.md')).toHaveCount(0);
  });

  test('agent Files tab attaches knowledge to that agent only', async ({ page }) => {
    const id = await setupWorkingAgent(page);
    await page.goto(`/agents/${id}?tab=files`);
    await expect(page.getByText('No files attached to this agent yet.')).toBeVisible();
    await addNote(page, 'Operator SOP', 'Escalate refunds over 500 euros.');
    await expect(row(page, 'Operator SOP')).toContainText('Ready', { timeout: 20_000 });
    await page.goto('/knowledge');
    await expect(row(page, 'Operator SOP')).toContainText('Operator');
  });

  test('memory: add, pin, edit, disable and delete', async ({ page }) => {
    await setupWorkingAgent(page);
    await page.goto('/memory');
    await expect(page.getByText('No memories yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Add memory' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Memory').fill('Answer in bullet points.');
    await dialog.getByRole('button', { name: 'Add memory' }).click();
    await expect(dialog).toBeHidden();

    const item = page.getByRole('listitem', { name: 'Answer in bullet points.' });
    await expect(item).toContainText('Rule');
    await expect(item).toContainText('All agents');
    await item.getByRole('button', { name: 'Pin' }).click();
    await expect(item).toContainText('Pinned');

    await item.getByRole('button', { name: 'Edit' }).click();
    await item.getByLabel('Memory').fill('Answer in short bullet points.');
    await item.getByRole('button', { name: 'Save' }).click();
    const edited = page.getByRole('listitem', { name: 'Answer in short bullet points.' });
    await expect(edited).toBeVisible();

    await page.getByLabel('Search memories').fill('nothing-matches');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No memories yet.')).toBeVisible();
    await page.goto('/memory');

    await edited.getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByRole('tab', { name: /Disabled\s*\(1\)/ })).toBeVisible();
    await page.getByRole('tab', { name: /Disabled/ }).click();
    await expect(edited).toContainText('Disabled');
    await edited.getByRole('button', { name: 'Delete' }).click();
    await edited.getByRole('button', { name: 'Click again to delete' }).click();
    await expect(page.getByText('No memories yet.')).toBeVisible();
  });

  test('feedback suggests a rule and a personality change that apply only when accepted', async ({
    page,
  }) => {
    const id = await setupWorkingAgent(page);
    await sendChat(page, 'Summarise the fleet plan');
    const answer = page.getByTestId('assistant-message').last();
    await expect(answer).toBeVisible({ timeout: 15_000 });

    await answer.getByRole('button', { name: 'Bad answer' }).click();
    await answer
      .getByLabel('What should change?')
      .fill('Too long. Give me only the important information.');
    await answer.getByRole('button', { name: 'Send' }).click();
    await expect(answer.getByText('Suggested changes')).toBeVisible();
    await expect(answer).toContainText(
      'New rule: Too long. Give me only the important information.',
    );
    await expect(answer).toContainText('Concise: 50 → 70');

    // Nothing applied yet: the rule is only a suggestion.
    await page.goto('/memory');
    await expect(page.getByText('Suggested from your feedback')).toBeVisible();
    await expect(page.getByText('No memories yet.')).toBeVisible();

    await page.goto(`/agents/${id}`);
    const card = page.getByTestId('assistant-message').last();
    await card
      .locator('[data-suggestion="memory"]')
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(card.locator('[data-suggestion="memory"]')).toContainText('Accepted');
    await card
      .locator('[data-suggestion="personality"]')
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(card.locator('[data-suggestion="personality"]')).toContainText('Accepted');

    await page.goto('/memory');
    await expect(page.getByText('Suggested from your feedback')).toHaveCount(0);
    await expect(
      page.getByRole('listitem', { name: 'Too long. Give me only the important information.' }),
    ).toContainText('From your feedback');
    await page.goto(`/agents/${id}/setup/personality`);
    await expect(page.getByRole('slider', { name: /Concise/ })).toHaveAttribute(
      'aria-valuenow',
      '70',
    );
  });
});
