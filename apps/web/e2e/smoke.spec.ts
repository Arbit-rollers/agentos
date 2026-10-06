import { expect, test } from '@playwright/test';

test('home redirects signed-out visitors to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to AgentOS' })).toBeVisible();
});

test('health endpoint reports database and redis', async ({ request }) => {
  const response = await request.get('/api/health');
  const body = await response.json();
  expect(body.components).toHaveProperty('database');
  expect(body.components).toHaveProperty('redis');
  expect(response.status()).toBe(body.ok ? 200 : 503);
});
