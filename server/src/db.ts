import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Config } from "./config.js";
import { RequestError } from "./errors.js";

/** Runs one SQL statement, returning its rows. */
export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** The database: Supabase's Postgres in production, PGlite (a local copy of Postgres) otherwise. */
export interface Db {
  query: Query;
  /** Runs `work` in one transaction: everything it does is saved, or (if it throws) nothing is. */
  transaction<T>(work: (query: Query) => Promise<T>): Promise<T>;
  /** End-to-end tests only: while true, every query fails as if the database couldn't be reached. */
  simulateOutage: boolean;
}

/** The error the API answers with when the database can't be reached: the app then treats it as offline. */
export function databaseUnreachable(): RequestError {
  return new RequestError(503, "The database can't be reached.");
}

/** Error codes meaning the connection failed, rather than the query. */
const CONNECTION_ERRORS = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

/** Whether an error means the database couldn't be reached (as opposed to a mistake in a query). */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && (CONNECTION_ERRORS.has(code) || code.startsWith("08") || code.startsWith("57P"))) return true;
  return /Connection terminated|timeout exceeded when trying to connect|Connection ended/i.test(error.message);
}

/** Turns a lost connection into the API's 503; other errors are left as they are. */
function translate(error: unknown): unknown {
  return isConnectionError(error) ? databaseUnreachable() : error;
}

/** Opens the database the config says to use. Nothing is queried yet, so this works while it's unreachable. */
export async function openDatabase(config: Config): Promise<Db> {
  return config.databaseUrl ? openPostgres(config.databaseUrl, config.databaseCaFile) : openPglite(path.join(config.dataDir, "pglite"));
}

function openPostgres(databaseUrl: string, caFile: string | undefined): Db {
  // SSL is set up here, checked against Supabase's certificate, so any "sslmode" in the address is dropped.
  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true, ...(caFile && { ca: readFileSync(caFile, "utf8") }) },
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 60_000,
  });
  // A connection dropped while idle is reported here; without a listener it would stop the server.
  pool.on("error", (error) => console.warn("Database connection lost:", error.message));

  const db: Db = {
    simulateOutage: false,
    async query<T>(sql: string, params?: unknown[]) {
      if (db.simulateOutage) throw databaseUnreachable();
      try {
        return (await pool.query(sql, params)).rows as T[];
      } catch (error) {
        throw translate(error);
      }
    },
    async transaction<T>(work: (query: Query) => Promise<T>) {
      if (db.simulateOutage) throw databaseUnreachable();
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        throw translate(error);
      }
      try {
        await client.query("BEGIN");
        const result = await work(async (sql, params) => (await client.query(sql, params)).rows);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw translate(error);
      } finally {
        client.release();
      }
    },
  };
  return db;
}

async function openPglite(dir: string): Promise<Db> {
  // Only loaded without a databaseUrl, so the live server never needs it (it isn't bundled).
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite(dir);
  const db: Db = {
    simulateOutage: false,
    async query<T>(sql: string, params?: unknown[]) {
      if (db.simulateOutage) throw databaseUnreachable();
      return (await pglite.query<T>(sql, params)).rows;
    },
    async transaction<T>(work: (query: Query) => Promise<T>) {
      if (db.simulateOutage) throw databaseUnreachable();
      return pglite.transaction((tx) => work(async (sql, params) => (await tx.query(sql, params)).rows as never));
    },
  };
  return db;
}
