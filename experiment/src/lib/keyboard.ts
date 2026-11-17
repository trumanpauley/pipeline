// Keeps text fields and their buttons above the on-screen keyboard.
//
// iOS Safari doesn't resize the page when the keyboard opens; it covers the
// bottom of the screen. We read the visible area from the Visual Viewport API
// and expose it as CSS variables, which sheets and overlays use to size
// themselves, then scroll the focused field and its submit button into the
// visible area. (Android resizes the page itself; see the viewport meta tag.)
//
//   --vv-top  visible area's offset from the top of the page's viewport
//   --vv-h    visible area's height
//   --kb      height hidden by the keyboard (0 when closed)

const FIELD = 'input:not([type=checkbox]):not([type=radio]), textarea';

function visibleArea() {
  const vv = window.visualViewport;
  if (!vv) return { top: 0, bottom: window.innerHeight };
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}

function scrollParent(el: Element): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** Scroll so the field and the form's submit button are both visible. */
export function revealField(field: Element) {
  const action = field.closest('form')?.querySelector('[type=submit]') ?? field;
  const { top, bottom } = visibleArea();
  const f = field.getBoundingClientRect();
  const a = action.getBoundingClientRect();
  const margin = 16;
  let delta = Math.max(a.bottom, f.bottom) + margin - bottom; // push up until the button clears the keyboard
  delta = Math.min(delta, f.top - (top + margin)); // ...but never push the field itself off the top
  if (delta < 0 && f.top < top + margin) delta = f.top - (top + margin); // field hidden above: bring it down
  if (Math.abs(delta) < 1) return;
  const scroller = scrollParent(field);
  if (scroller === document.scrollingElement || scroller === document.documentElement) {
    window.scrollBy({ top: delta, behavior: 'smooth' });
  } else {
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }
}

export function installKeyboardAvoidance() {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const update = () => {
    if (!vv) return;
    const zoomed = vv.scale > 1.01; // pinch-zoom also shrinks the visual viewport; that's not a keyboard
    const kb = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--vv-top', `${zoomed ? 0 : Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--vv-h', zoomed ? '100dvh' : `${Math.round(vv.height)}px`);
    root.style.setProperty('--kb', `${kb > 80 ? kb : 0}px`);
    root.classList.toggle('kb-open', kb > 80);
  };
  update();
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);

  // After a field gains focus, wait for the keyboard to finish opening (the
  // viewport stops resizing), then make sure the field and button are visible.
  // A second pass runs after sheet/overlay entrance animations have finished,
  // since a field focused as a sheet slides up is measured mid-motion.
  let timers: number[] = [];
  const settle = (field: Element) => {
    timers.forEach((t) => window.clearTimeout(t));
    timers = [120, 650].map((ms) =>
      window.setTimeout(() => {
        if (document.activeElement === field) revealField(field);
      }, ms),
    );
  };
  document.addEventListener('focusin', (e) => {
    const field = e.target as Element;
    if (!field.matches?.(FIELD)) return;
    settle(field);
    const onResize = () => settle(field);
    vv?.addEventListener('resize', onResize);
    window.setTimeout(() => vv?.removeEventListener('resize', onResize), 1500);
  });
}
