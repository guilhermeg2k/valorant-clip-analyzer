import { spawn } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";

interface Highlight {
  start_time: string;
  end_time: string;
  description: string;
}

function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  } else if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return parts[0] ?? 0;
}

export async function createMontage(
  inputPath: string,
  highlights: Highlight[],
  outputName: string,
): Promise<string> {
  const outputDir = join(dirname(inputPath), "processed");
  await mkdir(outputDir, { recursive: true });

  const outputPath = join(outputDir, `${outputName}${extname(inputPath)}`);

  // 1. Prepare segments with buffers
  const buffer = 2; // seconds
  const segments = highlights.map((h) => {
    const start = Math.max(0, timeToSeconds(h.start_time) - buffer);
    const end = timeToSeconds(h.end_time) + buffer;
    const duration = end - start;
    return { start, end, duration };
  });

  if (segments.length === 0 || !segments[0]) {
    throw new Error("No highlights to process");
  }

  // 2. Build Filter Complex
  let filterComplex = "";
  const pixelFormat = "yuv420p"; // Ensure compatibility

  // Create trim filters for each segment
  // [0:v]trim=start=S:end=E,setpts=PTS-STARTPTS,fps=60,format=yuv420p[v0];
  segments.forEach((seg, i) => {
    filterComplex += `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS,fps=60,format=yuv420p[v${i}];`;
    filterComplex += `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}];`;
  });

  // Chain xfade/acrossfade if multiple segments
  if (segments.length > 1) {
    const fadeDuration = 0.5; // 0.5s crossfade

    // Video fading
    // [v0][v1]xfade=transition=fade:duration=1:offset=L0-1[vm1];
    // [vm1][v2]xfade=...:offset=AccDur-1[vm2];

    let currentVideoLabel = "[v0]";
    let currentAudioLabel = "[a0]";
    let accumulatedDuration = segments[0].duration;

    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      const nextVideoLabel = `[v${i}]`;
      const nextAudioLabel = `[a${i}]`;
      const targetVideoLabel = i === segments.length - 1 ? "[v]" : `[vm${i}]`;
      const targetAudioLabel = i === segments.length - 1 ? "[a]" : `[am${i}]`;

      const offset = accumulatedDuration - fadeDuration;

      // Video Crossfade
      filterComplex += `${currentVideoLabel}${nextVideoLabel}xfade=transition=fade:duration=${fadeDuration}:offset=${offset}${targetVideoLabel};`;

      // Audio Crossfade (acrossfade doesn't use offset, it just overlaps end/start)
      // But we need to be careful with mix.
      // simple acrossfade: [a0][a1]acrossfade=d=0.5[aout]
      // chaining: [prev][next]acrossfade=d=0.5[new]
      filterComplex += `${currentAudioLabel}${nextAudioLabel}acrossfade=d=${fadeDuration}:c1=tri:c2=tri${targetAudioLabel};`;

      currentVideoLabel = targetVideoLabel;
      currentAudioLabel = targetAudioLabel;

      // Update duration: (DurA + DurB - Fade)
      accumulatedDuration =
        accumulatedDuration + segment.duration - fadeDuration;
    }
  } else {
    // Single segment, just map [v0] to [v] and [a0] to [a]
    filterComplex += `[v0]format=${pixelFormat}[v];[a0]aformat=channel_layouts=stereo[a]`;
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264", // Generic H.264 encoder
      "-preset",
      "slow", // Better compression
      "-crf",
      "18", // Visually lossless
      "-c:a",
      "aac",
      "-b:a",
      "320k", // High quality audio
      outputPath,
    ];

    console.log("Spawning ffmpeg with args:", args.join(" "));

    const ffmpeg = spawn("ffmpeg", args);

    let stderr = "";
    ffmpeg.stderr.on("data", (d) => (stderr += d.toString()));

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        console.error("FFmpeg Error:", stderr);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}
