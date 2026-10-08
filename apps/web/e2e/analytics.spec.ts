import { expect, test } from '@playwright/test';
import { registerUser, sendChat, setupWorkingAgent } from './helpers';

test.describe('analytics (v0.6)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('shows runs, tools and models for the chosen range', async ({ page }) => {
    await setupWorkingAgent(page, 'Researcher');
    await sendChat(page, 'Find topics [[call:search:{"query":"aviation"}]]');
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'results for aviation',
    );

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Runs', { exact: true }).first()).toBeVisible();

    await expect(page.getByRole('main').getByRole('link', { name: 'Researcher' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'search_documents' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'fake-echo' })).toBeVisible();

    // Charts offer a table view for screen readers and exact values.
    await page.getByRole('button', { name: 'Show as table' }).first().click();
    await expect(
      page.getByRole('table', { name: 'Completed and failed runs per day, last 30 days' }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Last 7 days' }).click();
    await expect(page).toHaveURL(/\/analytics\?range=7$/);
    await expect(page.getByRole('cell', { name: 'search_documents' })).toBeVisible();
  });

  test('an empty workspace shows empty states', async ({ page }) => {
    await page.goto('/analytics?range=90');
    await expect(page.getByRole('tab', { name: 'Last 90 days' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('No tool calls in this period.')).toBeVisible();
    await expect(page.getByText('No workflow runs in this period.')).toBeVisible();
  });
});
