import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../module/${path}`, import.meta.url), 'utf8');
const css = read('styles.css'), theme = read('theme.css');

test('public theme resolves all colors locally without inheriting a mismatched upstream palette', () => {
  assert.match(theme, /\.truesight-theme \{/);
  assert.match(theme, /color-scheme: var\(--color-scheme, light\)/);
  assert.match(theme, /--ts-text: var\(--color-text-primary, light-dark\(#302831, #efe6d8\)\)/);
  for (const token of ['bg', 'muted', 'accent', 'field', 'menu-bg', 'hover', 'selected', 'selected-hover', 'warning', 'danger', 'preferred', 'primary-text']) {
    assert.ok(theme.includes(`--ts-${token}: light-dark(`), token);
  }
  assert.doesNotMatch(theme, /--qi|--si-/);
  assert.doesNotMatch(css, /--ts-[\w-]+\s*:/);
  assert.deepEqual(JSON.parse(read('module.json')).styles, ['theme.css', 'styles.css']);
  assert.match(read('scripts/review-window.mjs'), /classes:\['truesight-review','truesight-theme'\]/);
});

test('opaque native and custom menus use one shared surface, while the window paints once', () => {
  assert.match(theme, /--ts-menu-bg: light-dark\(#dddddd, #302831\);/);
  assert.match(theme, /\.truesight-theme select :is\(option, optgroup\) \{\s*color: var\(--ts-text\);\s*background-color: var\(--ts-menu-bg\);/);
  assert.match(css, /\.ts-menu \{[^}]*background:var\(--ts-menu-bg\);/);
  assert.match(css, /\.window-content \{[^}]*background:transparent;/);
});

test('generic controls have lower specificity than primary buttons at rest and on hover', () => {
  assert.match(css, /\.truesight-review :where\(\.ts-review\) :is\(button,input,select\)/);
  assert.match(css, /\.truesight-review :where\(\.ts-review\) button:hover:not\(:disabled\)/);
  assert.match(css, /\.truesight-review \.ts-primary \{ background:var\(--ts-accent\); color:var\(--ts-primary-text\);/);
  assert.match(css, /\.truesight-review \.ts-primary:hover:not\(:disabled\) \{ background:color-mix/);
});
