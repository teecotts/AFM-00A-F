import { google, drive_v3 } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "./logger";

let driveClient: drive_v3.Drive | null = null;

/**
 * Build an authenticated Google Drive client using a Service Account.
 *
 * Auth priority:
 * 1. GOOGLE_SERVICE_ACCOUNT_JSON env var (JSON string — best for Vercel)
 * 2. GOOGLE_SERVICE_ACCOUNT_KEY_PATH env var (path to JSON file — local dev)
 */
function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  let credentials: Record<string, unknown>;

  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (jsonEnv) {
    try {
      credentials = JSON.parse(jsonEnv);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  } else if (keyPath) {
    const raw = fs.readFileSync(keyPath, "utf-8");
    credentials = JSON.parse(raw);
  } else {
    throw new Error(
      "Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_PATH"
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email as string,
      private_key: credentials.private_key as string,
    },
    projectId: credentials.project_id as string,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  driveClient = google.drive({ version: "v3", auth });
  logger.info("Google Drive client initialized", {
    serviceAccount: credentials.client_email as string,
  });

  return driveClient;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size: string; // bytes as string from API
}

/**
 * List video files in the target folder created within the last 7 days.
 */
export async function listNewVideoFiles(): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString();

  const query = [
    `'${folderId}' in parents`,
    `mimeType contains 'video/'`,
    `createdTime > '${cutoff}'`,
    `trashed = false`,
  ].join(" and ");

  logger.info("Listing Drive files", { folderId, cutoff });

  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: query,
      fields: "nextPageToken, files(id, name, mimeType, createdTime, size)",
      pageSize: 100,
      orderBy: "createdTime desc",
      pageToken,
    });

    if (res.data.files) {
      for (const f of res.data.files) {
        if (f.id && f.name && f.mimeType && f.createdTime) {
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            createdTime: f.createdTime,
            size: f.size || "0",
          });
        }
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  logger.info("Drive listing complete", { fileCount: files.length });
  return files;
}

/**
 * Download a file from Google Drive to a temporary path.
 * Returns the local file path.
 */
export async function downloadFile(
  fileId: string,
  fileName: string
): Promise<string> {
  const drive = getDriveClient();
  const tmpDir = os.tmpdir();
  const destPath = path.join(tmpDir, `agent00a-${fileId}-${fileName}`);

  logger.info("Downloading file from Drive", { fileId, fileName, destPath });

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return new Promise<string>((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    (res.data as NodeJS.ReadableStream)
      .pipe(dest)
      .on("finish", () => {
        logger.info("File downloaded", { fileId, destPath });
        resolve(destPath);
      })
      .on("error", (err: Error) => {
        logger.error("File download stream error", { fileId, error: err.message });
        reject(err);
      });
  });
}

/**
 * Get file metadata (primarily to check size before downloading).
 */
export async function getFileMetadata(
  fileId: string
): Promise<{ size: number; name: string; mimeType: string }> {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: "size, name, mimeType",
  });

  return {
    size: parseInt(res.data.size || "0", 10),
    name: res.data.name || "unknown",
    mimeType: res.data.mimeType || "unknown",
  };
}
