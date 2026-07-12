// Tiny cross-platform process helpers shared by dev/demo/build/verify scripts.
// Zero dependencies on purpose (the allowed-deps list is strict).
import { spawn, spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';

/**
 * Kill a child AND its descendants. On Windows, child.kill() only takes out
 * the cmd.exe shim that `shell: true` wraps around npx — the real node
 * process underneath survives as an orphan (a dead API server with a live
 * Vite is exactly how that bug presents). taskkill /T kills the whole tree.
 */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (isWin) {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Spawn a command, inherit stdio, resolve/reject on exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: isWin, // npm/npx are .cmd shims on Windows
      ...opts,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

/** Spawn a long-running command; returns the child. Caller wires shutdown. */
export function launch(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: isWin,
    ...opts,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return child;
}

/** Kill a set of children (and their trees) and exit when the first one dies or on Ctrl-C. */
export function superviseAll(children) {
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (code !== 0) {
      console.error('\none process exited — shutting the others down (see error above)');
    }
    for (const c of children) killTree(c);
    // Give children a moment to exit cleanly.
    setTimeout(() => process.exit(code), 700).unref();
  };
  for (const c of children) {
    c.on('exit', (code) => shutdown(code ?? 0));
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}
