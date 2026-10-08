import { expect, test } from '@playwright/test';
import { registerUser, setupWorkingAgent } from './helpers';

test.describe('workflows (v0.5)', () => {
  test.beforeEach(async ({ page }) => {
    test.slow();
    await registerUser(page);
  });

  test('build, save, test-run through an approval, activate and schedule (AC 25)', async ({
    page,
  }) => {
    await setupWorkingAgent(page);
    await page.goto('/workflows');
    await expect(page.getByText('No workflows yet.')).toBeVisible();
    await page.getByRole('button', { name: 'New workflow' }).click();
    await page.getByLabel('Name').fill('Weekly Aviation Content');
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]+$/);
    await expect(page.getByText('Version 1')).toBeVisible();

    // Steps are inserted before the Output step, in order.
    const palette = page.getByRole('complementary', { name: 'Steps' });
    await palette.getByRole('button', { name: 'Add: Operator' }).click();
    const settings = page.getByRole('region', { name: 'Step settings' });
    await settings.getByLabel('Instructions').fill('Research {{input}}');
    await palette.getByRole('button', { name: 'Add: Human approval' }).click();
    await settings.getByLabel('Step name').fill('Review');
    await settings.getByLabel('Message to the approver').fill('Publish? {{steps.Operator}}');
    await expect(page.locator('[data-step="Operator"]')).toContainText('1. Operator');
    await expect(page.locator('[data-step="Review"]')).toContainText('2. Review');
    await expect(page.locator('[data-step="Output"]')).toContainText('3. Output');

    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect(page.getByText('Version 2')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fix before activating' })).toHaveCount(0);

    await page.getByLabel('Input for a test run').fill('aviation');
    await page.getByRole('button', { name: 'Test run' }).click();
    await expect(page).toHaveURL(/tab=runs/);
    const run = page.locator('[data-run]').first();
    await expect(run).toContainText('Waiting', { timeout: 20_000 });
    await expect(run.locator('[data-step-log="Operator"]')).toContainText('Done');
    // The sidebar picks up the new approval by itself.
    await expect(page.getByTestId('approvals-badge')).toHaveText('1', { timeout: 15_000 });

    const runsUrl = page.url();
    await page.goto('/approvals');
    await expect(page.getByText('Publish? echo: Task: Operator')).toBeVisible();
    await page.getByRole('button', { name: 'Approve once' }).click();
    await expect(page.getByText('Nothing waiting for approval.')).toBeVisible();

    await page.goto(runsUrl);
    await expect(async () => {
      await page.reload();
      await expect(page.locator('[data-run]').first()).toContainText('Completed', {
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId('run-output').first()).toContainText('echo: Task: Operator');

    // Activate and schedule.
    await page.getByRole('link', { name: 'Builder' }).click();
    const workflowSettings = page.getByRole('region', { name: 'Workflow settings' });
    await workflowSettings.getByRole('button', { name: 'Add schedule' }).click();
    await expect(workflowSettings.getByRole('list', { name: 'Schedules' })).toContainText(
      '0 9 * * 1',
    );
    await workflowSettings.getByRole('switch', { name: 'Active' }).click();
    await expect(workflowSettings.getByRole('switch', { name: 'Active' })).toBeChecked();
    await page.goto('/workflows');
    await expect(page.getByRole('row', { name: /Weekly Aviation Content/ })).toContainText(
      'Active',
    );
    await expect(page.getByRole('row', { name: /Weekly Aviation Content/ })).toContainText(
      '0 9 * * 1',
    );
    await page.goto('/schedules');
    await expect(page.getByText('Weekly Aviation Content (schedule)')).toBeVisible();
  });

  test('validation blocks activation; versions can be restored', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('button', { name: 'New workflow' }).click();
    await page.getByLabel('Name').fill('Broken');
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await expect(page.getByText('Version 1')).toBeVisible();

    const palette = page.getByRole('complementary', { name: 'Steps' });
    await palette.getByRole('button', { name: 'Add: Condition' }).click();
    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect(page.getByText('Version 2')).toBeVisible();
    const issues = page.getByRole('region', { name: 'Fix before activating' });
    await expect(issues).toContainText('Connect the Yes and/or No branch');

    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page
      .getByRole('region', { name: 'Workflow settings' })
      .getByRole('switch', { name: 'Active' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: 'Connect the Yes' })).toBeVisible();

    await page.getByRole('link', { name: 'Versions' }).click();
    await page.getByRole('button', { name: 'Restore: Version 1' }).click();
    await expect(page.getByText('Version 3')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fix before activating' })).toHaveCount(0);
  });
});
