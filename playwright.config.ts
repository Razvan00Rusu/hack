import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests/ui', use: {baseURL:'http://localhost:3000', headless:true, launchOptions: {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}}, webServer:{command:'pnpm dev --hostname localhost',url:'http://localhost:3000',reuseExistingServer:!process.env.CI,timeout:120000} });
