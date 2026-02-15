import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, extname } from "node:path";

// 1. Configuration
const CONFIG_FILE = "./config.json";
const LOCK_FILE = "./process-lock.json";
const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov", ".avi"];

interface VideoState {
  status: string;
  originalName: string;
  lastUpdated: string;
  note?: string;
}

// 2. Helper to load config
function getWatchPath(): string {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    return config.watchPath;
  } catch (e) {
    console.error("❌ Could not read config.json. Make sure it exists.");
    process.exit(1);
  }
}

// 3. Main Logic
function main() {
  console.log("🛠️  Starting Lockfile Backfill...");

  const watchPath = getWatchPath();
  console.log(`📂 Scanning folder: ${watchPath}`);

  // Load existing lockfile or create empty object
  let lockData: Record<string, VideoState> = {};
  if (existsSync(LOCK_FILE)) {
    try {
      lockData = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
      console.log(
        `🔓 Loaded existing lockfile with ${Object.keys(lockData).length} entries.`,
      );
    } catch (e) {
      console.log("⚠️  Lockfile corrupted or empty. Starting fresh.");
    }
  }

  // Scan directory
  try {
    const files = readdirSync(watchPath);
    let addedCount = 0;

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      const filePath = join(watchPath, file);

      // Check if it's a video and NOT a directory
      if (VIDEO_EXTENSIONS.includes(ext) && statSync(filePath).isFile()) {
        // Skip files that are likely montages created by the bot
        if (file.includes("_montage")) {
          continue;
        }

        // Check if already exists in lock
        if (!lockData[file]) {
          lockData[file] = {
            status: "UPLOADED", // We mark it as DONE so the bot skips it
            originalName: file,
            lastUpdated: new Date().toISOString(),
            note: "Manually backfilled via script",
          };
          addedCount++;
          console.log(`✅ Marked as DONE: ${file}`);
        } else {
          console.log(`⏭️  Skipping ${file} (Already in lockfile)`);
        }
      }
    }

    // Save back to disk
    writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`\n💾 Saved process-lock.json`);
    console.log(
      `🎉 Operation complete! Added ${addedCount} files to the ignore list.`,
    );
    console.log(`🚀 You can now start your bot safely.`);
  } catch (e) {
    console.error(`💥 Error scanning directory:`, e);
  }
}

main();
