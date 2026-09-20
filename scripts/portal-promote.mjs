// Only channel pointers are mutable. Versioned APKs/tags are never overwritten.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const channel = args.includes('--channel') ? value('--channel') : '';
const tag = args.includes('--release') ? value('--release') : '';
const disabled = args.includes('--disable');
if (!['stable', 'pilot'].includes(channel) || (!disabled && !/^portal-v\d+\.\d+\.\d+$/.test(tag)))
  throw new Error(
    'Usage: node scripts/portal-promote.mjs --channel stable|pilot (--release portal-vX.Y.Z | --disable) [--publish]',
  );
const dir = mkdtempSync(join(tmpdir(), 'sparkade-promote-'));
const gh = (args) =>
  execFileSync('gh', [...args, '--repo', 'danny-hines/sparkade'], { encoding: 'utf8' });
try {
  let manifest = { channel, disabled: true };
  if (!disabled) {
    gh([
      'release',
      'download',
      tag,
      '--pattern',
      'release.json',
      '--pattern',
      'sparkade-portal.apk',
      '--dir',
      dir,
    ]);
    const release = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
    const apk = readFileSync(join(dir, 'sparkade-portal.apk'));
    if (
      release.tag !== tag ||
      `portal-v${release.version}` !== tag ||
      release.sourceDirty ||
      release.applicationId !== 'dev.sparkade.kiosk' ||
      !Number.isSafeInteger(release.versionCode) ||
      release.versionCode <= 0 ||
      release.apkBytes !== apk.length ||
      release.apkSha256 !== createHash('sha256').update(apk).digest('hex') ||
      release.signingCertificateSha256 !==
        readFileSync(
          new URL('../apps/portal/release-certificate.sha256', import.meta.url),
          'utf8',
        ).trim()
    )
      throw new Error(
        'Release metadata/size/hash/signing identity is invalid; refusing promotion.',
      );
    manifest = { ...release, channel };
  }
  const file = join(dir, 'release.json');
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
  if (!args.includes('--publish')) {
    console.log('Validated only. Add --publish to update the channel pointer.');
  } else {
    const pointer = `portal-channel-${channel}`;
    let exists = false;
    try {
      gh(['release', 'view', pointer, '--json', 'tagName']);
      exists = true;
    } catch {
      /* The first promotion creates the channel. Upload/create failures still abort. */
    }
    if (exists) gh(['release', 'upload', pointer, file, '--clobber']);
    else
      gh([
        'release',
        'create',
        pointer,
        file,
        '--target',
        manifest.sourceCommit ?? 'main',
        '--prerelease',
        '--latest=false',
        '--title',
        `Portal updates · ${channel}`,
        '--notes',
        'Mutable update-channel pointer. Versioned APKs are published separately and remain immutable.',
      ]);
    console.log(`Published ${channel}: ${disabled ? 'paused' : tag}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
