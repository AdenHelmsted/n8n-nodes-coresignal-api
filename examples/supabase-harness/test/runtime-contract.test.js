import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The user removed the physical line ceiling. Preserve the dependency constraint
// instead of rewarding dense code or counting test/documentation lines.
test('production keeps the official Supabase SDK as its only direct dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['@supabase/supabase-js']);
  assert.deepEqual(Object.keys(manifest.devDependencies || {}), []);
  assert.deepEqual(Object.keys(manifest.optionalDependencies || {}), []);
});
