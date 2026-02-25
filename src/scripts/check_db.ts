import "dotenv/config";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const sb = getSupabaseAdmin();

  // Events summary
  const { data: events } = await sb
    .from("events")
    .select("id, type, status, payload")
    .order("created_at", { ascending: true });

  console.log(`\n── Events (${events?.length ?? 0}) ──`);
  for (const e of events ?? []) {
    const p = e.payload as Record<string, string>;
    const label = p.file_name || p.transcript_id || "";
    console.log(`  ${e.status.padEnd(12)} ${e.type.padEnd(22)} ${label}`);
  }

  // Transcripts
  const { data: transcripts } = await sb
    .from("transcripts")
    .select("id, file_name, transcript")
    .order("created_at", { ascending: true });

  console.log(`\n── Transcripts (${transcripts?.length ?? 0}) ──`);
  for (const t of transcripts ?? []) {
    console.log(`  ${t.id}  ${t.file_name}  (${t.transcript?.length ?? 0} chars)`);
  }

  // Content queue
  const { data: drafts } = await sb
    .from("content_queue")
    .select("id, agent_id, type, platform, transcript_id")
    .order("created_at", { ascending: true });

  console.log(`\n── Content Queue (${drafts?.length ?? 0}) ──`);
  const draftsByAgent: Record<string, number> = {};
  for (const d of drafts ?? []) {
    draftsByAgent[d.agent_id] = (draftsByAgent[d.agent_id] || 0) + 1;
  }
  for (const [agent, count] of Object.entries(draftsByAgent)) {
    console.log(`  Agent ${agent}: ${count} drafts`);
  }

  // Media assets
  const { data: assets } = await sb
    .from("media_assets")
    .select("id, agent_id, type, transcript_id")
    .order("created_at", { ascending: true });

  console.log(`\n── Media Assets (${assets?.length ?? 0}) ──`);
  const assetsByAgent: Record<string, number> = {};
  for (const a of assets ?? []) {
    assetsByAgent[a.agent_id] = (assetsByAgent[a.agent_id] || 0) + 1;
  }
  for (const [agent, count] of Object.entries(assetsByAgent)) {
    console.log(`  Agent ${agent}: ${count} assets`);
  }

  // Event consumers
  const { data: consumers } = await sb
    .from("event_consumers")
    .select("agent_id, status")
    .order("created_at", { ascending: true });

  console.log(`\n── Event Consumers (${consumers?.length ?? 0}) ──`);
  const consumersByAgent: Record<string, { processed: number; failed: number }> = {};
  for (const c of consumers ?? []) {
    if (!consumersByAgent[c.agent_id]) consumersByAgent[c.agent_id] = { processed: 0, failed: 0 };
    if (c.status === "processed") consumersByAgent[c.agent_id].processed++;
    else consumersByAgent[c.agent_id].failed++;
  }
  for (const [agent, s] of Object.entries(consumersByAgent)) {
    console.log(`  Agent ${agent}: ${s.processed} processed, ${s.failed} failed`);
  }

  // Dead letters
  const { data: dead } = await sb.from("dead_letters").select("id").limit(0);
  const { count } = await sb.from("dead_letters").select("id", { count: "exact", head: true });
  console.log(`\n── Dead Letters: ${count ?? 0} ──`);

  console.log();
}

main().catch(console.error);
