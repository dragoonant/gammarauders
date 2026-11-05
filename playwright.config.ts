import { defineConfig } from '@playwright/test';

// Each checkout gets its own port (KB gotchas: port reuse serves a stale sibling build).
const port = Number(process.env.PW_PORT ?? 4317);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  workers: 1,
  outputDir: 'e2e-out',
  use: { baseURL: `http://localhost:${port}/` },
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
