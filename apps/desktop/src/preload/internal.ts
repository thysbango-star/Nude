// Runs in every tab, but only exposes an API on Nude's own nude:// pages.
// Web pages get nothing; the main process re-checks the sender's URL on every call.
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol === 'nude:') {
  contextBridge.exposeInMainWorld('nudeInternal', {
    invoke: (cmd: string, ...args: unknown[]) => ipcRenderer.invoke('internal', cmd, ...args),
    onEvent: (cb: (e: unknown) => void) => {
      const h = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('internal:event', h);
      return () => ipcRenderer.removeListener('internal:event', h);
    },
  });
}
