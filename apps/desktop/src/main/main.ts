// Nude Web Browser — main process entry point.
import { app, protocol, Menu } from 'electron';
import { NudeApp } from './app';

app.setName('Nude');
if (process.env.NUDE_USER_DATA) app.setPath('userData', process.env.NUDE_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'nude', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } },
]);

// Hardening that applies to every webContents, including ones created by pages.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let nude: NudeApp | null = null;
  const pendingUrls: string[] = [];

  app.on('second-instance', (_e, argv) => {
    const urls = argv.filter((a) => /^https?:\/\//i.test(a));
    const w = nude?.windows[nude.windows.length - 1];
    if (!nude) return;
    if (!w) {
      nude.createWindow(false, urls[0]);
      return;
    }
    if (urls.length) urls.forEach((u) => w.addTab({ url: u }));
    else w.newTab();
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
  });

  app.on('open-url', (e, url) => {
    e.preventDefault();
    const w = nude?.windows[nude.windows.length - 1];
    if (w) w.addTab({ url });
    else pendingUrls.push(url);
  });

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    nude = new NudeApp();
    await nude.start();
    for (const u of pendingUrls.splice(0)) nude.windows[0]?.addTab({ url: u });
  }).catch((err) => {
    console.error('Nude failed to start', err);
    app.exit(1);
  });

  let shuttingDown = false;
  app.on('before-quit', (e) => {
    if (shuttingDown || !nude) return;
    e.preventDefault();
    shuttingDown = true;
    void nude.shutdown().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (nude && nude.windows.length === 0) nude.createWindow(false);
  });
}
