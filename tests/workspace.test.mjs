import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {readModules, files, root} from '../tools/workspace.mjs';
import {packageModules} from '../tools/package.mjs';

test('foundation is independently installable without adapter or search UI dependencies', async () => {
  const modules = await readModules();
  assert.deepEqual(modules.map(m => m.manifest.id), ['truesight']);
  const [{directory, manifest}] = modules;
  assert.deepEqual(manifest.relationships.requires.map(r => r.id), ['quick-insert']);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).name, 'truesight');
  for await (const path of files(directory)) {
    if (!path.endsWith('.mjs')) continue;
    const content = await readFile(path, 'utf8');
    for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), 'No unbundled dependency: ' + match[1]);
      const target = resolve(path, '..', match[1]);
      assert.ok(!relative(directory, target).startsWith('..'), 'External source import: ' + path);
      await readFile(target);
    }
    if (path.includes('/names/')) assert.doesNotMatch(content, /chris-premades|gambits-premades|midi-item-showcase-community|renamedItems|cprNames/);
  }
});

test('release ZIP uses the Foundry module ID rather than the development directory name', async t => {
  const out = await mkdtemp(join(tmpdir(), 'truesight-package-test-'));
  t.after(() => rm(out, {recursive: true, force: true}));
  const [{manifest}] = await readModules();
  const archives = await packageModules(out);
  assert.equal(archives.length, 1);
  const [archive] = archives;
  const listing = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).trim().split('\n');
  assert.ok(listing.every(path => path.startsWith('truesight/')));
  assert.deepEqual(JSON.parse(execFileSync('unzip', ['-p', archive, 'truesight/module.json'], {encoding: 'utf8'})), manifest);
  for (const path of ['api-v1.mjs', 'scripts/main.mjs', 'theme.css', 'styles.css', 'lang/en.json', 'lang/cn.json']) {
    assert.ok(listing.includes('truesight/' + path));
  }
  assert.ok(!listing.some(path => path.includes('/tests/') || path.endsWith('.DS_Store')));
});
