import { expect, test } from '@playwright/test';
import { connectMcp, createAgentDraft, nextButton, registerUser } from './helpers';

test.describe('MCP Hub (M5)', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('connect a server and see its tools with classified defaults (AC 13, 14)', async ({
    page,
  }) => {
    const id = await connectMcp(page, { name: 'Workspace Tools' });
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: /^Tools/ }).click();
    await expect(page).toHaveURL(new RegExp(`/mcp/${id}\\?tab=tools$`));
    for (const tool of ['search_documents', 'gmail_send', 'drive_delete']) {
      await expect(page.getByRole('cell', { name: new RegExp(`^${tool}`) })).toBeVisible();
    }
    await expect(
      page.getByRole('combobox', { name: 'Default permission: search_documents' }),
    ).toHaveText('Auto allow');
    await expect(page.getByRole('combobox', { name: 'Default permission: gmail_send' })).toHaveText(
      'Approval required',
    );
    await expect(
      page.getByRole('combobox', { name: 'Default permission: drive_delete' }),
    ).toHaveText('Blocked');

    // Changing a workspace default sticks.
    await page.getByRole('combobox', { name: 'Default permission: read_document' }).click();
    await page.getByRole('option', { name: 'Approval required' }).click();
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: 'Default permission: read_document' }),
    ).toHaveText('Approval required');

    await page.goto('/mcp');
    await expect(page.getByText('6 tools')).toBeVisible();
    await page.getByRole('tab', { name: /^Available/ }).click();
    await expect(page.getByText('Google Workspace')).toBeVisible();
  });

  test('OAuth sign-in through the browser (PKCE, callback, discovery)', async ({ page }) => {
    await connectMcp(page, {
      name: 'Signed-in Server',
      path: '/oauth/mcp',
      auth: 'OAuth (sign in)',
    });
    await expect(page.getByText('Connected. Tools discovered.')).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: /^Authentication/ }).click();
    await expect(page.getByText('Signed in.')).toBeVisible();
  });

  test('wizard steps 3–4: choose tools and permissions per agent (AC 15)', async ({ page }) => {
    await connectMcp(page, { name: 'Workspace Tools' });
    const id = await createAgentDraft(page, { name: 'Tool User' });
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/setup\/tools$/);

    await page.getByRole('checkbox', { name: 'search_documents' }).check();
    await page.getByRole('checkbox', { name: 'gmail_send' }).check();
    await expect(page.getByText('2/6 selected')).toBeVisible();
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/setup\/permissions$/);

    // An agent can be stricter than the default, never looser: gmail_send has no Auto allow.
    await page.getByRole('combobox', { name: 'Default permission: gmail_send' }).click();
    await expect(page.getByRole('option', { name: 'Auto allow' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Default permission: search_documents' }).click();
    await page.getByRole('option', { name: 'Blocked' }).click();
    await page.getByLabel('Make payments').uncheck();
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/setup\/review$/);

    await page.goto(`/agents/${id}`);
    const tools = page.locator('section', { has: page.getByRole('heading', { name: 'Tools' }) });
    await expect(tools.getByText('search_documents')).toBeVisible();
    await expect(tools.getByText('Blocked')).toBeVisible();
    await expect(tools.getByText('Approval required')).toBeVisible();
  });

  test('disconnecting removes the server', async ({ page }) => {
    await connectMcp(page, { name: 'Temporary' });
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByRole('button', { name: 'Click again to disconnect' }).click();
    await expect(page).toHaveURL(/\/mcp$/);
    await expect(page.getByText('Temporary')).toHaveCount(0);
  });
});
