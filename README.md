# Valorant Clip Analyzer & YouTube Montage Creator

This project was autonomously developed by **Gemini CLI**.

## Overview

This application automatically watches a specified folder for new Valorant clips, analyzes them using **Gemini 3 Flash**, generates a high-quality montage with transitions using **FFmpeg**, and uploads the final result to **YouTube**.

## Features

- **Folder Watching**: Real-time monitoring of your clips folder.
- **AI Analysis**: Detects player kills and exciting reactions (screams/laughs) using multimodal AI.
- **Smart Montage**:
  - Adds a 2-second buffer before and after each highlight.
  - Applies smooth crossfade transitions between segments.
  - High-quality H.264 encoding with optimized audio bitrates.
- **YouTube Integration**: Automatically uploads with catchy AI-generated titles and descriptions.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed.
- [FFmpeg](https://ffmpeg.org/) installed and available in your PATH.
- A Google Cloud Project with the **YouTube Data API v3** enabled.
- A **Gemini API Key**.

## Setup

1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```
2. Configure your `config.json`:
   ```json
   {
     "watchPath": "./clips",
     "geminiApiKey": "YOUR_GEMINI_API_KEY",
     "youtube": {
       "clientId": "YOUR_YOUTUBE_CLIENT_ID",
       "clientSecret": "YOUR_YOUTUBE_CLIENT_SECRET",
       "refreshToken": "YOUR_YOUTUBE_REFRESH_TOKEN"
     }
   }
   ```

## Usage

Start the watcher:

```bash
bun start
```

Simply drop any video file into the `watchPath` folder, and the application will handle the rest!

---

_Developed with ❤️ by Gemini CLI_

