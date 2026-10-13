const fs = require('fs');
const path = require('path');

// Automatically load local .env or .env.local if present in Node 20.6+
if (typeof process.loadEnvFile === 'function') {
  ['.env', '.env.local'].forEach(file => {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      try {
        process.loadEnvFile(fullPath);
      } catch (_) {}
    }
  });
}

const url = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).trim();

const publishableKey = (
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

const targetFile = path.join(__dirname, 'supabase-config.js');

if (!url || !publishableKey) {
  if (fs.existsSync(targetFile)) {
    console.log('[build] SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY not set in environment. Preserving existing supabase-config.js.');
    process.exit(0);
  }

  console.error('[build] Error: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not defined in environment variables, and supabase-config.js does not exist.');
  console.error('[build] Please configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in your Vercel project settings or local environment.');
  process.exit(1);
}

const content = `// This file is auto-generated during build.
// Only use the public publishable/anon key here. Never add a service-role key.
window.PIPELINE_SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  publishableKey: ${JSON.stringify(publishableKey)}
};
`;

fs.writeFileSync(targetFile, content, 'utf8');
console.log('[build] Generated supabase-config.js successfully.');
