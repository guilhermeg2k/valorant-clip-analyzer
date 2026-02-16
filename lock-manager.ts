import { existsSync, readFileSync, writeFileSync } from "node:fs";

const LOCK_FILE = "process-lock.json";

export interface VideoState {
  status:
    | "PENDING"
    | "ANALYZING"
    | "RENDERED"
    | "UPLOADED"
    | "FAILED"
    | "RENDERED_NO_UPLOAD"
    | "UPLOAD_FAILED";
  originalName: string;
  geminiAnalysis?: {
    title: string;
    highlights: any[];
  };
  outputFilePath?: string;
  uploadId?: string; // YouTube ID ou Drive Link
  errorMessage?: string;
  lastUpdated: string;
}

export class LockManager {
  private data: Record<string, VideoState> = {};

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (existsSync(LOCK_FILE)) {
        this.data = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("⚠️ Erro ao ler lockfile", e);
      throw e;
    }
  }

  private save() {
    writeFileSync(LOCK_FILE, JSON.stringify(this.data, null, 2));
  }

  get(filename: string): VideoState | undefined {
    this.load(); // Sempre relê do disco para garantir sincronia
    return this.data[filename];
  }

  // Inicializa ou atualiza o estado de um arquivo
  update(filename: string, updates: Partial<VideoState>) {
    this.load();

    const currentState = this.data[filename] || {
      status: "PENDING",
      originalName: filename,
      lastUpdated: new Date().toISOString(),
    };

    this.data[filename] = {
      ...currentState,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };

    this.save();
  }
}
