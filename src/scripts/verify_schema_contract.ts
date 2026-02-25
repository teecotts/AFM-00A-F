/**
 * Schema Contract Verification Script
 *
 * Queries information_schema via Supabase to verify that all tables
 * and columns expected by the codebase actually exist in the database.
 *
 * Usage:
 *   npx tsx src/scripts/verify_schema_contract.ts
 *   npm run db:verify
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */
import "dotenv/config";
import { getSupabaseAdmin, validateSupabaseEnv } from "../lib/supabase";

// ---- Schema contract inferred from code ----

interface ColumnSpec {
  name: string;
  nullable?: boolean; // true = can be null
}

interface TableSpec {
  table: string;
  columns: ColumnSpec[];
}

const SCHEMA_CONTRACT: TableSpec[] = [
  {
    table: "events",
    columns: [
      { name: "id" },
      { name: "type" },
      { name: "payload" },
      { name: "status" },
      { name: "attempt_count" },
      { name: "last_error", nullable: true },
      { name: "dedupe_key", nullable: true },
      { name: "locked_at", nullable: true },
      { name: "created_at" },
      { name: "updated_at" },
    ],
  },
  {
    table: "transcripts",
    columns: [
      { name: "id" },
      { name: "file_id" },
      { name: "file_name", nullable: true },
      { name: "transcript" },
      { name: "created_at" },
    ],
  },
  {
    table: "event_consumers",
    columns: [
      { name: "id" },
      { name: "event_id" },
      { name: "agent_id" },
      { name: "status" },
      { name: "error", nullable: true },
      { name: "created_at" },
    ],
  },
  {
    table: "content_queue",
    columns: [
      { name: "id" },
      { name: "transcript_id" },
      { name: "idea_id", nullable: true },
      { name: "agent_id" },
      { name: "type" },
      { name: "platform" },
      { name: "status" },
      { name: "content" },
      { name: "metadata" },
      { name: "created_at" },
    ],
  },
  {
    table: "media_assets",
    columns: [
      { name: "id" },
      { name: "transcript_id" },
      { name: "idea_id", nullable: true },
      { name: "agent_id" },
      { name: "type" },
      { name: "status" },
      { name: "content" },
      { name: "created_at" },
    ],
  },
  {
    table: "dead_letters",
    columns: [
      { name: "id" },
      { name: "source_event_id", nullable: true },
      { name: "type", nullable: true },
      { name: "payload", nullable: true },
      { name: "last_error", nullable: true },
      { name: "attempt_count", nullable: true },
      { name: "created_at" },
    ],
  },
];

// ---- Verification logic ----

interface VerifyResult {
  table: string;
  exists: boolean;
  missingColumns: string[];
  extraColumns: string[];
}

async function verifySchema(): Promise<VerifyResult[]> {
  const sb = getSupabaseAdmin();
  const results: VerifyResult[] = [];

  for (const spec of SCHEMA_CONTRACT) {
    const result: VerifyResult = {
      table: spec.table,
      exists: false,
      missingColumns: [],
      extraColumns: [],
    };

    // Check if table exists by querying it with limit 0
    const { error: tableErr } = await sb
      .from(spec.table)
      .select("*")
      .limit(0);

    if (tableErr) {
      // Table doesn't exist or not accessible
      result.exists = false;
      result.missingColumns = spec.columns.map((c) => c.name);
      results.push(result);
      continue;
    }

    result.exists = true;

    // Query information_schema for columns
    const { data: cols, error: colErr } = await sb
      .rpc("get_table_columns", { p_table_name: spec.table })
      .select("*");

    // Fallback: try direct information_schema query
    if (colErr || !cols) {
      // If RPC doesn't exist, try inserting a dummy and checking error
      // or just try selecting each column individually
      for (const col of spec.columns) {
        const { error: selectErr } = await sb
          .from(spec.table)
          .select(col.name)
          .limit(0);

        if (selectErr) {
          result.missingColumns.push(col.name);
        }
      }
    } else {
      const existingCols = new Set((cols as Array<{ column_name: string }>).map((c) => c.column_name));
      const expectedCols = new Set(spec.columns.map((c) => c.name));

      for (const col of spec.columns) {
        if (!existingCols.has(col.name)) {
          result.missingColumns.push(col.name);
        }
      }

      for (const existing of existingCols) {
        if (!expectedCols.has(existing)) {
          result.extraColumns.push(existing);
        }
      }
    }

    results.push(result);
  }

  return results;
}

// ---- Main ----

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Schema Contract Verification                 ║");
  console.log("║  Checking DB against code expectations         ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  try {
    validateSupabaseEnv();
  } catch (err) {
    console.error(`FATAL: ${err instanceof Error ? err.message : err}`);
    console.error("\nSet SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  console.log("Connecting to Supabase...\n");

  let allPassed = true;
  const results = await verifySchema();

  for (const r of results) {
    const icon = r.exists && r.missingColumns.length === 0 ? "✓" : "✗";
    const status = r.exists && r.missingColumns.length === 0 ? "PASS" : "FAIL";

    if (status === "FAIL") allPassed = false;

    console.log(`${icon} ${r.table} — ${status}`);

    if (!r.exists) {
      console.log(`    Table does not exist! Run 001_core.sql first.`);
      continue;
    }

    if (r.missingColumns.length > 0) {
      console.log(`    Missing columns: ${r.missingColumns.join(", ")}`);
    }

    if (r.extraColumns.length > 0) {
      console.log(`    Extra columns (OK): ${r.extraColumns.join(", ")}`);
    }
  }

  console.log(
    `\n${"═".repeat(48)}`
  );
  console.log(
    allPassed
      ? "  RESULT: ALL CHECKS PASSED"
      : "  RESULT: SCHEMA DRIFT DETECTED — Run migrations!"
  );
  console.log("═".repeat(48));

  if (!allPassed) {
    console.log("\nTo fix: run supabase/migrations/001_core.sql in your Supabase SQL Editor.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
