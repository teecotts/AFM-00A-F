/**
 * DB Reset — Wipe all Supabase tables for a fresh start.
 *
 * Deletes rows in FK-safe order (children before parents).
 * Requires --force flag to actually delete; without it, shows row counts only.
 *
 * Usage:
 *   npx tsx src/scripts/reset_db.ts           # dry run — shows counts
 *   npx tsx src/scripts/reset_db.ts --force   # actually deletes
 *   npm run db:reset                          # same as --force
 */
import "dotenv/config";
import { validateSupabaseEnv, getSupabaseAdmin } from "../lib/supabase";

const TABLES_IN_DELETE_ORDER = [
  "event_consumers",
  "content_queue",
  "media_assets",
  "dead_letters",
  "events",
  "transcripts",
];

async function main() {
  const force = process.argv.includes("--force");

  validateSupabaseEnv();
  const sb = getSupabaseAdmin();

  // Count rows in each table
  console.log("\n── Current DB State ──");
  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const table of TABLES_IN_DELETE_ORDER) {
    const { count, error } = await sb
      .from(table)
      .select("id", { count: "exact", head: true });

    if (error) {
      console.log(`  ✗ ${table}: ${error.message}`);
      counts[table] = -1;
    } else {
      counts[table] = count ?? 0;
      totalRows += counts[table];
      console.log(`  ${table.padEnd(20)} ${counts[table]} rows`);
    }
  }

  console.log(`  ${"─".repeat(30)}`);
  console.log(`  Total: ${totalRows} rows\n`);

  if (totalRows === 0) {
    console.log("Database is already empty. Nothing to do.");
    return;
  }

  if (!force) {
    console.log("Dry run — no data deleted.");
    console.log("Re-run with --force to actually delete all rows:");
    console.log("  npx tsx src/scripts/reset_db.ts --force");
    console.log("  npm run db:reset\n");
    return;
  }

  // Delete in FK-safe order
  console.log("── Deleting all rows ──");
  for (const table of TABLES_IN_DELETE_ORDER) {
    if (counts[table] === 0) {
      console.log(`  – ${table}: already empty`);
      continue;
    }

    const { error } = await sb
      .from(table)
      .delete()
      .gte("created_at", "1970-01-01T00:00:00Z");

    if (error) {
      console.log(`  ✗ ${table}: ${error.message}`);
    } else {
      console.log(`  ✓ ${table}: deleted ${counts[table]} rows`);
    }
  }

  console.log("\nDatabase reset complete.\n");
}

main().catch((err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
