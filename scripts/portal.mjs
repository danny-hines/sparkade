// Android experiment tooling. Explicit serial selection avoids deploying to the wrong kiosk.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { portalSigning } from './portal-signing.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const project = join(root, 'apps/portal');
const command = process.argv[2] ?? 'doctor';
const standalone = command === 'provision' || process.argv.includes('--standalone');
const variant = standalone && !process.argv.includes('--debug') ? 'Release' : 'Debug';
const appId = standalone ? 'dev.sparkade.kiosk' : 'dev.sparkade.portal';
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');
const adb = existsSync(join(sdk, 'platform-tools/adb')) ? join(sdk, 'platform-tools/adb') : 'adb';
const run = (program, args, options = {}) =>
  execFileSync(program, args, { stdio: 'inherit', ...options });
const build = () => {
  run('npx', ['tsx', 'scripts/portal-assets.mts'], { cwd: root });
  run(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    [
      ...(standalone ? ['-Pstandalone'] : []),
      `test${variant}UnitTest`,
      `assemble${variant}`,
      `lint${variant}`,
    ],
    {
      cwd: project,
      env: {
        ...process.env,
        ...(existsSync(sdk) ? { ANDROID_HOME: sdk } : {}),
        ...(standalone ? { SPARKADE_PORTAL_SIGNING: portalSigning() } : {}),
      },
    },
  );
};

try {
  if (command === 'build') {
    build();
  } else if (['doctor', 'install', 'boot', 'boot-off', 'provision'].includes(command)) {
    const inventory = execFileSync(adb, ['devices', '-l'], { encoding: 'utf8' });
    console.log(inventory.trim());
    const devices = inventory
      .split('\n')
      .filter((line) => /^\S+\s+device\b/.test(line))
      .map((line) => line.split(/\s+/)[0]);
    const serialFlag = process.argv.indexOf('--serial');
    const serial =
      serialFlag >= 0
        ? process.argv[serialFlag + 1]
        : (process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0] : undefined));
    if (!serial || !devices.includes(serial)) {
      throw new Error(
        'Connect and authorize a Portal (Settings → Debug → ADB Enabled). With multiple devices, pass --serial SERIAL or set ANDROID_SERIAL.',
      );
    }
    const device = (...args) => run(adb, ['-s', serial, ...args]);
    const homeActivity = () =>
      execFileSync(
        adb,
        [
          '-s',
          serial,
          'shell',
          'cmd',
          'package',
          'resolve-activity',
          '--brief',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.HOME',
        ],
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .at(-1);
    const launcherBackup = join(
      root,
      'scratch/portal-devices',
      `${encodeURIComponent(serial)}.json`,
    );
    const sparkadeActivity = `${appId}/dev.sparkade.portal.MainActivity`;
    const isSparkadeHome = (value) =>
      value === sparkadeActivity || value === `${appId}/.MainActivity`;
    if (command === 'doctor') {
      for (const property of [
        'ro.product.model',
        'ro.build.version.release',
        'ro.build.version.sdk',
        'ro.product.cpu.abilist',
      ]) {
        console.log(property);
        device('shell', 'getprop', property);
      }
      device('shell', 'wm', 'size');
      device('shell', 'wm', 'density');
      device('shell', 'dumpsys', 'webviewupdate');
      console.log('Default Home:', homeActivity());
      console.log(
        'Installed Android speech recognition services (availability does not imply offline support):',
      );
      device(
        'shell',
        'cmd',
        'package',
        'query-services',
        '--brief',
        '-a',
        'android.speech.RecognitionService',
      );
      console.log('Default speech recognition service:');
      device('shell', 'settings', 'get', 'secure', 'voice_recognition_service');
    } else if (command === 'boot-off') {
      if (!existsSync(launcherBackup))
        throw new Error(
          `No saved Home activity for ${serial}. Use adb shell cmd package set-home-activity with your previous launcher.`,
        );
      const saved = JSON.parse(readFileSync(launcherBackup, 'utf8'));
      if (saved.serial !== serial || !saved.previousHome?.includes('/'))
        throw new Error('Invalid launcher backup.');
      device('shell', 'cmd', 'package', 'set-home-activity', '--user', '0', saved.previousHome);
      if (homeActivity() !== saved.previousHome)
        throw new Error('Android did not restore the saved default Home.');
      device(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.HOME',
      );
      console.log(`Restored Home: ${saved.previousHome}`);
    } else {
      // Installing a second HOME handler can reset Android's implicit choice.
      // Capture it before installation, and preserve it for normal installs.
      const previousHome = homeActivity();
      const hasPreviousHome =
        previousHome?.includes('/') && !previousHome.includes('ResolverActivity');
      if (hasPreviousHome && !isSparkadeHome(previousHome)) {
        mkdirSync(dirname(launcherBackup), { recursive: true });
        const saved = existsSync(launcherBackup)
          ? JSON.parse(readFileSync(launcherBackup, 'utf8'))
          : {};
        writeFileSync(
          launcherBackup,
          JSON.stringify({ ...saved, serial, previousHome }, null, 2) + '\n',
        );
      }
      if (
        ['boot', 'provision'].includes(command) &&
        !isSparkadeHome(previousHome) &&
        !existsSync(launcherBackup)
      ) {
        throw new Error('Choose a default Home app first so it can be restored later.');
      }
      build();
      device(
        'install',
        '-r',
        join(
          project,
          `app/build/outputs/apk/${variant.toLowerCase()}/app-${variant.toLowerCase()}.apk`,
        ),
      );
      if (standalone) {
        device('shell', 'pm', 'grant', appId, 'android.permission.CAMERA');
        device('shell', 'pm', 'grant', appId, 'android.permission.RECORD_AUDIO');
      }
      if (!standalone) device('reverse', 'tcp:8099', 'tcp:8099');
      if (command === 'boot' || command === 'provision') {
        device('shell', 'cmd', 'package', 'set-home-activity', '--user', '0', sparkadeActivity);
        if (!isSparkadeHome(homeActivity()))
          throw new Error('Android did not accept Sparkade as its default Home.');
        console.log(
          'Sparkade is now the default Home app and will open at boot. Undo with npm run portal:boot-off.',
        );
      } else if (hasPreviousHome) {
        device('shell', 'cmd', 'package', 'set-home-activity', '--user', '0', previousHome);
      }
      device('shell', 'am', 'start', '-S', '-n', sparkadeActivity);
      console.log(
        standalone
          ? 'Standalone Sparkade installed. Open Settings → Cloud to pair at https://sparkade.dev/admin/kiosks. No Mac server is required.'
          : 'Sparkade installed. Keep npm run portal:demo running for the USB experiment.',
      );
    }
  } else {
    throw new Error(
      'Usage: node scripts/portal.mjs doctor|build|install|boot|boot-off|provision [--serial SERIAL] [--standalone] [--debug]',
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
