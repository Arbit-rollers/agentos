import { expect, test } from '@playwright/test';
import { PASSWORD, registerUser, uniqueEmail } from './helpers';

test.describe('workspace invitations', () => {
  test('owner invites, the guest registers through the link, joins, switches, and is removed', async ({
    page,
    browser,
  }) => {
    await registerUser(page, uniqueEmail('owner'), 'Olivia Owner');
    await page.goto('/settings/members');
    await page.getByLabel('Workspace name').fill('Pilots Quest');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    const guestEmail = uniqueEmail('guest');
    await page.getByLabel('Email', { exact: true }).fill(guestEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const link = await page.getByLabel('Invitation link').inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    await expect(page.getByRole('list', { name: 'Pending invitations' })).toContainText(guestEmail);

    // A second person, in their own browser.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(link);
    await expect(
      guest.getByText('Olivia Owner invited you to join “Pilots Quest” as Member.'),
    ).toBeVisible();
    await guest.getByRole('link', { name: 'Create an account to accept' }).click();
    await expect(guest.getByLabel('Email')).toHaveValue(guestEmail);
    await guest.getByLabel('Name').fill('Gus Guest');
    await guest.getByLabel('Password').fill(PASSWORD);
    await guest.getByRole('button', { name: 'Create account' }).click();
    await expect(guest).toHaveURL(/\/invite\//);
    await guest.getByRole('button', { name: 'Accept and join' }).click();
    await expect(guest).toHaveURL(/\/dashboard/);
    await expect(guest.getByRole('button', { name: 'Switch workspace' })).toContainText(
      'Pilots Quest',
    );

    // The link is single use.
    await guest.goto(link);
    await expect(guest.getByText('This invitation has already been used.')).toBeVisible();

    // Members can see the team but not manage it.
    await guest.goto('/settings/members');
    await expect(guest.getByRole('list', { name: 'Workspace members' })).toContainText(
      'Olivia Owner',
    );
    await expect(guest.getByRole('button', { name: 'Create invitation' })).toHaveCount(0);

    // Switch to their own workspace and back.
    await guest.getByRole('button', { name: 'Switch workspace' }).click();
    await guest.getByRole('menuitem', { name: 'Personal' }).click();
    await expect(guest.getByRole('button', { name: 'Switch workspace' })).toContainText('Personal');
    await guest.getByRole('button', { name: 'Switch workspace' }).click();
    await guest.getByRole('menuitem', { name: 'Pilots Quest' }).click();
    await expect(guest.getByRole('button', { name: 'Switch workspace' })).toContainText(
      'Pilots Quest',
    );

    // The owner removes them; their session falls back to their own workspace.
    await page.reload();
    const member = page.locator(`[data-member="${guestEmail}"]`);
    await expect(member).toContainText('Gus Guest');
    await member.getByRole('button', { name: 'Remove' }).click();
    await member.getByRole('button', { name: 'Click again to confirm' }).click();
    await expect(page.locator(`[data-member="${guestEmail}"]`)).toHaveCount(0);
    await guest.goto('/dashboard');
    await expect(guest.getByRole('button', { name: 'Switch workspace' })).toContainText('Personal');
    await guestContext.close();
  });

  test('someone else signed in sees that the invitation is not for them', async ({
    page,
    browser,
  }) => {
    await registerUser(page);
    await page.goto('/settings/members');
    await page.getByLabel('Email', { exact: true }).fill(uniqueEmail('invitee'));
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const link = await page.getByLabel('Invitation link').inputValue();

    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await registerUser(other);
    await other.goto(link);
    await expect(other.getByText(/but this invitation is for/)).toBeVisible();
    await expect(other.getByRole('button', { name: 'Accept and join' })).toHaveCount(0);
    await otherContext.close();
  });
});
