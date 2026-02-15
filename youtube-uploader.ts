import { google } from "googleapis";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

interface Config {
  youtube: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

async function loadConfig(): Promise<Config> {
  const configContent = await readFile("./config.json", "utf-8");
  return JSON.parse(configContent);
}

export async function uploadVideo(
  filePath: string,
  title: string,
  description: string
): Promise<string> {
  const config = await loadConfig();
  const { clientId, clientSecret, refreshToken } = config.youtube;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("YouTube credentials missing in config.json");
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "http://localhost" // Redirect URI, not used for refresh token flow but required
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client
  });

  console.log(`Starting upload for: ${title}`);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: title,
        description: description,
        tags: ["Valorant", "Gaming", "Highlights", "Montage"],
        categoryId: "20" // Gaming category
      },
      status: {
        privacyStatus: "public", // Publish immediately
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: createReadStream(filePath)
    }
  });

  console.log(`Upload complete! Video ID: ${res.data.id}`);
  return res.data.id || "";
}
