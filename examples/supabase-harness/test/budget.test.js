import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('all production JavaScript stays under the 750 physical line budget', async () => {
  const root = new URL('../', import.meta.url), ignored = new Set(['.git', '.upstream', '.cache', 'node_modules', 'test', 'runs', 'docs']);
  let lines = 0;
  const scan = async folder => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, folder);
      if (entry.isDirectory() && !ignored.has(entry.name)) await scan(file);
      else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
        const source = await readFile(file, 'utf8');
        lines += source.split('\n').length - Number(source.endsWith('\n'));
      }
    }
  };
  await scan(root);
  assert.ok(lines < 750, `${lines} production lines; limit is strictly below 750`);
});
