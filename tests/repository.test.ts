import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('README links to the configured instance origin', () => {
  const config = JSON.parse(read('wrangler.jsonc')) as { vars: { APP_ORIGIN: string } };
  const origin = config.vars.APP_ORIGIN;
  assert.match(origin, /^https:\/\/[^/]+$/);
  assert.ok(read('README.md').includes('](' + origin + ')'));
});

test('UI stylesheet imports the shared semantic design tokens', () => {
  const css = read('web/src/style.css');
  const tokens = read('web/src/tokens.css');
  assert.ok(css.startsWith('@import "./tokens.css";'));
  for (const name of ['--radar-bg', '--radar-surface', '--radar-text', '--radar-accent', '--radar-focus']) {
    assert.ok(tokens.includes(name + ':'), 'Missing token ' + name);
    assert.ok(css.includes('var(' + name + ')'), 'Unused core design token ' + name);
  }
  assert.ok(css.includes(':focus-visible'), 'Keyboard focus indicator required');
  assert.ok(css.includes('prefers-reduced-motion'), 'Reduced motion required');
});

test('GitHub Actions is the sole automated production deployment path', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /DEPLOY_VIA_GITHUB_ACTIONS/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /wrangler d1 migrations apply DB --remote/);
  assert.match(workflow, /wrangler deploy --config wrangler\.deploy\.json --secrets-file/);
  assert.match(workflow, /Smoke-test deployed Worker/);
});

test('React SPA assets are served directly instead of through the Worker catch-all', () => {
  const config = JSON.parse(read('wrangler.jsonc')) as {
    assets: { directory: string; binding: string; not_found_handling: string; run_worker_first: string[] };
  };
  assert.equal(config.assets.directory, './web/dist');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*', '/feed.xml']);
});

test('redesigned overview reports real Provider scan coverage', () => {
  const main = read('web/src/main.tsx');
  const styles = read('web/src/style.css');
  assert.match(main, /provider_scanned/);
  assert.match(main, /role="progressbar"/);
  assert.match(main, /aria-pressed=/);
  assert.match(main, /查看项目|在 GitHub 查看项目/);
  assert.match(styles, /\.radar-visual/);
  assert.match(styles, /\.overview-grid/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});
