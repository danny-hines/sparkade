import { providerRequestPolicy, type ProviderRequestSettlement } from './request-policy';
import { AsyncLocalStorage } from 'node:async_hooks';

// Resolved inside a server request/workflow step. Never put raw keys in configs,
// provider instances (which are shared), durable inputs, or process.env.
const credentials = new AsyncLocalStorage<{ metaApiKey: string | null }>();
export function withMetaApiKey<T>(key: string | null, work: () => Promise<T>): Promise<T> {
  return credentials.run({ metaApiKey: key }, work);
}

function redactCredential(value: string): string {
  const key = credentials.getStore()?.metaApiKey;
  return key ? value.split(key).join('[redacted]') : value;
}
// Shared provider plumbing: typed HTTP errors + a fetch helper with timeout.
// Transient-retry policy lives in the pipeline (uniform for all providers).

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds, from a Retry-After header if present. */
    readonly retryAfterS: number | null,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }

  get transient(): boolean {
    // 408 is this client's own per-call timeout — the spec mandates retrying
    // timeouts with backoff just like 429/5xx.
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Network-level failure (DNS, refused, offline) — the job should wait, not die. */
export class ProviderNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNetworkError';
  }
}

export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export interface HttpJsonOpts {
  method?: string;
  headers: Record<string, string>;
  body?: string | FormData;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function httpJson<T>(url: string, opts: HttpJsonOpts): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  let settle: ProviderRequestSettlement | undefined;
  let dispatched = false;
  try {
    if (opts.signal?.aborted) throw new Error('aborted');
    const policy = providerRequestPolicy.getStore();
    settle = policy ? await policy(url, opts.body, { timeoutMs: opts.timeoutMs }) : undefined;
    if (opts.signal?.aborted) throw new Error('aborted');
    if (controller.signal.aborted) throw new ProviderHttpError('request timed out', 408, null, '');
    let res: Response;
    try {
      dispatched = true;
      res = await fetch(url, {
        method: opts.method ?? 'POST',
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (opts.signal?.aborted) throw new Error('aborted');
      if (controller.signal.aborted) {
        throw new ProviderHttpError('request timed out', 408, null, '');
      }
      throw new ProviderNetworkError(
        `network error calling ${new URL(url).host}: ${redactCredential(msg)}`,
      );
    }
    if (!res.ok) {
      const body = redactCredential(await res.text().catch(() => ''));
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(`provider rejected the API key (HTTP ${res.status})`);
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterS = retryAfterHeader ? Number(retryAfterHeader) || null : null;
      throw new ProviderHttpError(
        `provider HTTP ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        retryAfterS,
        body,
      );
    }
    const result = (await res.json()) as T;
    await settle?.(result);
    return result;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    if (!dispatched) await settle?.cancel?.();
    else await settle?.finish?.();
  }
}

export function apiKeyFor(envName: string | undefined, providerName: string): string {
  if (!envName) throw new ProviderAuthError(`provider "${providerName}" has no apiKeyEnv configured`);
  const key = process.env[envName];
  if (!key) {
    throw new ProviderAuthError(
      `missing API key: set ${envName} in the env file (see .env.example / /etc/sparkade/env)`,
    );
  }
  return key;
}

/** Only Meta adapters may consult this context; other providers keep their own keys. */
export function metaApiKeyFor(envName: string, providerName: string): string {
  const key = credentials.getStore()?.metaApiKey;
  if (key === '') throw new ProviderAuthError('The kiosk Meta credential is unavailable.');
  return key ?? apiKeyFor(envName, providerName);
}
