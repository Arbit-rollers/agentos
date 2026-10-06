import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AgentOS' })).toBeVisible();
});

test('health endpoint reports database and redis', async ({ request }) => {
  const response = await request.get('/api/health');
  const body = await response.json();
  expect(body.components).toHaveProperty('database');
  expect(body.components).toHaveProperty('redis');
  expect(response.status()).toBe(body.ok ? 200 : 503);
});
