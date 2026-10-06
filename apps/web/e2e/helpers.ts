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

const AGENT_TYPE_LABEL = {
  master_orchestrator: /^Master Orchestrator/,
  manager: /^Manager Agent/,
  specialist: /^Specialist Agent/,
} as const;

/**
 * Fills wizard step 1 and continues to the personality step. Returns the new agent's id.
 * Labels are matched exactly: e.g. the Master Orchestrator hint contains the word "goals".
 */
export async function createAgentDraft(
  page: Page,
  {
    name,
    type = 'specialist',
    role = `${name} role`,
    job = `${name} job`,
    parent,
  }: {
    name: string;
    type?: keyof typeof AGENT_TYPE_LABEL;
    role?: string;
    job?: string;
    parent?: string;
  },
) {
  await page.goto('/agents/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Name *', { exact: true }).fill(name);
  await page.getByLabel('Description *', { exact: true }).fill(`${name} description`);
  await page.getByLabel(AGENT_TYPE_LABEL[type]).check();
  await page.getByLabel('Role', { exact: true }).fill(role);
  await page.getByLabel('Job definition', { exact: true }).fill(job);
  if (parent) {
    await page.getByLabel('Reports to', { exact: true }).click();
    await page.getByRole('option', { name: parent }).click();
  }
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]+\/setup\/personality$/);
  return page.url().split('/agents/')[1]!.split('/')[0]!;
}

/** The wizard's Next control (exact: the dev overlay adds an "Open Next.js Dev Tools" button). */
export const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
export const nextLink = (page: Page) => page.getByRole('link', { name: 'Next', exact: true });
