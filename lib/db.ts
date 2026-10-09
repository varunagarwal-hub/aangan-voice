/**
 * Tiny query layer. Neon (serverless HTTP driver) when DATABASE_URL is set;
 * otherwise, in mock mode only, a local PGlite database stored in ./.pglite.
 */
import { env } from "./env";
import { SCHEMA_SQL } from "./schema";

type Row = Record<string, any>;
interface Driver { query(text: string, params?: unknown[]): Promise<Row[]>; exec(text: string): Promise<void>; }

let driverPromise: Promise<Driver> | null = null;

async function makeDriver(): Promise<Driver> {
  if (env.databaseUrl) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(env.databaseUrl);
    return {
      query: async (text, params = []) => (await sql.query(text, params as any[])) as Row[],
      exec: async (text) => {
        // Neon HTTP runs one statement per request.
        for (const stmt of splitStatements(text)) await sql.query(stmt);
      },
    };
  }
  if (!env.mock) throw new Error("DATABASE_URL is not set (set MOCK_MODE=true to use a local database)");
  const { PGlite } = await import("@electric-sql/pglite");
  const g = globalThis as any;
  g.__aanganPglite ??= new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  const db = g.__aanganPglite;
  await db.exec(SCHEMA_SQL);
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows as Row[],
    exec: async (text) => { await db.exec(text); },
  };
}

export function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(";").map((s) => s.trim()).filter(Boolean);
}

function driver() {
  driverPromise ??= makeDriver().catch((err) => { driverPromise = null; throw err; });
  return driverPromise;
}

export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await (await driver()).query(text, params)) as T[];
}
export async function q1<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}
export async function migrate() {
  await (await driver()).exec(SCHEMA_SQL);
}
