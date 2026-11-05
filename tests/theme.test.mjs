import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../module/styles.css',import.meta.url),'utf8');
test('Truesight inherits Foundry color scheme and reads the same palette as Slow Insert',()=>{
 assert.match(css,/color-scheme: var\(--color-scheme, light\)/);
 assert.match(css,/--ts-bg: var\(--qiBackground, light-dark\(#dddddde3, #302831e3\)\)/);
 assert.match(css,/--ts-text: var\(--color-text-primary, light-dark\(#302831, #efe6d8\)\)/);
 assert.match(css,/--ts-selected: var\(--qiItemSelectedColor,/);
 assert.doesNotMatch(css,/color-scheme:\s*(?:light|dark)\s*;|--qi\w+\s*:|--si-/);
});
test('review states and native controls use theme-aware semantic colors',()=>{
 for(const name of ['danger','warning','selected','selected-hover','focus','primary-text'])assert.ok(css.includes(`var(--ts-${name})`));
 assert.match(css,/:is\(button,input,select\)/);
 assert.match(css,/\.window-header :is\(\.window-title,\.header-control\)/);
 assert.match(css,/select option \{[^}]*light-dark\(/);
 assert.doesNotMatch(css,/#eeecef|#e3dfe7|#a73333|#bd843a|color:white/);
});
