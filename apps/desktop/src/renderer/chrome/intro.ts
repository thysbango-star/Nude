// The launch animation, built from the Nude mark: the four letters fly in from the corners, lock together as the
// N U / D E block, turn 45 degrees into the logo, light up, then open out to the browser. About 1.9 seconds.
// It plays once, when Nude starts, and can be turned off in Settings (and never plays with reduced motion).
import { LOGO_LETTERS, LOGO_VIEWBOX, type LogoLetter } from '../../shared/logo';

const FROM: Record<LogoLetter, [number, number, number]> = {
  n: [-340, -260, -24], u: [340, -260, 24], d: [-340, 260, 24], e: [340, 260, -24],
};

export function playIntro(onStart: () => void, onDone: () => void) {
  const el = document.createElement('div');
  el.id = 'intro';
  el.setAttribute('aria-hidden', 'true');
  const letters = (Object.keys(LOGO_LETTERS) as LogoLetter[]).map((k, i) => {
    const [x, y, r] = FROM[k];
    return `<path class="ltr" d="${LOGO_LETTERS[k]}" style="--x:${x}px;--y:${y}px;--r:${r}deg;--i:${i}"/>`;
  }).join('');
  el.innerHTML = `
    <div class="intro-glow"></div>
    <div class="intro-ring"></div>
    <svg class="intro-mark" viewBox="0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}">
      <defs><linearGradient id="intro-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <clipPath id="intro-clip">${(Object.keys(LOGO_LETTERS) as LogoLetter[]).map((k) => `<path d="${LOGO_LETTERS[k]}"/>`).join('')}</clipPath></defs>
      <g class="intro-turn">${letters}<g clip-path="url(#intro-clip)"><rect class="intro-sheen" x="-1024" y="0" width="700" height="1024" fill="url(#intro-sheen)"/></g></g>
    </svg>
    <div class="intro-word">Nude</div>`;
  document.body.appendChild(el);
  onStart();
  // Let layout settle so the first frame is the starting pose.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
    setTimeout(() => el.remove(), 600);
  };
  setTimeout(() => el.classList.add('out'), 1450);
  setTimeout(finish, 1900);
  // Any key or click skips it.
  const skip = () => { el.classList.add('out'); setTimeout(finish, 250); };
  el.addEventListener('pointerdown', skip, { once: true });
  addEventListener('keydown', skip, { once: true });
}
