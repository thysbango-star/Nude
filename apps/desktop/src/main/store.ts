// Small JSON persistence layer with atomic writes and corrupt-file recovery.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonStore<T> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(data: T) => void>();

  constructor(
    readonly file: string,
    private readonly defaults: () => T,
    private readonly delayMs = 400,
    private readonly migrate: (raw: unknown) => T = (raw) => raw as T,
  ) {
    this.data = this.load();
  }

  private load(): T {
    if (!existsSync(this.file)) return this.defaults();
    try {
      return this.migrate(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (err) {
      // Keep the broken file for diagnosis instead of silently losing user data.
      try {
        copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch { /* ignore */ }
      console.error(`[store] ${this.file} was unreadable and has been reset:`, err);
      return this.defaults();
    }
  }

  get(): T {
    return this.data;
  }

  set(next: T | ((prev: T) => T)): T {
    this.data = typeof next === 'function' ? (next as (prev: T) => T)(this.data) : next;
    this.scheduleSave();
    for (const l of this.listeners) l(this.data);
    return this.data;
  }

  onChange(listener: (data: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes synchronously (used on quit). */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
