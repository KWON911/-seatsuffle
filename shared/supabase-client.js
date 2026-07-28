(() => {
  const config = window.KWON_CLASS_SUPABASE_CONFIG;

  if (!config) {
    console.error("Supabase 설정을 찾을 수 없습니다. supabase-config.js를 먼저 불러와 주세요.");
    return;
  }

  const { url, publishableKey } = config;
  const hasPlaceholderConfig = url === "PASTE_PROJECT_URL_HERE"
    || publishableKey === "PASTE_PUBLISHABLE_KEY_HERE";

  if (!url || !publishableKey || hasPlaceholderConfig) {
    console.error("Supabase 연결 설정이 아직 완료되지 않았습니다. URL과 publishable key를 확인해 주세요.");
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase JavaScript 라이브러리를 찾을 수 없습니다. CDN 스크립트를 먼저 불러와 주세요.");
    return;
  }

  if (window.kwonClassSupabase) {
    console.error("Supabase 클라이언트가 이미 생성되어 있습니다.");
    return;
  }

  window.kwonClassSupabase = window.supabase.createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
})();
