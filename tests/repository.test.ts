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
