import { expect, test, type Page } from '@playwright/test';
import { registerUser, setupWorkingAgent } from './helpers';

async function newTask(page: Page, objective: string, details = '') {
  await page.getByRole('button', { name: 'New Task' }).click();
  const dialog = page.getByRole('dialog');
  const agent = dialog.getByRole('combobox', { name: 'Agent' });
  if (await agent.isEnabled()) {
    await agent.click();
    await page.getByRole('option', { name: 'Operator' }).click();
  }
  await dialog.getByLabel('Task', { exact: true }).fill(objective);
  if (details) await dialog.getByLabel('Details').fill(details);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toBeHidden();
}

/** Follows a task link by href (a click can race the refresh after creating it). */
async function openTask(page: Page, objective: string) {
  const link = page.getByRole('link', { name: objective });
  await page.goto((await link.getAttribute('href'))!);
}

test.describe('tasks and schedules (v0.2)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('a manual task runs in the worker and shows output and history', async ({ page }) => {
    await setupWorkingAgent(page);
    await page.goto('/tasks');
    await newTask(page, 'Summarise aviation trends', 'Three bullet points');
    await openTask(page, 'Summarise aviation trends');
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
    await expect(page.getByText('Three bullet points').first()).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('list', { name: 'History' })).toContainText('Completed', {
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
    const history = page.getByRole('list', { name: 'History' });
    await expect(history).toContainText('Queued');
    await expect(history).toContainText('Running');
    await expect(page.getByText(/Summarise aviation trends/).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });

  test('a task waiting for approval can be cancelled and retried', async ({ page }) => {
    const id = await setupWorkingAgent(page);
    await page.goto(`/agents/${id}?tab=tasks`);
    await newTask(
      page,
      'Send the memo',
      '[[call:gmail_send:{"to":"a@example.com","body":"memo"}]]',
    );
    await openTask(page, 'Send the memo');
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('list', { name: 'History' })).toContainText(
        'Waiting for approval',
        {
          timeout: 1000,
        },
      );
    }).toPass({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history).toContainText('Cancelled by a person');
    await page.goto('/approvals');
    await expect(page.getByText('Nothing waiting for approval.')).toBeVisible();

    await page.goBack();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(history).toContainText('Retried by a person');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('schedules: create, run now, pause and delete', async ({ page }) => {
    await setupWorkingAgent(page);
    await page.goto('/schedules');
    await expect(page.getByText('No schedules yet.')).toBeVisible();

    await page.getByRole('button', { name: 'New schedule' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Weekly trends');
    await dialog.getByRole('combobox', { name: 'Agent' }).click();
    await page.getByRole('option', { name: 'Operator' }).click();
    await dialog.getByLabel('Task', { exact: true }).fill('Collect trends');
    await dialog.getByLabel('Time', { exact: true }).fill('08:30');
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row', { name: /Weekly trends/ });
    await expect(row).toContainText('30 8 * * 1');
    await expect(row).toContainText('Active');

    // A bad custom cron is rejected with a field error.
    await page.getByRole('button', { name: 'New schedule' }).click();
    await dialog.getByLabel('Name').fill('Broken');
    await dialog.getByRole('combobox', { name: 'Agent' }).click();
    await page.getByRole('option', { name: 'Operator' }).click();
    await dialog.getByLabel('Task', { exact: true }).fill('x');
    await dialog.getByRole('combobox', { name: 'Frequency' }).click();
    await page.getByRole('option', { name: 'Custom (cron)' }).click();
    await dialog.getByLabel('Cron expression').fill('every monday');
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(dialog.getByText(/cron/i).last()).toBeVisible();
    await page.keyboard.press('Escape');

    await row.getByRole('button', { name: 'Run now: Weekly trends' }).click();
    await expect(row.getByRole('link', { name: /\d/ })).toBeVisible();
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: 'Collect trends' })).toBeVisible();
    await expect(page.getByText('Scheduled').first()).toBeVisible();

    await page.goto('/schedules');
    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row).toContainText('Paused');
    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Click again to delete' }).click();
    await expect(page.getByText('No schedules yet.')).toBeVisible();
  });
});
