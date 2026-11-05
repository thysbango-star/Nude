// Rovian Connect, from Nude's own pages: Rovian Account's popup sign-in (no tokens in this flow).
export const ROVIAN = 'https://rovianaccounts.lovable.app';

export type ConnectResult = { type: 'identity'; identity: unknown } | { type: 'denied' } | { type: 'closed' } | { type: 'blocked' };

/** Opens Rovian's Connect popup. Resolves with what Rovian sent, or when the popup is closed. */
export function connectRovian(): { done: Promise<ConnectResult>; cancel: () => void } {
  let popup: Window | null = null;
  let finish: (r: ConnectResult) => void = () => {};
  let timer: number | undefined;
  const done = new Promise<ConnectResult>((resolve) => {
    const onMsg = (event: MessageEvent) => {
      // Only Rovian Account itself, and only the popup this page opened.
      if (event.origin !== ROVIAN || (popup && event.source !== popup)) return;
      const d = (event.data || {}) as { type?: string; identity?: unknown };
      if (d.type === 'rovian:connect-hello') {
        (event.source as Window | null)?.postMessage({ type: 'rovian:site-info', name: 'Nude Browser' }, ROVIAN);
      } else if (d.type === 'rovian:identity') {
        finish({ type: 'identity', identity: d.identity });
      } else if (d.type === 'rovian:denied') {
        finish({ type: 'denied' });
      }
    };
    finish = (r) => {
      window.removeEventListener('message', onMsg);
      clearInterval(timer);
      if (r.type !== 'closed') try { popup?.close(); } catch { /* already closed */ }
      resolve(r);
      finish = () => {};
    };
    window.addEventListener('message', onMsg);
    popup = window.open(`${ROVIAN}/connect`, 'rovian-signin', 'popup,width=480,height=680');
    if (!popup) { finish({ type: 'blocked' }); return; }
    timer = window.setInterval(() => { if (popup?.closed) finish({ type: 'closed' }); }, 600);
  });
  return { done, cancel: () => finish({ type: 'closed' }) };
}
