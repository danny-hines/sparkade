// e2e web server wrapper: wipe the isolated data dir FIRST (Playwright starts
// the webServer before globalSetup, so cleanup must happen in-process here),
// then hand off to the normal demo script.
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
rmSync(join(root, '.e2e-data'), { recursive: true, force: true });

await import(pathToFileURL(join(root, 'scripts', 'demo.mjs')).href);
