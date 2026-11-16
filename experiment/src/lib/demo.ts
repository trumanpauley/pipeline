// Demo-only helpers. In the browser-only build (VITE_DEMO_LOCAL=1) the whole
// backend runs in this tab; otherwise they talk to the local mock server.
// The env check is written inline so normal builds drop the PGlite import.
export const isLocalDemo = import.meta.env.VITE_DEMO_LOCAL === '1';

export async function demoNewInvite(): Promise<string> {
  if (import.meta.env.VITE_DEMO_LOCAL === '1') {
    return (await import('../demo/localBackend')).newInvite();
  }
  const { token } = await (await fetch('/__test/new-invite', { method: 'POST' })).json();
  return token;
}

export async function demoReset() {
  if (import.meta.env.VITE_DEMO_LOCAL === '1') {
    await (await import('../demo/localBackend')).resetAll();
  }
}
