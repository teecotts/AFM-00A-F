import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { logger } from "./logger";

// ffmpeg-static exports the path to the bundled ffmpeg binary
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require("ffmpeg-static");

const WHISPER_MAX_SIZE = 25 * 1024 * 1024; // 25 MB

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v",
]);

/**
 * Extract audio from a video file as a compact mono MP3.
 * Whisper only needs speech-quality audio, so we downsample to
 * 16 kHz mono at 48 kbps — a 1-hour recording becomes ~21 MB,
 * well within Whisper's 25 MB upload limit.
 *
 * If the input is already a small-enough audio file, returns the
 * original path unchanged (no conversion needed).
 */
export async function extractAudio(inputPath: string): Promise<{
  audioPath: string;
  needsCleanup: boolean;
}> {
  const ext = path.extname(inputPath).toLowerCase();
  const inputSize = fs.statSync(inputPath).size;

  // If it's not a video and already under 25 MB, skip conversion
  if (!VIDEO_EXTENSIONS.has(ext) && inputSize <= WHISPER_MAX_SIZE) {
    logger.info("File already audio-sized, skipping extraction", {
      inputPath,
      size: inputSize,
    });
    return { audioPath: inputPath, needsCleanup: false };
  }

  // Build output path next to the input file
  const outputPath = inputPath.replace(/\.[^.]+$/, "_audio.mp3");

  logger.info("Extracting audio from video", {
    inputPath,
    outputPath,
    inputSizeMB: (inputSize / 1024 / 1024).toFixed(1),
  });

  await runFfmpeg([
    "-i", inputPath,
    "-vn",           // strip video
    "-ac", "1",      // mono
    "-ar", "16000",  // 16 kHz (plenty for speech recognition)
    "-b:a", "48k",   // 48 kbps (small but clear for speech)
    "-y",            // overwrite if exists
    outputPath,
  ]);

  const outputSize = fs.statSync(outputPath).size;
  logger.info("Audio extraction complete", {
    outputPath,
    outputSizeMB: (outputSize / 1024 / 1024).toFixed(1),
  });

  if (outputSize > WHISPER_MAX_SIZE) {
    logger.warn("Extracted audio still exceeds 25 MB", {
      outputSizeMB: (outputSize / 1024 / 1024).toFixed(1),
    });
  }

  return { audioPath: outputPath, needsCleanup: true };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        logger.error("ffmpeg failed", { error: err.message, stderr });
        reject(new Error(`ffmpeg failed: ${err.message}`));
        return;
      }
      resolve();
    });
  });
}
