(function initializePipelineSupabase() {
  const config = window.PIPELINE_SUPABASE_CONFIG || {};
  const clientFactory = window.supabase?.createClient;

  if (!clientFactory || !config.url || !config.publishableKey || config.url.includes('YOUR_PROJECT_REF')) {
    window.pipelineSupabase = null;
    return;
  }

  window.pipelineSupabase = clientFactory(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
})();
