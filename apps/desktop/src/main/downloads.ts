// Download tracking: progress, pause/resume/cancel, open/show, persistent history (normal windows only).
import { app, Notification, shell, type DownloadItem, type Session } from 'electron';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Profile } from './profile';
import type { DownloadInfo, DownloadSummary } from '../shared/types';

/** Picks "name (1).ext", "name (2).ext"… if the file already exists. */
export function uniquePath(dir: string, filename: string, exists: (p: string) => boolean = existsSync): string {
  const safe = sanitizeFilename(filename) || 'download';
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let i = 1; exists(candidate) && i < 10_000; i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

export function sanitizeFilename(name: string): string {
  return basename(name)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]/g, '_') // control, reserved and bidi-override chars
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200);
}

export class DownloadManager {
  private live = new Map<string, DownloadItem>();
  private privateItems = new Map<string, DownloadInfo>();
  private unseen = 0;
  onChange: () => void = () => {};

  constructor(private profile: Profile) {}

  attach(ses: Session, isPrivate: boolean) {
    ses.on('will-download', (_event, item) => {
      const id = randomUUID();
      const settings = this.profile.settings.get();
      const dir = settings.downloadsDirectory || app.getPath('downloads');
      if (!settings.askWhereToSave) item.setSavePath(uniquePath(dir, item.getFilename()));
      this.live.set(id, item);

      const info = (): DownloadInfo => ({
        id,
        url: item.getURL(),
        filename: basename(item.getSavePath() || item.getFilename()),
        savePath: item.getSavePath(),
        mimeType: item.getMimeType(),
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        status: item.isPaused() ? 'paused' : 'progressing',
        startedAt: Math.round(item.getStartTime() * 1000) || Date.now(),
        private: isPrivate,
      });
      this.store(info());

      let last = 0;
      item.on('updated', (_e, state) => {
        const now = Date.now();
        if (now - last < 250 && state === 'progressing') return; // throttle UI updates
        last = now;
        this.store({ ...info(), status: state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing' });
      });
      item.once('done', (_e, state) => {
        this.live.delete(id);
        const status = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
        const final = { ...info(), status, endedAt: Date.now() } as DownloadInfo;
        this.store(final);
        if (status === 'completed') {
          this.unseen++;
          if (settings.notifyOnDownloadComplete && Notification.isSupported()) {
            const n = new Notification({ title: 'Download complete', body: final.filename, silent: true });
            n.on('click', () => shell.showItemInFolder(final.savePath));
            n.show();
          }
        }
        this.onChange();
      });
    });
  }

  private store(d: DownloadInfo) {
    if (d.private) this.privateItems.set(d.id, d);
    else this.profile.upsertDownload(d);
    this.onChange();
  }

  list(includePrivate: boolean): DownloadInfo[] {
    const persisted = this.profile.downloads.get().map((d) =>
      d.status === 'completed' && d.savePath && !existsSync(d.savePath) ? { ...d, missing: true } : d);
    const priv = includePrivate ? [...this.privateItems.values()] : [];
    return [...priv, ...persisted].sort((a, b) => b.startedAt - a.startedAt);
  }

  private find(id: string): DownloadInfo | undefined {
    return this.privateItems.get(id) ?? this.profile.downloads.get().find((d) => d.id === id);
  }

  summary(includePrivate: boolean): DownloadSummary {
    const active = this.list(includePrivate).filter((d) => d.status === 'progressing' || d.status === 'paused');
    const total = active.reduce((s, d) => s + d.totalBytes, 0);
    const received = active.reduce((s, d) => s + d.receivedBytes, 0);
    return {
      active: active.length,
      progress: active.length === 0 ? 0 : active.some((d) => d.totalBytes <= 0) ? -1 : received / total,
      unseenCompleted: this.unseen,
    };
  }

  markSeen() {
    if (this.unseen) {
      this.unseen = 0;
      this.onChange();
    }
  }

  async action(id: string, action: string): Promise<{ ok: boolean; error?: string }> {
    const d = this.find(id);
    const item = this.live.get(id);
    switch (action) {
      case 'pause': item?.pause(); break;
      case 'resume': if (item?.canResume()) item.resume(); break;
      case 'cancel': item?.cancel(); break;
      case 'open': {
        if (!d || !existsSync(d.savePath)) return { ok: false, error: 'The file has been moved or deleted.' };
        const err = await shell.openPath(d.savePath);
        if (err) return { ok: false, error: err };
        break;
      }
      case 'show':
        if (!d || !existsSync(d.savePath)) return { ok: false, error: 'The file has been moved or deleted.' };
        shell.showItemInFolder(d.savePath);
        break;
      case 'remove':
        if (item) item.cancel();
        if (this.privateItems.delete(id)) this.onChange();
        else this.profile.removeDownload(id);
        break;
      default:
        return { ok: false, error: 'Unknown action' };
    }
    this.onChange();
    return { ok: true };
  }

  urlFor(id: string): string | undefined {
    return this.find(id)?.url;
  }

  clearPrivate() {
    this.privateItems.clear();
    this.onChange();
  }

  clearFinished() {
    this.profile.downloads.set((list) => list.filter((d) => d.status === 'progressing' || d.status === 'paused'));
    for (const [id, d] of this.privateItems) if (d.status !== 'progressing' && d.status !== 'paused') this.privateItems.delete(id);
    this.onChange();
  }
}
