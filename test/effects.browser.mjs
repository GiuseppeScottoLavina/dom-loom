// Runs every effect suite (test/effects-*.browser.mjs), each in its own process, and
// fails if any of them fails: one failing file does not hide the others.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir).filter((f) => /^effects-.+\.browser\.mjs$/.test(f)).sort();
let failed = 0;
for (const file of files) {
  console.log(`\n# ${file}`);
  const run = spawnSync(process.execPath, [dir + file, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (run.status !== 0) failed++;
}
if (failed) {
  console.log(`\n${failed} of ${files.length} effect suites failed`);
  process.exit(1);
}
