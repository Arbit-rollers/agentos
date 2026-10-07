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

export const FAKE_PROVIDER = 'http://127.0.0.1:4010';

/** Settings → AI Providers → Add provider. */
export async function addProvider(
  page: Page,
  {
    kind,
    name,
    endpoint,
  }: { kind: 'OpenAI-compatible' | 'Ollama (local)'; name: string; endpoint: string },
) {
  await page.goto('/settings/providers');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Provider', { exact: true }).click();
  await page.getByRole('option', { name: kind }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Endpoint URL', { exact: true }).fill(endpoint);
  await page.getByRole('button', { name: 'Add provider' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** Picks provider + model in an AI Brain target picker (label = "Primary model", "Fallbacks 1", …). */
export async function pickModel(page: Page, label: string, provider: string, model: string) {
  await page.getByRole('combobox', { name: `${label}: Provider` }).click();
  await page.getByRole('option', { name: provider }).click();
  await page.getByRole('combobox', { name: `${label}: Model` }).click();
  await page.getByRole('option', { name: new RegExp(`^${model}`) }).click();
}

export const FAKE_MCP = 'http://127.0.0.1:4020';

/** MCP Hub → Connect. Returns the connection id once its detail page shows. */
export async function connectMcp(
  page: Page,
  {
    name,
    path = '/mcp',
    auth = 'None',
  }: { name: string; path?: string; auth?: 'None' | 'OAuth (sign in)' },
) {
  await page.goto('/mcp/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Server URL', { exact: true }).fill(`${FAKE_MCP}${path}`);
  if (auth !== 'None') {
    await page.getByLabel('Authentication', { exact: true }).click();
    await page.getByRole('option', { name: auth }).click();
  }
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(/\/mcp\/[0-9a-f-]+(\?connected=1)?$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop()!;
}

/**
 * Full v0.1 setup through the UI: provider, MCP server, an active agent on `fake-echo`
 * with search_documents (auto allow) and gmail_send (approval required). Returns its id.
 */
export async function setupWorkingAgent(page: Page, name = 'Operator') {
  await addProvider(page, {
    kind: 'OpenAI-compatible',
    name: 'Cloud',
    endpoint: `${FAKE_PROVIDER}/openai/v1`,
  });
  await connectMcp(page, { name: 'Workspace' });
  const id = await createAgentDraft(page, { name });
  await pickModel(page, 'Primary model', 'Cloud', 'fake-echo');
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/tools$/);
  await page.getByRole('checkbox', { name: 'search_documents' }).check();
  await page.getByRole('checkbox', { name: 'gmail_send' }).check();
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/permissions$/);
  await nextButton(page).click();
  await expect(page).toHaveURL(/\/setup\/review$/);
  await page.getByRole('button', { name: 'Create agent' }).click();
  await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
  await page.getByRole('button', { name: 'Agent settings' }).click();
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await page.goto(`/agents/${id}`);
  await page.waitForLoadState('networkidle');
  return id;
}

export async function sendChat(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Ask anything…' }).fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
}

/** Opens the agent workspace's Settings drawer (status, lifecycle, configuration). */
export async function openSettings(page: Page) {
  const drawer = page.getByRole('dialog', { name: 'Agent settings' });
  // The drawer stays open (and updates) after lifecycle actions taken inside it.
  if (!(await drawer.isVisible()))
    await page.getByRole('button', { name: 'Agent settings' }).click();
  await expect(drawer).toBeVisible();
  return drawer;
}
