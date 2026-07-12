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
  try {
    let res: Response;
    try {
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
      throw new ProviderNetworkError(`network error calling ${new URL(url).host}: ${msg}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
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
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
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
