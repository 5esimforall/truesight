import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {readModules, files, root} from './workspace.mjs';

const modules = await readModules();
for (const directory of ['module', 'tools', 'tests']) {
  for await (const path of files(join(root, directory))) {
    if (path.endsWith('.mjs')) execFileSync(process.execPath, ['--check', path], {stdio: 'inherit'});
  }
}
console.log('Checked manifests and JavaScript for ' + modules.map(m => m.manifest.id).join(', '));
