import { expect, test } from '@playwright/test';
import { PASSWORD, registerUser, signOut, uniqueEmail } from './helpers';

test('register, sign out and sign back in (AC 1)', async ({ page }) => {
  const email = await registerUser(page, uniqueEmail('alice'), 'Alice');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Alice');
  await expect(page.getByText('Account created')).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByTestId('user-email')).toHaveText(email);
  await page.keyboard.press('Escape');

  await signOut(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email.toUpperCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Signed in').first()).toBeVisible();
});

test('shows errors for bad credentials and invalid sign-up input', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' }),
  ).toBeVisible();

  await page.goto('/register');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('Password must be at least 10 characters.')).toBeVisible();
});

test('the session cookie is httpOnly', async ({ page, context }) => {
  await registerUser(page);
  const cookie = (await context.cookies()).find((c) => c.name === 'agentos_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('agentos_session');
});

test('APIs require a session', async ({ request }) => {
  expect((await request.get('/api/me')).status()).toBe(401);
});

test('a user cannot read another tenant’s workspace by id (AC 2)', async ({ browser }) => {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();
  await registerUser(alicePage, uniqueEmail('alice'));
  await registerUser(bobPage, uniqueEmail('bob'));

  const aliceMe = await (await alice.request.get('/api/me')).json();
  const bobMe = await (await bob.request.get('/api/me')).json();
  expect(aliceMe.workspace.id).not.toBe(bobMe.workspace.id);

  const own = await alice.request.get(`/api/workspaces/${aliceMe.workspace.id}`);
  expect(own.status()).toBe(200);

  const other = await alice.request.get(`/api/workspaces/${bobMe.workspace.id}`);
  expect(other.status()).toBe(404);
  expect(await other.json()).toEqual({ error: 'not_found' });

  expect((await alice.request.get('/api/workspaces/not-a-uuid')).status()).toBe(404);

  await alice.close();
  await bob.close();
});
