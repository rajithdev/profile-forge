// Rebuilds examples/<theme>/ from the sample config, once per built-in theme.
// Used for the previews in this project's README.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../src/themes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const theme of Object.keys(THEMES)) {
  rmSync(`${root}examples/${theme}`, { recursive: true, force: true });
  execFileSync(process.execPath, ['build.mjs', '--theme', theme, '--out', `examples/${theme}`], { cwd: root, stdio: 'inherit' });
}
