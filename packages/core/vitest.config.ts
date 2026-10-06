import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one test database.
    fileParallelism: false,
  },
});
