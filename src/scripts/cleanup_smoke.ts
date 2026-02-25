import "dotenv/config";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const sb = getSupabaseAdmin();

  // Find orphaned smoke events
  const { data: smokeEvents } = await sb
    .from("events")
    .select("id, type, status")
    .filter("payload->>file_id", "like", "smoke_file_%");

  console.log(`Smoke events found: ${smokeEvents?.length ?? 0}`);

  if (smokeEvents && smokeEvents.length > 0) {
    const ids = smokeEvents.map((e) => e.id);
    for (const e of smokeEvents) console.log(`  ${e.id} ${e.type} ${e.status}`);

    await sb.from("event_consumers").delete().in("event_id", ids);
    await sb.from("dead_letters").delete().in("source_event_id", ids);
    const { error } = await sb.from("events").delete().in("id", ids);
    console.log(error ? `Delete failed: ${error.message}` : `Deleted ${ids.length} smoke events`);
  }

  // Smoke transcripts
  const { data: smokeT } = await sb
    .from("transcripts")
    .select("id")
    .like("file_id", "smoke_file_%");

  if (smokeT && smokeT.length > 0) {
    await sb.from("transcripts").delete().in("id", smokeT.map((t) => t.id));
    console.log(`Deleted ${smokeT.length} smoke transcripts`);
  }

  // Show remaining events
  const { data: remaining } = await sb
    .from("events")
    .select("id, type, status")
    .order("created_at", { ascending: false })
    .limit(10);

  console.log(`\nRemaining events (newest first):`);
  for (const e of remaining ?? []) {
    console.log(`  ${e.id}  ${e.type}  ${e.status}`);
  }
}

main().catch(console.error);
