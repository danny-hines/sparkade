// Keep demo forwarding on one selected ADB transport (USB serial or Wi-Fi address).
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export function maintainPortalUsb() {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    join(homedir(), 'Library/Android/sdk');
  const adb = existsSync(join(sdk, 'platform-tools/adb')) ? join(sdk, 'platform-tools/adb') : 'adb';
  const flag = process.argv.indexOf('--serial');
  let serial = flag >= 0 ? process.argv[flag + 1] : process.env.ANDROID_SERIAL;
  try {
    if (!serial) {
      const devices = execFileSync(adb, ['devices'], { encoding: 'utf8', timeout: 3000 })
        .split('\n')
        .filter((line) => /^\S+\s+device\b/.test(line))
        .map((line) => line.split(/\s+/)[0]);
      if (devices.length === 1) serial = devices[0];
    }
  } catch {
    // A desktop-only preview still works without Android tools.
  }
  if (!serial) {
    console.log(
      'ADB auto-forwarding inactive. Connect one authorized device before starting, or pass --serial SERIAL.',
    );
    return;
  }
  console.log(`Maintaining ADB demo connection for ${serial}.`);
  const execute = promisify(execFile);
  let busy = false;
  const restore = async () => {
    if (busy) return;
    busy = true;
    try {
      const { stdout } = await execute(adb, ['-s', serial, 'reverse', '--list'], { timeout: 2500 });
      if (!/\btcp:8099\s+tcp:8099\b/.test(stdout)) {
        await execute(adb, ['-s', serial, 'reverse', 'tcp:8099', 'tcp:8099'], { timeout: 2500 });
        console.log('Portal ADB forwarding restored.');
      }
    } catch {
      // Device may be off, unplugged, or awaiting authorization; retry quietly.
    } finally {
      busy = false;
    }
  };
  void restore();
  setInterval(() => void restore(), 3000).unref();
}
