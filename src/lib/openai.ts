import OpenAI from "openai";
import * as fs from "fs";
import { logger } from "./logger";
import { extractAudio } from "./audio";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  openaiClient = new OpenAI({ apiKey });
  logger.info("OpenAI client initialized");
  return openaiClient;
}

/**
 * Transcribe an audio/video file using OpenAI Whisper.
 * @param filePath - Local path to the file.
 * @returns The transcription text.
 */
export async function transcribeFile(filePath: string): Promise<string> {
  const client = getOpenAI();

  // Extract audio from video files (Whisper has a 25 MB limit)
  const { audioPath, needsCleanup } = await extractAudio(filePath);

  try {
    logger.info("Starting Whisper transcription", { audioPath });

    const fileStream = fs.createReadStream(audioPath);

    const response = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fileStream,
      response_format: "text",
    });

    // response is a string when response_format is "text"
    const transcript = typeof response === "string" ? response : (response as unknown as string);

    logger.info("Transcription complete", {
      filePath,
      charCount: transcript.length,
    });

    return transcript;
  } finally {
    if (needsCleanup) {
      try {
        fs.unlinkSync(audioPath);
        logger.debug("Cleaned up extracted audio", { audioPath });
      } catch {
        logger.warn("Failed to clean up extracted audio", { audioPath });
      }
    }
  }
}
