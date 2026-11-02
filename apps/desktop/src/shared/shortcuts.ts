// Keyboard shortcuts. Handled in the main process via `before-input-event`, so they work
// whether focus is in the browser UI or inside a web page.

export type ShortcutCommand =
  | 'new-tab' | 'close-tab' | 'reopen-tab' | 'new-window' | 'new-private-window' | 'close-window'
  | 'focus-omnibox' | 'reload' | 'hard-reload' | 'stop' | 'back' | 'forward' | 'home'
  | 'next-tab' | 'prev-tab' | 'tab-1' | 'tab-2' | 'tab-3' | 'tab-4' | 'tab-5' | 'tab-6' | 'tab-7' | 'tab-8' | 'last-tab'
  | 'bookmark' | 'history' | 'downloads' | 'bookmarks' | 'settings' | 'toggle-bookmarks-bar'
  | 'find' | 'find-next' | 'find-prev' | 'escape'
  | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fullscreen' | 'print' | 'devtools' | 'view-source' | 'clear-data';

export interface KeyInput {
  type: string; // 'keyDown' | 'keyUp' | ...
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

interface Binding { key: string; mod?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean; cmd: ShortcutCommand }

/** `mod` is Cmd on macOS and Ctrl elsewhere. */
const BINDINGS: Binding[] = [
  { key: 't', mod: true, cmd: 'new-tab' },
  { key: 'w', mod: true, cmd: 'close-tab' },
  { key: 'F4', ctrl: true, cmd: 'close-tab' },
  { key: 't', mod: true, shift: true, cmd: 'reopen-tab' },
  { key: 'n', mod: true, cmd: 'new-window' },
  { key: 'n', mod: true, shift: true, cmd: 'new-private-window' },
  { key: 'p', mod: true, shift: true, cmd: 'new-private-window' },
  { key: 'w', mod: true, shift: true, cmd: 'close-window' },
  { key: 'l', mod: true, cmd: 'focus-omnibox' },
  { key: 'd', alt: true, cmd: 'focus-omnibox' },
  { key: 'F6', cmd: 'focus-omnibox' },
  { key: 'r', mod: true, cmd: 'reload' },
  { key: 'F5', cmd: 'reload' },
  { key: 'r', mod: true, shift: true, cmd: 'hard-reload' },
  { key: 'F5', ctrl: true, cmd: 'hard-reload' },
  { key: 'ArrowLeft', alt: true, cmd: 'back' },
  { key: 'ArrowRight', alt: true, cmd: 'forward' },
  { key: '[', mod: true, cmd: 'back' },
  { key: ']', mod: true, cmd: 'forward' },
  { key: 'Home', alt: true, cmd: 'home' },
  { key: 'Tab', ctrl: true, cmd: 'next-tab' },
  { key: 'Tab', ctrl: true, shift: true, cmd: 'prev-tab' },
  { key: 'PageDown', ctrl: true, cmd: 'next-tab' },
  { key: 'PageUp', ctrl: true, cmd: 'prev-tab' },
  { key: '1', mod: true, cmd: 'tab-1' }, { key: '2', mod: true, cmd: 'tab-2' },
  { key: '3', mod: true, cmd: 'tab-3' }, { key: '4', mod: true, cmd: 'tab-4' },
  { key: '5', mod: true, cmd: 'tab-5' }, { key: '6', mod: true, cmd: 'tab-6' },
  { key: '7', mod: true, cmd: 'tab-7' }, { key: '8', mod: true, cmd: 'tab-8' },
  { key: '9', mod: true, cmd: 'last-tab' },
  { key: 'd', mod: true, cmd: 'bookmark' },
  { key: 'h', mod: true, cmd: 'history' },
  { key: 'y', mod: true, cmd: 'history' },
  { key: 'j', mod: true, cmd: 'downloads' },
  { key: 'o', mod: true, shift: true, cmd: 'bookmarks' },
  { key: ',', mod: true, cmd: 'settings' },
  { key: 'b', mod: true, shift: true, cmd: 'toggle-bookmarks-bar' },
  { key: 'f', mod: true, cmd: 'find' },
  { key: 'g', mod: true, cmd: 'find-next' },
  { key: 'g', mod: true, shift: true, cmd: 'find-prev' },
  { key: 'F3', cmd: 'find-next' },
  { key: 'F3', shift: true, cmd: 'find-prev' },
  { key: 'Escape', cmd: 'escape' },
  { key: '=', mod: true, cmd: 'zoom-in' },
  { key: '+', mod: true, cmd: 'zoom-in' },
  { key: '+', mod: true, shift: true, cmd: 'zoom-in' },
  { key: '-', mod: true, cmd: 'zoom-out' },
  { key: '0', mod: true, cmd: 'zoom-reset' },
  { key: 'F11', cmd: 'fullscreen' },
  { key: 'p', mod: true, cmd: 'print' },
  { key: 'F12', cmd: 'devtools' },
  { key: 'i', mod: true, shift: true, cmd: 'devtools' },
  { key: 'u', mod: true, cmd: 'view-source' },
  { key: 'Delete', mod: true, shift: true, cmd: 'clear-data' },
  { key: 'Backspace', mod: true, shift: true, cmd: 'clear-data' },
];

export function matchShortcut(input: KeyInput, platform: string): ShortcutCommand | null {
  if (input.type !== 'keyDown') return null;
  const mac = platform === 'darwin';
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  for (const b of BINDINGS) {
    const bKey = b.key.length === 1 ? b.key.toLowerCase() : b.key;
    if (bKey !== key) continue;
    const wantCtrl = Boolean(b.ctrl || (b.mod && !mac));
    const wantMeta = Boolean(b.mod && mac);
    if (input.control !== wantCtrl) continue;
    if (input.meta !== wantMeta) continue;
    if (input.alt !== Boolean(b.alt)) continue;
    // Shifted punctuation ("+") reports shift=true; only enforce shift for letters/named keys.
    if (/^[a-z0-9]$|^[A-Z][a-zA-Z0-9]+$/.test(bKey) || bKey === 'Tab' || bKey === ',' || bKey === '=' || bKey === '-') {
      if (input.shift !== Boolean(b.shift)) continue;
    } else if (b.shift && !input.shift) continue;
    return b.cmd;
  }
  return null;
}

/** Commands that should not be swallowed when they come from a web page's editable field. */
export function isPassThroughInPage(cmd: ShortcutCommand): boolean {
  return cmd === 'escape';
}

export const SHORTCUT_HELP: { label: string; keys: string }[] = [
  { label: 'New tab', keys: 'Mod+T' },
  { label: 'Close tab', keys: 'Mod+W' },
  { label: 'Reopen closed tab', keys: 'Mod+Shift+T' },
  { label: 'New window', keys: 'Mod+N' },
  { label: 'New private window', keys: 'Mod+Shift+N' },
  { label: 'Focus address bar', keys: 'Mod+L' },
  { label: 'Next / previous tab', keys: 'Ctrl+Tab / Ctrl+Shift+Tab' },
  { label: 'Go to tab 1–8 / last tab', keys: 'Mod+1…8 / Mod+9' },
  { label: 'Find in page', keys: 'Mod+F' },
  { label: 'Bookmark this page', keys: 'Mod+D' },
  { label: 'History', keys: 'Mod+H' },
  { label: 'Downloads', keys: 'Mod+J' },
  { label: 'Bookmarks', keys: 'Mod+Shift+O' },
  { label: 'Settings', keys: 'Mod+,' },
  { label: 'Zoom in / out / reset', keys: 'Mod+= / Mod+- / Mod+0' },
  { label: 'Full screen', keys: 'F11' },
  { label: 'Clear browsing data', keys: 'Mod+Shift+Delete' },
];
