// Bridge for the Nude browser UI. Exposes a narrow, typed command channel only.
import { contextBridge, ipcRenderer } from 'electron';

const listen = (channel: string) => (cb: (data: unknown) => void) => {
  const handler = (_e: unknown, data: unknown) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('nude', {
  invoke: (cmd: string, ...args: unknown[]) => ipcRenderer.invoke('chrome', cmd, ...args),
  onState: listen('chrome:state'),
  onCommand: listen('chrome:command'),
  onAi: listen('chrome:ai'),
});
