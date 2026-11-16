#!/usr/bin/env sh
# Vercel build entry point.
#   default            → the real app (needs VITE_SUPABASE_URL / _PUBLISHABLE_KEY)
#   PIPELINE_DEMO=1    → the browser-only demo (no Supabase; data stays on each device)
set -e
if [ "$PIPELINE_DEMO" = "1" ]; then
  npm run build:demo
  rm -rf dist && mv dist-demo dist
else
  npm run build
fi
