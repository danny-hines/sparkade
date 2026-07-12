// Thin better-sqlite3-shaped wrapper over Node's built-in SQLite (node:sqlite).
// Node ships SQLite compiled into the binary, so there is nothing to build on
// the device — unlike better-sqlite3, which compiled sqlite3.c from source on
// every install (~10-15 min on a Pi 3B+). node:sqlite already matches the API
// db.ts uses — prepare / run / get / all / exec / close, bare-named AND
// positional params, integers as `number`, plain-object rows — so this only
// adds the pragma() and transaction() helpers db.ts also relies on, and loosens
// the parameter types (node:sqlite is strict; better-sqlite3 was permissive).
import { DatabaseSync } from 'node:sqlite';

/** A prepared statement with permissive param/return types (better-sqlite3-like). */
export interface Stmt {
  run(...params: unknown[]): void;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export class Sqlite {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  pragma(statement: string): void {
    this.db.exec(`PRAGMA ${statement}`);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Stmt {
    // node:sqlite dispatches object-vs-positional args itself at runtime; cast
    // through unknown so db.ts can keep passing Record<string, unknown> params.
    const s = this.db.prepare(sql) as unknown as {
      run(...p: unknown[]): unknown;
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
    };
    return {
      run: (...p) => void s.run(...p),
      get: (...p) => s.get(...p),
      all: (...p) => s.all(...p),
    };
  }

  /** Run fn inside a transaction; commit on success, roll back on throw. */
  transaction(fn: () => void): () => void {
    return () => {
      this.db.exec('BEGIN');
      try {
        fn();
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}
