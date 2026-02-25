import OpenAI from "openai";
import * as fs from "fs";
import { logger } from "./logger";

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

  logger.info("Starting Whisper transcription", { filePath });

  const fileStream = fs.createReadStream(filePath);

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
}
