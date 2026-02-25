/**
 * Debug script: see exactly what the Drive API returns for your folder.
 * No filters — shows ALL files, including their MIME types.
 */
import "dotenv/config";
import { google } from "googleapis";
import * as fs from "fs";

async function main() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  console.log("=== Drive Debug ===");
  console.log(`Folder ID: ${folderId}`);
  console.log(`Key path:  ${keyPath}`);
  console.log(`JSON env:  ${jsonEnv ? "(set)" : "(not set)"}`);

  // Build auth
  let credentials: Record<string, unknown>;
  if (jsonEnv) {
    credentials = JSON.parse(jsonEnv);
  } else if (keyPath) {
    credentials = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  } else {
    console.error("No credentials found!");
    process.exit(1);
  }

  console.log(`Service account: ${credentials.client_email}`);

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email as string,
      private_key: credentials.private_key as string,
    },
    projectId: credentials.project_id as string,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  // Query 1: ALL files in folder (no mime filter, no date filter)
  console.log("\n--- Query 1: ALL items in folder (no filters) ---");
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, createdTime, size)",
      pageSize: 50,
    });

    if (!res.data.files || res.data.files.length === 0) {
      console.log("  NO FILES FOUND. The service account likely doesn't have access.");
      console.log(`\n  FIX: Share the Drive folder with:`);
      console.log(`  ${credentials.client_email}`);
      console.log(`  (Viewer access is enough)`);
    } else {
      console.log(`  Found ${res.data.files.length} item(s):\n`);
      for (const f of res.data.files) {
        const sizeMB = f.size ? (parseInt(f.size, 10) / 1024 / 1024).toFixed(1) + " MB" : "n/a";
        console.log(`  ID:       ${f.id}`);
        console.log(`  Name:     ${f.name}`);
        console.log(`  MIME:     ${f.mimeType}`);
        console.log(`  Created:  ${f.createdTime}`);
        console.log(`  Size:     ${sizeMB}`);
        const isVideo = f.mimeType?.includes("video/");
        console.log(`  Is video: ${isVideo ? "YES" : "NO <-- this is why it's skipped"}`);
        console.log();
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${msg}`);

    if (msg.includes("404") || msg.includes("not found")) {
      console.log("\n  The folder ID may be wrong, or the service account has no access.");
    }
    if (msg.includes("403") || msg.includes("forbidden") || msg.includes("insufficient")) {
      console.log("\n  Permission denied. Share the folder with the service account email.");
    }
  }

  // Query 2: Only video files (the filter our pipeline uses)
  console.log("\n--- Query 2: Video files only (pipeline filter) ---");
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'video/' and createdTime > '${sevenDaysAgo.toISOString()}' and trashed = false`,
      fields: "files(id, name, mimeType, createdTime, size)",
      pageSize: 50,
    });

    if (!res.data.files || res.data.files.length === 0) {
      console.log("  No video files matched the pipeline filter.");
    } else {
      console.log(`  ${res.data.files.length} video file(s) match the pipeline filter.`);
    }
  } catch (err: unknown) {
    console.error(`  ERROR: ${(err instanceof Error ? err.message : String(err))}`);
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
