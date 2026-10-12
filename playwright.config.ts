import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width:1280,height:800 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader']
    }
  },
  webServer: { command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true }
});
