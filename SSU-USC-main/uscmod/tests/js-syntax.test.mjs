import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectJs(dir) {
  const out=[];
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) out.push(...collectJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('all project JavaScript parses successfully', () => {
  const failures=[];
  for (const file of collectJs(root)) {
    const relative = path.relative(root, file);
    const temp = path.join(os.tmpdir(), `usc-syntax-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`);
    fs.copyFileSync(file, temp);
    const result=spawnSync(process.execPath,['--check',temp],{encoding:'utf8'});
    fs.unlinkSync(temp);
    if (result.status !== 0) failures.push(`${relative}\n${result.stderr}`);
  }
  assert.deepEqual(failures, []);
});
