/**
 * Review Stats — prints summary of content_queue and media_assets by status.
 *
 * Usage: npm run review:stats
 */
import "dotenv/config";
import { getSupabaseAdmin, validateSupabaseEnv } from "../lib/supabase";
import { logger } from "../lib/logger";

const STATUSES = ["draft", "approved", "needs_revision", "rejected", "scheduled", "published"] as const;

async function countByStatus(table: string): Promise<Record<string, number>> {
  const sb = getSupabaseAdmin();
  const counts: Record<string, number> = {};

  for (const status of STATUSES) {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      logger.error(`reviewStats: count failed for ${table}.${status}`, { error: error.message });
      counts[status] = -1;
    } else {
      counts[status] = count ?? 0;
    }
  }

  return counts;
}

function printTable(label: string, counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, n) => sum + (n >= 0 ? n : 0), 0);

  console.log(`\n${"=".repeat(45)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(45)}`);

  for (const status of STATUSES) {
    const count = counts[status] ?? 0;
    const bar = count > 0 ? " " + "#".repeat(Math.min(count, 30)) : "";
    console.log(`  ${status.padEnd(18)} ${String(count).padStart(5)}${bar}`);
  }

  console.log(`  ${"─".repeat(25)}`);
  console.log(`  ${"TOTAL".padEnd(18)} ${String(total).padStart(5)}`);
}

async function main() {
  validateSupabaseEnv();

  console.log("\nReview Dashboard Stats");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const [contentCounts, mediaCounts] = await Promise.all([
    countByStatus("content_queue"),
    countByStatus("media_assets"),
  ]);

  printTable("CONTENT QUEUE", contentCounts);
  printTable("MEDIA ASSETS", mediaCounts);

  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
