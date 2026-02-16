import { watch } from "node:fs";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { analyzeClip } from "./gemini";
import { createMontage } from "./video-processor";
import { uploadVideo } from "./youtube-uploader";
import { LockManager } from "./lock-manager";

// --- CONFIGURATION TYPES ---
interface Config {
  watchPath: string;
  geminiApiKey: string;
  maxConcurrent: number;
  youtube?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

// --- HELPER FUNCTIONS ---

async function loadConfig(): Promise<Config> {
  const configContent = await readFile("./config.json", "utf-8");
  return JSON.parse(configContent);
}

function sanitizeFilename(title: string): string {
  // Replace illegal chars for Windows/Linux files
  let safeName = title.replace(/[<>:"/\\|?*]+/g, "-");
  safeName = `${safeName} - ${new Date().toISOString()}`;
  safeName = safeName.toLowerCase().replace(" ", "-");
  return safeName.trim().replace(/^\.+|\.+$/g, "") || "untitled_montage";
}

async function waitForFileToBeReady(
  filePath: string,
  interval = 1000,
  maxRetries = 60,
): Promise<boolean> {
  let lastSize = -1;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const stats = await stat(filePath);
      // Ensure file has size > 0 and hasn't changed size in the last second
      if (stats.size > 0 && stats.size === lastSize) {
        return true;
      }
      lastSize = stats.size;
    } catch (e) {
      // File might be locked by OBS or not accessible yet
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    retries++;
  }
  return false;
}

// --- MAIN LOGIC ---

async function main() {
  const config = await loadConfig();
  const { watchPath } = config;

  // Initialize the State Manager (Lockfile)
  const lock = new LockManager();

  console.log(`🚀 Bot Started.`);
  console.log(`📂 Watching: ${watchPath}`);
  console.log(`🔒 Lock System: Active (process-lock.json)`);

  // --- QUEUE SYSTEM ---
  const MAX_CONCURRENT = config.maxConcurrent ?? 1;
  let activeCount = 0;
  const queue: (() => Promise<void>)[] = [];

  function processQueue() {
    if (activeCount < MAX_CONCURRENT && queue.length > 0) {
      const task = queue.shift();
      if (task) {
        activeCount++;
        task().finally(() => {
          activeCount--;
          processQueue();
        });
      }
    }
  }

  function addToQueue(task: () => Promise<void>) {
    queue.push(task);
    processQueue();
  }

  // --- CORE PIPELINE ---

  async function processVideo(filePath: string, filename: string) {
    console.log(`\n🎬 [START] Processing: ${filename}`);

    // 1. CHECK STATE (Resume Capability)
    let state = lock.get(filename);

    if (state?.status === "UPLOADED") {
      console.log(`✅ [SKIP] Already uploaded: ${state.uploadId}`);
      return;
    }

    if (state?.status === "FAILED") {
      console.log(
        `❌ [SKIP] marked as FAILED in lockfile. Delete entry in json to retry.`,
      );
      return;
    }

    try {
      // --- STEP 1: ANALYSIS (GEMINI) ---
      let analysis = state?.geminiAnalysis;

      if (!analysis) {
        console.log(`🤖 [GEMINI] Analyzing video...`);
        lock.update(filename, { status: "ANALYZING" });

        analysis = await analyzeClip(filePath);

        // Update lock with the expensive result
        lock.update(filename, {
          geminiAnalysis: analysis,
          status: "ANALYZING", // Keep analyzing until we determine next step
        });
      } else {
        console.log(`⏩ [GEMINI] Using cached analysis from lockfile.`);
      }

      // Check if highlights exist
      if (!analysis || analysis.highlights.length === 0) {
        console.log(`⚠️ [STOP] No highlights found.`);
        lock.update(filename, {
          status: "FAILED",
          errorMessage: "No highlights found",
        });
        return;
      }

      console.log(
        `✨ Title: "${analysis.title}" (${analysis.highlights.length} clips)`,
      );

      // --- STEP 2: RENDERING (FFMPEG) ---
      let outputPath = state?.outputFilePath;

      if (!outputPath) {
        console.log(`✂️ [FFMPEG] Rendering montage...`);

        const safeTitle = sanitizeFilename(analysis.title);
        // Ensure we don't overwrite original files, add _montage suffix
        const outputName = `${safeTitle}_montage`;

        outputPath = await createMontage(
          filePath,
          analysis.highlights,
          outputName,
        );

        lock.update(filename, {
          status: "RENDERED",
          outputFilePath: outputPath,
        });
        console.log(`💾 [SAVED] ${outputPath}`);
      } else {
        console.log(`⏩ [FFMPEG] Using cached video file.`);
      }

      // --- STEP 3: UPLOAD (YOUTUBE) ---
      // Only proceed if YouTube config exists
      if (config.youtube && config.youtube.clientId) {
        if (state?.status != "UPLOADED") {
          console.log(`☁️ [YOUTUBE] Uploading...`);

          const description = "Highlights automatically by Gemini 3 Flash.";

          try {
            const videoId = await uploadVideo(
              outputPath!,
              analysis.title,
              description,
            );
            lock.update(filename, {
              status: "UPLOADED",
              uploadId: videoId,
            });
            console.log(
              `🎉 [SUCCESS] Video is live: https://youtu.be/${videoId}`,
            );
          } catch (error: any) {
            console.error(`💥 [ERROR] Upload to youtube failed`, error);
            lock.update(filename, {
              status: "UPLOAD_FAILED",
              errorMessage: error.message || "Unknown Error",
            });
          }
        }
      } else {
        console.log(`ℹ️ [INFO] YouTube config missing. Stopping at Render.`);
        lock.update(filename, { status: "RENDERED_NO_UPLOAD" });
      }
    } catch (error: any) {
      console.error(`💥 [ERROR] Pipeline failed for ${filename}:`, error);
      lock.update(filename, {
        status: "FAILED",
        errorMessage: error.message || "Unknown Error",
      });
    }
  }

  // --- SCAN EXISTING FILES ---
  try {
    const files = await readdir(watchPath);
    const videoExtensions = [".mp4", ".mkv", ".mov"];

    console.log(`🔍 Scanning directory for unfinished work...`);

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (videoExtensions.includes(ext) && !file.includes("_montage")) {
        const filePath = join(watchPath, file);

        // Check Lockfile
        const state = lock.get(file);
        const isDone =
          state?.status === "UPLOADED" ||
          state?.status === "RENDERED_NO_UPLOAD" ||
          state?.status === "FAILED";

        if (!isDone) {
          console.log(`➕ Adding existing file to queue: ${file}`);
          addToQueue(() => processVideo(filePath, file));
        }
      }
    }
  } catch (err) {
    console.error("Error scanning directory:", err);
  }

  // --- WATCHER ---
  console.log(`👀 Watching for new .mp4 files...`);

  watch(watchPath, async (eventType, filename) => {
    if (eventType === "rename" && filename) {
      const ext = extname(filename).toLowerCase();
      // Ignore temporary files and our own output files
      if (ext === ".mp4" && !filename.includes("_montage")) {
        const filePath = join(watchPath, filename);

        try {
          // Check if file exists (it might be a delete event)
          await stat(filePath);

          console.log(`\n🆕 New file detected: ${filename}`);
          const isReady = await waitForFileToBeReady(filePath);

          if (isReady) {
            // Double check lock before adding to queue (debounce)
            if (!lock.get(filename)) {
              addToQueue(() => processVideo(filePath, filename));
            }
          } else {
            console.log(`⚠️ File ${filename} timed out or was locked.`);
          }
        } catch (e) {
          // File deleted or moved
        }
      }
    }
  });
}

main().catch(console.error);
