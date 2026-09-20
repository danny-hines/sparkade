import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const installer = resolve('scripts/install-portal.sh');
const fakeAdb = `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(process.env.SPARKADE_TEST_CONFIG);
let args = process.argv.slice(2);
fs.appendFileSync(cfg.log, JSON.stringify(args) + '\\n');
if (args[0] === '-s') args = args.slice(2);
const cmd = args.join(' ');
const out = value => process.stdout.write(value + '\\n');
if (cmd === 'version') out('Android Debug Bridge version 1.0.41');
else if (cmd === 'devices -l') out('List of devices attached\\nTESTPORTAL device usb:1 model:Portal_\\nUNAUTHORIZED unauthorized usb:2');
else if (cmd === 'shell getprop ro.product.model') out(cfg.model || 'Portal+');
else if (cmd === 'shell getprop ro.build.version.sdk') out('28');
else if (cmd === 'shell getprop ro.serialno') out('TESTPORTAL');
else if (cmd === 'shell df -k /data') out('Filesystem 1K-blocks Used Available Use% Mounted on\\n/data 9000000 1000000 8000000 10% /data');
else if (cmd.includes('resolve-activity')) out(fs.existsSync(cfg.home) ? fs.readFileSync(cfg.home, 'utf8') : 'com.meta.launcher/.Home');
else if (cmd.includes('set-home-activity')) fs.writeFileSync(cfg.home, args.at(-1));
else if (args[0] === 'install') {
  if (cfg.installFail) { out('INSTALL_FAILED_UPDATE_INCOMPATIBLE'); process.exit(1); }
  out('Success');
} else if (cmd === 'shell dumpsys package dev.sparkade.kiosk') out('versionName=0.4.1\\nflags=[ HAS_CODE ' + (cfg.debug ? 'DEBUGGABLE' : '') + ' ]');
else if (cmd === 'shell pm list packages -e ai.wondry.portal') { if (cfg.wondry) out('package:ai.wondry.portal'); }
else if (cmd.includes('SETUP_STATUS')) out('Broadcast completed: result=-1, data="SPARKADE_SETUP_V1;state=' + (cfg.state || 'registered') + ';code=ABCD-2345;version=0.4.1;origin=https://sparkade.dev;"');
else out('OK');
`;

function fixture(t, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-installer-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'adb'), fakeAdb, { mode: 0o755 });
  const apk = join(dir, 'test.apk');
  writeFileSync(apk, 'fixture: no real device or network is used');
  const sha = createHash('sha256').update(readFileSync(apk)).digest('hex');
  const state = join(dir, 'setup');
  const cfg = { log: join(dir, 'adb.jsonl'), home: join(dir, 'home'), ...config };
  const run = (extra = [], defaults = true) =>
    spawnSync(
      'bash',
      [
        installer,
        '--non-interactive',
        '--serial',
        'TESTPORTAL',
        '--adb',
        join(bin, 'adb'),
        ...(defaults ? ['--apk', apk, '--sha256', sha] : []),
        ...extra,
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SPARKADE_PORTAL_SETUP_DIR: state,
          SPARKADE_TEST_CONFIG: JSON.stringify(cfg),
        },
      },
    );
  const calls = () =>
    existsSync(cfg.log) ? readFileSync(cfg.log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { run, calls, state, cfg, apk };
}

test('a signed-release install grants media, sets Home, confirms registration and preserves recovery on rerun', (t) => {
  const f = fixture(t);
  let result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const backup = join(f.state, 'devices/TESTPORTAL/previous-home.txt');
  assert.equal(readFileSync(backup, 'utf8'), 'com.meta.launcher/.Home\n');
  assert.match(result.stdout, /Production registration confirmed/);
  result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(backup, 'utf8'), 'com.meta.launcher/.Home\n');
  assert.ok(
    f
      .calls()
      .some((a) => a.join(' ').includes('pm grant dev.sparkade.kiosk android.permission.CAMERA')),
  );
  assert.ok(!f.calls().some((a) => /uninstall|clear|tcpip|reverse/.test(a.join(' '))));
  assert.match(
    readFileSync(join(f.state, 'devices/TESTPORTAL/result.txt'), 'utf8'),
    /registration=registered/,
  );
});
test('wrong APK hash stops before any device changes', (t) => {
  const f = fixture(t);
  const result = f.run(['--sha256', '0'.repeat(64)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum mismatch/);
  assert.ok(!f.calls().some((a) => a.includes('shell') || a.includes('install')));
});
test('unavailable/unauthorized explicit serial is never replaced by another connected device', (t) => {
  const f = fixture(t);
  const result = f.run(['--serial', 'UNAUTHORIZED']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unavailable or unauthorized/);
  assert.ok(!f.calls().some((a) => a.includes('install')));
});
test('a phone cannot be provisioned accidentally', (t) => {
  const f = fixture(t, { model: 'Pixel 9' });
  assert.equal(f.run().status, 1);
  assert.ok(!f.calls().some((a) => a.includes('install')));
});
test('signature mismatch never falls back to uninstalling or resetting the kiosk', (t) => {
  const f = fixture(t, { installFail: true });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /do NOT uninstall or clear data/);
  assert.ok(!f.calls().some((a) => /uninstall|clear|set-home-activity/.test(a.join(' '))));
});
test('a debug build cannot be reported as provisioned', (t) => {
  const f = fixture(t, { debug: true });
  assert.equal(f.run().status, 1);
  assert.ok(!f.calls().some((a) => a.join(' ').includes('set-home-activity')));
});
test('pairing is an explicit incomplete result and prints the admin code without claiming registration', (t) => {
  const f = fixture(t, { state: 'pairing' });
  const result = f.run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /ABCD-2345/);
  assert.match(result.stdout, /https:\/\/sparkade.dev\/admin\/kiosks/);
  assert.doesNotMatch(result.stdout, /Setup complete|Production registration confirmed/);
  assert.doesNotMatch(
    readFileSync(join(f.state, 'devices/TESTPORTAL/result.txt'), 'utf8'),
    /ABCD-2345/,
  );
});
test('revoked enrollment is not automatically replaced', (t) => {
  const f = fixture(t, { state: 'revoked' });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /will not silently replace/);
});
test('retired Wondry needs an explicit operator choice and keeps its data', (t) => {
  const f = fixture(t, { wondry: true });
  assert.equal(f.run().status, 1);
  assert.ok(!f.calls().some((a) => a.includes('disable-user')));
  const result = f.run(['--disable-wondry']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(
    f.calls().some((a) => a.join(' ').includes('pm disable-user --user 0 ai.wondry.portal')),
  );
  assert.ok(!f.calls().some((a) => a.includes('uninstall')));
});
test('launcher recovery uses the original backup without deleting Sparkade', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = f.run(['--restore-home'], false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(f.cfg.home, 'utf8'), 'com.meta.launcher/.Home');
});
