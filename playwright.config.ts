import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';

const appRoot=path.resolve(process.cwd(),process.env.PLAYWRIGHT_APP_ROOT||'.');
export default defineConfig({
 testDir:'./e2e',
 testMatch:'**/*.spec.ts',
 timeout:60_000,
 expect:{timeout:12_000},
 retries:process.env.CI?1:0,
 workers:process.env.CI?2:undefined,
 reporter:[['list'],['html',{outputFolder:'artifacts/playwright-report',open:'never'}]],
 outputDir:'artifacts/test-results',
 use:{
  ...devices['Desktop Chrome'],
  baseURL:'http://127.0.0.1:4173',
  screenshot:'only-on-failure',
  trace:'retain-on-failure',
  video:'retain-on-failure',
  reducedMotion:'reduce',
  locale:'zh-CN',
  timezoneId:'Asia/Shanghai',
 },
 webServer:{
  command:'npx vite --config web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort',
  cwd:appRoot,
  url:'http://127.0.0.1:4173',
  timeout:90_000,
  reuseExistingServer:!process.env.CI,
 },
});
