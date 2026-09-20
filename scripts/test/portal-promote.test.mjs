import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const script = resolve('scripts/portal-promote.mjs');
function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'portal-promotion-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const apk = 'signed-artifact-fixture';
  const manifest = {
    tag: 'portal-v0.4.0',
    applicationId: 'dev.sparkade.kiosk',
    version: '0.4.0',
    versionCode: 6,
    apkSha256: createHash('sha256').update(apk).digest('hex'),
    apkBytes: Buffer.byteLength(apk),
    sourceDirty: false,
    signingCertificateSha256: readFileSync('apps/portal/release-certificate.sha256', 'utf8').trim(),
    ...overrides,
  };
  const log = join(directory, 'calls.jsonl');
  writeFileSync(log, '');
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const cfg = JSON.parse(process.env.PROMOTE_FIXTURE);
fs.appendFileSync(cfg.log, JSON.stringify(args) + '\\n');
if (args[1] === 'download') {
 const dir = args[args.indexOf('--dir') + 1];
 fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(cfg.manifest));
 fs.writeFileSync(path.join(dir, 'sparkade-portal.apk'), cfg.apk);
}
if (args[1] === 'upload') fs.writeFileSync(cfg.output, fs.readFileSync(args[3]));
`,
    { mode: 0o755 },
  );
  const output = join(directory, 'published.json');
  const run = (extra = []) =>
    spawnSync(
      process.execPath,
      [script, '--channel', 'pilot', '--release', 'portal-v0.4.0', ...extra],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PROMOTE_FIXTURE: JSON.stringify({ apk, manifest, log, output }),
        },
      },
    );
  return {
    run,
    calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    output,
  };
}
test('promotion validates a release without changing a channel by default', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!f.calls().some((a) => ['upload', 'create'].includes(a[1])));
});
test('mismatched APK metadata prevents publishing', (t) => {
  const f = fixture(t, { apkSha256: '0'.repeat(64) });
  assert.equal(f.run(['--publish']).status, 1);
  assert.ok(!f.calls().some((a) => ['upload', 'create'].includes(a[1])));
});
test('publish only replaces the selected channel pointer, never the versioned release', (t) => {
  const f = fixture(t);
  const result = f.run(['--publish']);
  assert.equal(result.status, 0, result.stderr);
  const uploads = f.calls().filter((a) => a[1] === 'upload');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][2], 'portal-channel-pilot');
  assert.equal(JSON.parse(readFileSync(f.output, 'utf8')).channel, 'pilot');
});
test('a channel can be paused without fetching or removing its versioned APK', (t) => {
  const f = fixture(t);
  assert.equal(f.run(['--disable', '--publish']).status, 0);
  assert.ok(!f.calls().some((a) => a[1] === 'download' || a[1] === 'delete'));
  assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')), {
    channel: 'pilot',
    disabled: true,
  });
});
