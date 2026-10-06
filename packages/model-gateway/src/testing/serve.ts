// Runs the fake provider as a standalone server (Playwright starts it for E2E tests).
import { startFakeProvider } from './fake-provider';

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);
const { ready } = startFakeProvider({ port });
const { url } = await ready;
console.log(`fake provider listening on ${url}`);
