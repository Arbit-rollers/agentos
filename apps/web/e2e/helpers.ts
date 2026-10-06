import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery';

export const uniqueEmail = (name: string) =>
  `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export async function registerUser(page: Page, email = uniqueEmail('user'), name = 'Test User') {
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}
