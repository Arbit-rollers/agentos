import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, registerUser, setupWorkingAgent, uniqueEmail } from './helpers';

/** Owner invites a new member, who registers through the link and joins. */
async function addMember(owner: Page, browser: Browser) {
  await owner.goto('/settings/members');
  const email = uniqueEmail('member');
  await owner.getByLabel('Email', { exact: true }).fill(email);
  await owner.getByRole('button', { name: 'Create invitation' }).click();
  const link = await owner.getByLabel('Invitation link').inputValue();
  const context = await browser.newContext();
  const member = await context.newPage();
  await member.goto(link);
  await member.getByRole('link', { name: 'Create an account to accept' }).click();
  await member.getByLabel('Name').fill('Mia Member');
  await member.getByLabel('Password').fill(PASSWORD);
  await member.getByRole('button', { name: 'Create account' }).click();
  await member.getByRole('button', { name: 'Accept and join' }).click();
  await expect(member).toHaveURL(/\/dashboard/);
  return { member, context };
}

test.describe('workspace roles (v0.4.3)', () => {
  test('a member uses the workspace but cannot change its setup or others’ agents', async ({
    page,
    browser,
  }) => {
    await registerUser(page, uniqueEmail('owner'), 'Olivia Owner');
    const agentId = await setupWorkingAgent(page);
    const { member, context } = await addMember(page, browser);

    // Workspace setup is read-only.
    await member.goto('/settings/providers');
    await expect(member.getByTestId('admin-only')).toBeVisible();
    await expect(member.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await member.goto('/mcp');
    await expect(member.getByRole('link', { name: 'Connect server' })).toHaveCount(0);
    await member
      .getByRole('link', { name: /Open|Workspace/ })
      .first()
      .click();
    await expect(member.getByRole('button', { name: /Disconnect|Test/ })).toHaveCount(0);

    // The owner's agent: chat yes, edit no.
    await member.goto(`/agents/${agentId}`);
    await member.getByRole('button', { name: 'Agent settings' }).click();
    const drawer = member.getByRole('dialog', { name: 'Agent settings' });
    await expect(drawer.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /Pause|Archive/ })).toHaveCount(0);
    await member.goto(`/agents/${agentId}/setup/basic`);
    await expect(member).toHaveURL(new RegExp(`/agents/${agentId}$`));

    // The owner's approval is visible to the member but not theirs to decide.
    await page.goto(`/agents/${agentId}`);
    await page
      .getByRole('textbox', { name: 'Ask anything…' })
      .fill('Email [[call:gmail_send:{"to":"a@example.com","body":"x"}]]');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('article', { name: 'Approval needed' })).toBeVisible({
      timeout: 15_000,
    });
    await member.goto('/approvals');
    await expect(member.getByTestId('not-yours')).toBeVisible();
    await expect(member.getByRole('button', { name: 'Approve once' })).toHaveCount(0);
    await page.goto('/approvals');
    await expect(page.getByRole('button', { name: 'Approve once' })).toBeVisible();

    // Promoted to admin, the controls appear.
    await page.goto('/settings/members');
    await page.getByRole('combobox', { name: 'Role: Mia Member' }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    await expect(page.getByRole('combobox', { name: 'Role: Mia Member' })).toContainText('Admin');
    await member.goto('/settings/providers');
    await expect(member.getByTestId('admin-only')).toHaveCount(0);
    await context.close();
  });
});
