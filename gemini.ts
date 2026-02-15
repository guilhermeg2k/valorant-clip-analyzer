import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { readFile } from "node:fs/promises";

interface Config {
  geminiApiKey: string;
}

interface Highlight {
  start_time: string;
  end_time: string;
  description: string;
}

interface AnalysisResult {
  title: string;
  highlights: Highlight[];
}

async function loadConfig(): Promise<Config> {
  const configContent = await readFile("./config.json", "utf-8");
  return JSON.parse(configContent);
}

export async function analyzeClip(filePath: string): Promise<AnalysisResult> {
  const config = await loadConfig();
  if (!config.geminiApiKey) {
    throw new Error("Gemini API Key is missing in config.json");
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const fileManager = new GoogleAIFileManager(config.geminiApiKey);

  console.log(`Uploading file: ${filePath}`);
  const uploadResponse = await fileManager.uploadFile(filePath, {
    mimeType: "video/mp4",
    displayName: "Valorant Clip",
  });

  const fileUri = uploadResponse.file.uri;
  console.log(`Uploaded file as: ${fileUri}`);

  // Wait for file to be processed
  let file = await fileManager.getFile(uploadResponse.file.name);
  while (file.state === FileState.PROCESSING) {
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    file = await fileManager.getFile(uploadResponse.file.name);
  }

  if (file.state === FileState.FAILED) {
    throw new Error("Video processing failed.");
  }

  console.log("\nFile processed successfully. Analyzing...");

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
      temperature: 0.6,
    },
  });

  const prompt = `
  Analyze this video clip of Valorant gameplay.
  Identify highlight moments based on:
  1. Player kills: Look for the kill feed/icon feedback at the bottom middle of the screen.
  2. Audio excitement: Screams, laughs, and loud reactions.

  Return a JSON object with:
  - 'title': A YouTube title for the clip based on the highlights. Avoid using emojis and names (ex: agents, maps and positions)
  - 'highlights': A list of highlight objects. (If highlights are close (5 to 7s) try to put them together) Each highlight should have:
    - 'start_time': The start timestamp in HH:MM:SS format (e.g., "00:00:12").
    - 'end_time': The end timestamp in HH:MM:SS format (e.g., "00:00:15").
    - 'description': A brief description of the highlight (e.g., "Triple Kill", "Funny Reaction").

  Return ONLY the JSON object, strictly valid JSON. Do not use Markdown code blocks.
  `;
  const result = await model.generateContent([
    {
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.uri,
      },
    },
    { text: prompt },
  ]);

  const responseText = result.response.text();
  console.log("Raw Gemini Response:", responseText);

  try {
    // Attempt to clean markdown if present
    const jsonString = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(jsonString) as AnalysisResult;
  } catch (error) {
    console.error("Failed to parse JSON response:", error);
    throw error;
  }
}
