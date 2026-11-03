// Website permissions: ask by default, remember per origin (normal windows only),
// revocable from Settings. Low-risk capabilities are granted automatically.
import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { Profile } from './profile';
import type { PermissionDecision, PermissionKind, PermissionPrompt } from '../shared/types';
import { originOf } from '../shared/omnibox';

const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write', 'mediaKeySystem', 'speaker-selection']);

export interface PromptHost {
  /** Finds the tab that owns `wc`, or null when it isn't a tab (e.g. a devtools window). */
  tabFor(wc: WebContents): { id: number; private: boolean; isActive(): boolean; showPrompt(): void } | null;
}

interface Pending {
  prompt: PermissionPrompt;
  callback: (granted: boolean) => void;
  privateSession: boolean;
}

export function kindsFor(permission: string, details: { mediaTypes?: Array<'video' | 'audio'> }): PermissionKind[] | null {
  switch (permission) {
    case 'media': {
      const types = details.mediaTypes?.length ? details.mediaTypes : ['video', 'audio'];
      return types.map((t) => (t === 'video' ? 'camera' : 'microphone'));
    }
    case 'notifications': case 'geolocation': case 'clipboard-read': case 'display-capture':
    case 'openExternal': case 'idle-detection': case 'storage-access':
      return [permission];
    case 'top-level-storage-access': return ['storage-access'];
    case 'midi': case 'midiSysex': return ['midi'];
    default: return null; // unknown / device APIs: denied
  }
}

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  notifications: 'Show notifications',
  geolocation: 'Know your location',
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  midi: 'Use MIDI devices',
  'clipboard-read': 'See text and images copied to the clipboard',
  'display-capture': 'Share your screen',
  openExternal: 'Open an external application',
  'idle-detection': 'Know when you are actively using this device',
  'storage-access': 'Use cookies across sites',
};

export class PermissionManager {
  private pending = new Map<string, Pending>();
  /** In-memory decisions for private sessions, keyed by partition. */
  private privateDecisions = new Map<string, Map<string, PermissionDecision>>();

  constructor(private profile: Profile, private host: PromptHost) {}

  private decisionFor(partitionKey: string | null, origin: string, kind: PermissionKind): PermissionDecision | undefined {
    if (kind === 'openExternal') return partitionKey ? this.privateDecisions.get(partitionKey)?.get(`${origin}|${kind}`) : this.profile.getPermission(origin, kind);
    if (partitionKey) return this.privateDecisions.get(partitionKey)?.get(`${origin}|${kind}`);
    return this.profile.getPermission(origin, kind);
  }

  attach(ses: Session, partitionKey: string | null) {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (AUTO_ALLOW.has(permission)) return callback(true);
      const kinds = kindsFor(permission, details as { mediaTypes?: Array<'video' | 'audio'> });
      if (!kinds) return callback(false);
      const origin = originOf(details.requestingUrl || wc.getURL());
      // Internal pages never get web permissions.
      if (origin.startsWith('nude:')) return callback(false);

      const decisions = kinds.map((k) => this.decisionFor(partitionKey, origin, k));
      if (decisions.some((d) => d === 'block')) return callback(false);
      if (decisions.every((d) => d === 'allow')) return callback(true);

      const tab = this.host.tabFor(wc);
      if (!tab) return callback(false);
      const external = (details as { externalURL?: string }).externalURL;
      const prompt: PermissionPrompt = { id: randomUUID(), tabId: tab.id, origin, permissions: kinds, externalUrl: external };
      this.pending.set(prompt.id, { prompt, callback, privateSession: partitionKey !== null });
      tab.showPrompt();
    });

    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      if (AUTO_ALLOW.has(permission)) return true;
      const kinds = kindsFor(permission, { mediaTypes: details.mediaType === 'video' ? ['video'] : details.mediaType === 'audio' ? ['audio'] : undefined });
      if (!kinds) return false;
      const origin = originOf(requestingOrigin);
      return kinds.every((k) => this.decisionFor(partitionKey, origin, k) === 'allow');
    });
  }

  /** The prompt the UI should show for a tab (first in queue), if any. */
  promptForTab(tabId: number): PermissionPrompt | null {
    for (const p of this.pending.values()) if (p.prompt.tabId === tabId) return p.prompt;
    return null;
  }

  respond(promptId: string, allow: boolean, remember: boolean, partitionKey: string | null): number | null {
    const p = this.pending.get(promptId);
    if (!p) return null;
    this.pending.delete(promptId);
    const decision: PermissionDecision = allow ? 'allow' : 'block';
    // openExternal is asked each time unless the user explicitly chooses "always".
    if (remember) {
      for (const k of p.prompt.permissions) {
        if (partitionKey) {
          if (!this.privateDecisions.has(partitionKey)) this.privateDecisions.set(partitionKey, new Map());
          this.privateDecisions.get(partitionKey)!.set(`${p.prompt.origin}|${k}`, decision);
        } else {
          this.profile.setPermission(p.prompt.origin, k, decision);
        }
      }
    }
    p.callback(allow);
    return p.prompt.tabId;
  }

  /** Denies outstanding prompts for a tab (it navigated away or closed). */
  cancelForTab(tabId: number, keepOrigin?: string) {
    for (const [id, p] of this.pending) {
      if (p.prompt.tabId === tabId && p.prompt.origin !== keepOrigin) {
        this.pending.delete(id);
        p.callback(false);
      }
    }
  }

  forgetPrivate(partitionKey: string) {
    this.privateDecisions.delete(partitionKey);
  }
}
