import { expect, test } from '@playwright/test';
import { registerUser } from './helpers';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await registerUser(page);
  });

  test('sidebar lists all 12 sections and marks the current page', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link')).toHaveCount(12);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await nav.getByRole('link', { name: 'Analytics' }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByText('Coming in v0.6')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Analytics' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('unknown sections are 404s', async ({ page }) => {
    const response = await page.goto('/not-a-section');
    expect(response?.status()).toBe(404);
  });

  test('command palette navigates with the keyboard', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('workfl');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(palette).toBeHidden();
  });

  test('the search box opens the command palette', async ({ page }) => {
    await page.getByRole('button', { name: /Search agents, tasks, tools/ }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('skip link is the first focusable element and jumps to content', async ({ page }) => {
    // Fresh page load, so focus starts at the top of the document.
    await page.reload();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('dashboard shows KPI tiles, empty states and the task chart', async ({ page }) => {
    for (const label of ['Active agents', 'Running tasks', 'MCP connections', 'Success rate']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('No agents yet')).toBeVisible();
    await expect(page.getByText('No tasks in the last 7 days.')).toBeVisible();
    await page.getByRole('button', { name: 'Show as table' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(8);
  });
});

test.describe('language (PRD §33)', () => {
  test('profile language switches the whole UI to Turkish', async ({ page }) => {
    await registerUser(page, undefined, 'Buğra');
    await page.goto('/settings');
    await page.getByLabel('Name').fill('Buğra K.');
    await page.getByLabel('Language').click();
    await page.getByRole('option', { name: 'Türkçe' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('button', { name: 'Değişiklikleri kaydet' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    const nav = page.getByRole('navigation', { name: 'Ana menü' });
    await expect(nav.getByRole('link', { name: 'Ajanlar' })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Buğra K.');
    await expect(page.getByText('Profil güncellendi')).toBeVisible();
  });

  test('signed-out visitors can switch language', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Türkçe' }).click();
    await expect(page.getByRole('heading', { name: "AgentOS'a giriş yapın" })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to AgentOS' })).toBeVisible();
  });

  test('a Turkish browser gets Turkish pages and a Turkish account', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'tr-TR' });
    const page = await context.newPage();
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'AgentOS hesabınızı oluşturun' })).toBeVisible();
    await page.getByLabel('Ad').fill('Ayşe');
    await page.getByLabel('E-posta').fill(`ayse-${Date.now()}@example.com`);
    await page.getByLabel('Şifre').fill('correct horse battery');
    await page.getByRole('button', { name: 'Hesap oluştur' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Hesap oluşturuldu')).toBeVisible();
    await context.close();
  });
});
