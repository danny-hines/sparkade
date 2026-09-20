import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One private signing key per operator installation, retained across APK updates. */
export function portalSigning() {
  if (process.env.SPARKADE_PORTAL_SIGNING) return process.env.SPARKADE_PORTAL_SIGNING;
  const directory = join(homedir(), '.config/sparkade/portal');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const properties = join(directory, 'signing.properties');
  const keystore = join(directory, 'release.p12');
  if (existsSync(properties)) {
    if (!existsSync(keystore))
      throw new Error(
        'Portal signing key is missing. Restore its backup before building an update.',
      );
    return properties;
  }
  if (existsSync(keystore))
    throw new Error(
      'Portal keystore already exists without signing.properties. Restore the properties file instead of replacing the key.',
    );
  const password = randomBytes(32).toString('hex');
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/keytool') : 'keytool';
  execFileSync(
    keytool,
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storetype',
      'PKCS12',
      '-storepass:env',
      'SPARKADE_SIGNING_PASSWORD',
      '-keypass:env',
      'SPARKADE_SIGNING_PASSWORD',
      '-alias',
      'sparkade',
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-validity',
      '10000',
      '-dname',
      'CN=Sparkade Kiosk',
    ],
    { stdio: 'pipe', env: { ...process.env, SPARKADE_SIGNING_PASSWORD: password } },
  );
  chmodSync(keystore, 0o600);
  writeFileSync(
    properties,
    `storeFile=${keystore}\nstorePassword=${password}\nkeyAlias=sparkade\nkeyPassword=${password}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Created Portal release signing key in ${directory}. Keep a secure backup for future updates.`,
  );
  return properties;
}
