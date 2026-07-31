(() => {
  function getSupabaseClient() {
    if (!window.kwonClassSupabase || !window.kwonClassSupabase.auth) {
      throw new Error("로그인 기능을 준비하지 못했습니다. Supabase 연결 설정을 확인해 주세요.");
    }

    return window.kwonClassSupabase;
  }

  function toSafeAuthError(error) {
    const source = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();

    if (source.includes("rate") || source.includes("too many") || source.includes("over_email_send_rate_limit")) {
      return "로그인 링크 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    }

    if (source.includes("expired") || source.includes("token")) {
      return "로그인 링크가 만료되었거나 사용할 수 없습니다. 새 링크를 요청해 주세요.";
    }

    if (source.includes("provider") || source.includes("disabled") || source.includes("not enabled")) {
      return "Google 로그인 기능을 현재 사용할 수 없습니다. 관리자에게 문의해 주세요.";
    }

    if (source.includes("fetch") || source.includes("network") || source.includes("internet")) {
      return "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
    }

    return "로그인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }

  async function getCurrentUser() {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getUser();

    if (error) {
      throw new Error(toSafeAuthError(error));
    }

    if (!data.user) {
      return null;
    }

    return { email: data.user.email || null };
  }

  async function signInWithGoogle() {
    const client = getSupabaseClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/account/`
      }
    });

    if (error) {
      throw new Error(toSafeAuthError(error));
    }

    return true;
  }

  async function signOut() {
    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.signOut();

      if (error) {
        return { success: false, error: toSafeAuthError(error) };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: toSafeAuthError(error) };
    }
  }

  function onAuthStateChange(callback) {
    const client = getSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      callback(event, session?.user?.email || null);
    });

    return () => data.subscription.unsubscribe();
  }

  window.kwonClassAuth = Object.freeze({
    getCurrentUser,
    signInWithGoogle,
    signOut,
    onAuthStateChange
  });
})();
