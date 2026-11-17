#!/usr/bin/env sh
# Vercel build entry point.
#   default            → the real app (needs VITE_SUPABASE_URL / _PUBLISHABLE_KEY)
#   PIPELINE_DEMO=1    → the browser-only demo (no Supabase; data stays on each device)
#
# Invitation links always use the stable production address, never the
# deployment-specific URL (those can sit behind Vercel's sign-in). Set
# VITE_PUBLIC_APP_URL to choose it (e.g. a custom domain); otherwise Vercel's
# VERCEL_PROJECT_PRODUCTION_URL (the project's production domain) is used.
set -e
if [ -z "$VITE_PUBLIC_APP_URL" ] && [ -n "$VERCEL_PROJECT_PRODUCTION_URL" ]; then
  VITE_PUBLIC_APP_URL="https://$VERCEL_PROJECT_PRODUCTION_URL"
fi
if [ -n "$VITE_PUBLIC_APP_URL" ]; then
  export VITE_PUBLIC_APP_URL
  echo "Invitation links will use: $VITE_PUBLIC_APP_URL"
else
  echo "Warning: no VITE_PUBLIC_APP_URL; invitation links will use whatever address the sender has open."
fi
if [ "$PIPELINE_DEMO" = "1" ]; then
  npm run build:demo
  rm -rf dist && mv dist-demo dist
else
  npm run build
fi
