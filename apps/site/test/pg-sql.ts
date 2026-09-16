// Local pg-backed client honoring the Neon tagged-template contract used by
// lib/invites.ts: lazy query objects (execution starts on await, mirroring
// NeonQueryPromise), .query(text, params?) for raw SQL, .unsafe() for
// interpolation-only fragments, and .transaction([...]) running the batch in
// one BEGIN/COMMIT block. Test-only helper: never imported by app code.
interface PgResultLike {
  rows: Record<string, unknown>[];
}

interface PgClientLike {
  query: (text: string, params?: unknown[]) => Promise<PgResultLike>;
  release: () => void;
}

export interface PgPoolLike {
  query: (text: string, params?: unknown[]) => Promise<PgResultLike>;
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
}

type RawFragment = { __neonRaw: string };

function toParameterized(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];
  strings.forEach((part, index) => {
    text += part;
    if (index < values.length) {
      const value = values[index];
      if (value && typeof value === 'object' && '__neonRaw' in (value as Record<string, unknown>)) {
        text += (value as RawFragment).__neonRaw;
      } else if (value instanceof PgQuery) {
        // Nested composition is not used by the invite domain; refusing
        // keeps the adapter honest instead of silently mis-numbering $n.
        throw new Error('pg-sql adapter: nested query composition is not supported');
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
    }
  });
  return { text, params };
}

type Row = Record<string, unknown>;

class PgQuery {
  readonly text: string;
  readonly params: unknown[];
  private executor: (text: string, params: unknown[]) => Promise<Row[]>;
  private started: Promise<Row[]> | null = null;

  constructor(text: string, params: unknown[], executor: (text: string, params: unknown[]) => Promise<Row[]>) {
    this.text = text;
    this.params = params;
    this.executor = executor;
  }

  private run(): Promise<Row[]> {
    if (!this.started) this.started = this.executor(this.text, this.params);
    return this.started;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<Row[] | TResult> {
    return this.run().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Row[]> {
    return this.run().finally(onfinally);
  }
}

export function createLocalPgClient(pool: PgPoolLike): unknown {
  const execute = (text: string, params: unknown[]): Promise<Row[]> =>
    pool.query(text, [...params]).then((result) => result.rows as Row[]);

  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = toParameterized(strings, values);
    return new PgQuery(text, params, execute);
  }) as unknown as Record<string, unknown>;

  tag.query = (text: string, params: unknown[] = []) => new PgQuery(text, params, execute);
  tag.unsafe = (raw: string): RawFragment => ({ __neonRaw: raw });
  tag.transaction = async (queries: unknown[] | ((tx: unknown) => unknown[])) => {
    const list = (typeof queries === 'function' ? queries(tag) : queries) as PgQuery[];
    const client: PgClientLike = await pool.connect();
    try {
      await client.query('BEGIN');
      const results: Row[][] = [];
      for (const query of list) {
        if (!(query instanceof PgQuery)) throw new Error('pg-sql adapter: transaction expects query objects');
        results.push((await client.query(query.text, [...query.params])).rows as Row[]);
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback failure must not mask the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  };
  return tag;
}

const SAFE_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Throw unless the name is a safe bare SQL identifier (for schema DDL). */
export function assertSafeSchemaName(name: string): void {
  if (!SAFE_SCHEMA_PATTERN.test(name)) {
    throw new Error(`pg-sql adapter: refusing unsafe schema name ${JSON.stringify(name)}`);
  }
}

/** A unique, collision-free schema name per test run for full isolation. */
export function randomTestSchema(prefix = 'invite_test'): string {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
  const name = `${prefix}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  assertSafeSchemaName(name);
  return name;
}
