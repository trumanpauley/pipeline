// Optional Cloudflare Turnstile. When VITE_TURNSTILE_SITE_KEY is set (and
// CAPTCHA protection is enabled in Supabase Auth), anonymous sign-ins and email
// codes carry a token. "interaction-only" stays invisible unless Cloudflare
// actually needs the visitor to click.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Turnstile {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loader: Promise<void> | null = null;
function load() {
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the security check.'));
    document.head.appendChild(s);
  });
  return loader;
}

export async function captchaToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  await load();
  const host = document.createElement('div');
  host.className = 'captcha-host';
  document.body.appendChild(host);
  try {
    return await new Promise<string>((resolve, reject) => {
      const id = window.turnstile!.render(host, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        theme: 'dark',
        callback: resolve,
        'error-callback': () => reject(new Error('Security check failed. Please try again.')),
      });
      window.setTimeout(() => window.turnstile?.remove(id), 120000);
    });
  } finally {
    window.setTimeout(() => host.remove(), 500);
  }
}
