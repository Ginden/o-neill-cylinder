import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // Assertions wait for the observed state (a new sample, a mode switch), not
  // for a time window: software rendering speed varies between machines and
  // runs. The test timeout only guards against hangs, so it is generous.
  timeout: 300000,
  expect: { timeout: 0 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width:1280,height:800 },
    // SwiftShader verifies physical paths at reduced pixel count; CSS layout is unchanged.
    deviceScaleFactor:0.25,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader']
    }
  },
  webServer: { command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true }
});
