import { defineConfig } from '@playwright/test';

// Port 3000 is routinely occupied by other local dev servers on this
// machine, so the E2E suite runs against 3100 instead. `next start`
// (invoked below) reads the `PORT` env var, so this one constant drives
// both the server it boots and the requests Playwright makes against it.
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run build && PORT=${PORT} npm start`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
