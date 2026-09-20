// Maintainer-only packaging. Office installers consume these artifacts, never signing keys.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
const signing =
  process.env.SPARKADE_PORTAL_SIGNING ??
  join(homedir(), '.config/sparkade/portal/signing.properties');
if (!existsSync(signing))
  throw new Error(
    'Restore the fleet signing key before packaging. Office computers must not generate their own keys.',
  );
run('node', [
  '--test',
  'scripts/test/portal-installer.test.mjs',
  'scripts/test/portal-promote.test.mjs',
]);
run('node', ['scripts/portal.mjs', 'build', '--standalone'], {
  env: { ...process.env, SPARKADE_PORTAL_SIGNING: signing },
});
const build = join(root, 'apps/portal/app/build/outputs/apk/release');
const metadata = JSON.parse(readFileSync(join(build, 'output-metadata.json'), 'utf8'));
if (
  metadata.applicationId !== 'dev.sparkade.kiosk' ||
  metadata.variantName !== 'release' ||
  metadata.elements.length !== 1
) {
  throw new Error('Expected exactly one standalone release APK.');
}
const app = metadata.elements[0];
if (!/^\d+\.\d+\.\d+$/.test(app.versionName)) throw new Error('Expected a stable release version.');
const tag = `portal-v${app.versionName}`;
const apk = join(build, app.outputFile);
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');
const buildTools = join(sdk, 'build-tools/35.0.0');
const cert = run(join(buildTools, 'apksigner'), ['verify', '--print-certs', apk], {
  stdio: 'pipe',
  encoding: 'utf8',
});
const expectedCert = readFileSync(
  join(root, 'apps/portal/release-certificate.sha256'),
  'utf8',
).trim();
if (
  !/^[a-f0-9]{64}$/.test(expectedCert) ||
  !cert.includes(`certificate SHA-256 digest: ${expectedCert}`)
) {
  throw new Error('APK is not signed with the Sparkade fleet key. Do not distribute it.');
}
const apkInfo = run(join(buildTools, 'aapt'), ['dump', 'badging', apk], {
  stdio: 'pipe',
  encoding: 'utf8',
});
if (apkInfo.includes('application-debuggable'))
  throw new Error('Refusing to distribute a debuggable APK.');
const source = readFileSync(join(root, 'scripts/install-portal.sh'), 'utf8');
if (!source.includes(`RELEASE=${tag}\n`))
  throw new Error(`Update install-portal.sh to ${tag} before packaging.`);
const directory = join(root, 'scratch/portal-releases', tag);
mkdirSync(directory, { recursive: true });
copyFileSync(apk, join(directory, 'sparkade-portal.apk'));
const hash = createHash('sha256').update(readFileSync(apk)).digest('hex');
writeFileSync(join(directory, 'sparkade-portal.apk.sha256'), `${hash}  sparkade-portal.apk\n`);
copyFileSync(join(root, 'scripts/install-portal.sh'), join(directory, 'install-portal.sh'));
copyFileSync(join(root, 'docs/portal-setup.md'), join(directory, 'portal-setup.md'));
const commit = run('git', ['rev-parse', 'HEAD'], { stdio: 'pipe', encoding: 'utf8' }).trim();
const dirty =
  run('git', ['status', '--porcelain'], { stdio: 'pipe', encoding: 'utf8' }).trim() !== '';
writeFileSync(
  join(directory, 'release.json'),
  JSON.stringify(
    {
      tag,
      applicationId: metadata.applicationId,
      version: app.versionName,
      versionCode: app.versionCode,
      apkSha256: hash,
      apkBytes: readFileSync(apk).length,
      signingCertificateSha256: expectedCert,
      sourceCommit: commit,
      sourceDirty: dirty,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `\nPrepared ${tag}: ${directory}\nAPK SHA-256: ${hash}\nPublish these files together only after hardware verification. Keep published tags/assets immutable.`,
);
if (dirty)
  console.log(
    'Source has uncommitted changes. Commit the release source and repackage before publishing.',
  );
