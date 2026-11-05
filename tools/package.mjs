import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {readModules, root} from './workspace.mjs';

export async function packageModules(destination = join(root, 'dist')) {
  const archives = [];
  await mkdir(destination, {recursive: true});
  for (const {directory, manifest: {id, version}} of await readModules()) {
    const archive = join(destination, id + '-v' + version + '.zip');
    const stage = await mkdtemp(join(tmpdir(), id + '-'));
    try {
      await cp(directory, join(stage, id), {recursive: true});
      execFileSync('zip', ['-qr', 'module.zip', id, '-x', '*/.DS_Store'], {cwd: stage});
      await cp(join(stage, 'module.zip'), archive);
    } finally {
      await rm(stage, {recursive: true, force: true});
    }
    archives.push(archive);
  }
  return archives;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const archive of await packageModules()) console.log(archive);
}
