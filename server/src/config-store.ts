// Persisted config store. Loads config.json (merged onto defaults), applies
// patches, persists to disk, and notifies subscribers (the WS hub).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, mergeConfig, type Config } from "@shared/index.js";

type Listener = (config: Config) => void;

export class ConfigStore {
  private config: Config = DEFAULT_CONFIG;
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      this.config = mergeConfig(DEFAULT_CONFIG, JSON.parse(raw) as Partial<Config>);
    } catch {
      this.config = DEFAULT_CONFIG; // first run
    }
  }

  get(): Config {
    return this.config;
  }

  patch(patch: Partial<Config>): Config {
    this.config = mergeConfig(this.config, patch);
    this.emit();
    this.scheduleSave();
    return this.config;
  }

  set(config: Config): Config {
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.emit();
    this.scheduleSave();
    return this.config;
  }

  reset(): Config {
    this.config = DEFAULT_CONFIG;
    this.emit();
    this.scheduleSave();
    return this.config;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.config);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 400);
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.config, null, 2), "utf8");
    } catch (err) {
      console.error("[config] save failed:", err);
    }
  }
}
