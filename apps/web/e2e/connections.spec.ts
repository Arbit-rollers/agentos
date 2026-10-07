import { expect, test } from '@playwright/test';
import { FAKE_MCP, connectMcp, registerUser } from './helpers';

const GOOGLE_LIKE = 'http://127.0.0.1:4021/mcp';

test.describe('per-user connections and sign-in methods (v0.4.1)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('a server added with "None" that needs sign-in says so, and can switch to OAuth in place', async ({
    page,
  }) => {
    const id = await connectMcp(page, { name: 'Locked Server', path: '/oauth/mcp' });
    await expect(page.getByText('This server requires sign-in.')).toBeVisible();

    await page.getByRole('link', { name: /^Authentication/ }).click();
    await page.getByText('Change sign-in method').click();
    await page.getByLabel('Authentication', { exact: true }).click();
    await page.getByRole('option', { name: 'OAuth (sign in)' }).click();
    await page.getByRole('button', { name: 'Save sign-in method' }).click();

    // The fake authorization server approves at once and sends us back.
    await expect(page).toHaveURL(new RegExp(`/mcp/${id}`));
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.goto('/mcp');
    await expect(page.getByText('6 tools')).toBeVisible();
  });

  test('each member connects their own account (pre-registered OAuth client, scopes)', async ({
    page,
  }) => {
    await page.goto('/mcp/new');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Name', { exact: true }).fill('Team Mail');
    await page.getByLabel('Server URL', { exact: true }).fill(GOOGLE_LIKE);
    await page.getByLabel('Authentication', { exact: true }).click();
    await page.getByRole('option', { name: 'OAuth (sign in)' }).click();
    await page.getByLabel('Who signs in').click();
    await page.getByRole('option', { name: 'Each member connects their own account' }).click();
    await page.getByText('Advanced OAuth settings').click();
    await expect(page.getByText('/api/mcp/oauth/callback')).toBeVisible();
    await page.getByLabel('Client ID').fill('static-client');
    await page.getByLabel('Client secret').fill('static-secret');
    await page.getByLabel('Scopes').fill('mail.read');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page).toHaveURL(/\/mcp\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { level: 1, name: 'Team Mail' })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.goto('/mcp');
    await expect(page.getByText('Each member signs in')).toBeVisible();
    await page
      .getByRole('link', { name: /Team Mail|Open/ })
      .first()
      .click();

    await page.getByRole('link', { name: /^Authentication/ }).click();
    const mine = page.getByRole('region', { name: 'Your account' });
    await expect(mine).toContainText('Connected. Agents working for you use your account.');
    await expect(page.getByText('mail.read')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Members who connected' })).toContainText(
      'Test User',
    );

    await mine.getByRole('button', { name: 'Disconnect my account' }).click();
    await mine.getByRole('button', { name: 'Click again to disconnect' }).click();
    await expect(mine).toContainText('Not connected.');
    await expect(page.getByText('Nobody has connected yet.')).toBeVisible();

    await mine.getByRole('button', { name: 'Connect my account' }).click();
    await expect(page).toHaveURL(/\?connected=1$/);
    await page.getByRole('link', { name: /^Authentication/ }).click();
    await expect(page.getByRole('region', { name: 'Your account' })).toContainText(
      'Connected. Agents working for you use your account.',
    );
  });

  test('Google Workspace: pick services and bring your own Google app', async ({ page }) => {
    await page.goto('/mcp/new?template=google_workspace');
    await expect(page.getByRole('heading', { name: 'Connect Google Workspace' })).toBeVisible();
    for (const service of ['Gmail', 'Google Calendar', 'Google Drive'])
      await expect(page.getByRole('checkbox', { name: service })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Google Docs' })).not.toBeChecked();
    // No platform app configured in tests: tenants bring their own.
    await expect(page.getByText('Not configured on this AgentOS server')).toBeVisible();
    await page.getByRole('button', { name: 'Connect and sign in' }).click();
    await expect(page.getByText('Enter the client ID.')).toBeVisible();
    await expect(page.getByText('Enter the client secret.')).toBeVisible();
    void FAKE_MCP;
  });
});
