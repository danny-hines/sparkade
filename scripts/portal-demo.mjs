// Keep experiment games/config separate from the Mac and Pi, with no cloud publishing.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maintainPortalUsb } from './portal-usb.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
Object.assign(process.env, {
  SPARKADE_DATA: join(root, 'scratch/portal-data'),
  SPARKADE_PORT: '8099',
  SPARKADE_BIND: '127.0.0.1',
  SPARKADE_GENERATION_MODE: 'local',
  SPARKADE_PUBLIC_ORIGIN: '',
  SPARKADE_KIOSK_API_KEY: '',
  SPARKADE_MOCK_FAST: '1',
});
process.argv.push('--fresh');
maintainPortalUsb();
await import('./demo.mjs');
