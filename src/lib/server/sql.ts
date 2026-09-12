import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

/**
 * Database driver selection, so the same data layer runs against a cloud Neon
 * project or a plain local Postgres.
 *
 * Neon's HTTP driver (`neon()`) only speaks to Neon's SQL-over-HTTP endpoint,
 * not to a bare Postgres — which is exactly what a "run it locally first" setup
 * has. So when the connection points at a local Postgres we swap in a small
 * node-postgres adapter that presents the *same* surface `db.ts` already uses:
 * a tagged-template call returning the rows array, plus a `.query(text, params)`
 * escape hatch. Every call site is unchanged.
 *
 * Selection: `DB_DRIVER` wins when set to `pg` or `neon`; otherwise a localhost
 * connection string auto-selects `pg` and anything else stays on Neon.
 *
 * (No "server-only" here: the db-push / seed scripts import this too, and they
 * run under tsx, not the Next server.)
 */

// Row shape mirrors Neon's own driver (`Record<string, any>[]`), so every
// existing `(await sql`...`) as XRow[]` cast in db.ts compiles unchanged.
export type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, any>[]>;
  query(text: string, params?: unknown[]): Promise<Record<string, any>[]>;
};

const LOCAL_HOST = /@(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)([:/]|$)/i;

function usePostgres(url: string): boolean {
  const explicit = process.env.DB_DRIVER?.trim().toLowerCase();
  if (explicit === "pg") return true;
  if (explicit === "neon") return false;
  return LOCAL_HOST.test(url);
}

// One pool per process — db.ts calls createSql() per statement, and a fresh
// pool each time would exhaust connections instantly.
let pool: Pool | undefined;

function pgSql(url: string): Sql {
  pool ??= new Pool({ connectionString: url });
  const run = async (text: string, params: unknown[]) => (await pool!.query(text, params)).rows;

  // Neon interpolates each `${value}` as a bound parameter; mirror that by
  // turning the template holes into $1..$n so identical SQL runs unchanged.
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) text += `$${i + 1}`;
    });
    return run(text, values);
  }) as Sql;
  sql.query = (text: string, params: unknown[] = []) => run(text, params);
  return sql;
}

/** The database handle for the configured driver. */
export function createSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return usePostgres(url) ? pgSql(url) : (neon(url) as unknown as Sql);
}
