/* ---------- Auth (Supabase) ---------- */
const Auth = (() => {
  const cfg = window.STUDYHUB_CONFIG || {};
  const configured =
    !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY &&
    !/YOUR-/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) && !!window.supabase;

  const client = configured
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  const COLS = "*";   // own row: includes banner once schema section 18 is run, and still works before

  async function fetchProfile(authUser) {
    let { data, error } = await client.from("profiles").select(COLS).eq("id", authUser.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      // Profile row missing (account older than the signup trigger): ask the database to create it.
      const fix = await client.rpc("ensure_my_profile");
      if (fix.error) console.warn("Could not repair profile:", fix.error.message);
      else ({ data } = await client.from("profiles").select(COLS).eq("id", authUser.id).maybeSingle());
    }
    return data || { id: authUser.id, name: authUser.email.split("@")[0], email: authUser.email, role: "student", avatar: null, bio: "" };
  }

  /** Current signed-in profile, or null. */
  async function currentUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    try { return await fetchProfile(data.session.user); }
    catch (err) { console.warn(err); return null; }
  }

  async function recordLogin(profile) {
    const { error } = await client.from("login_events").insert({ user_id: profile.id });
    if (error) console.warn("Could not record login:", error.message);
  }

  async function login(email, password) {
    if (!client) throw new Error("Supabase isn't configured yet. See README.");
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
    const profile = await fetchProfile(data.user);
    await recordLogin(profile);
    return profile;
  }

  /** Returns { profile } when signed in, or { needsConfirm: true } if email confirmation is on. */
  async function register({ name, email, password }) {
    if (!client) throw new Error("Supabase isn't configured yet. See README.");
    // Sign-up always makes a normal account; the database decides the role.
    const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
    if (error) throw new Error(error.message);
    if (!data.session) return { needsConfirm: true };
    const profile = await fetchProfile(data.user);
    await recordLogin(profile);
    return { profile };
  }

  /** Sends a real password-reset email through Supabase. */
  async function resetPassword(email) {
    if (!client) throw new Error("Supabase isn't configured yet. See README.");
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: new URL("index.html", location.href).href });
    if (error) throw new Error(error.message);
  }

  /** Google / Facebook sign-in (the provider must be switched on in Supabase > Authentication > Providers). */
  async function loginWithProvider(provider) {
    if (!client) throw new Error("Supabase isn't configured yet. See README.");
    const { error } = await client.auth.signInWithOAuth({ provider: provider.toLowerCase(), options: { redirectTo: new URL("dashboard.html", location.href).href } });
    if (error) throw new Error(/not enabled|unsupported/i.test(error.message) ? `${provider} sign-in isn't switched on for this site yet.` : error.message);
  }

  async function requireAuth() {
    const user = await currentUser();
    if (!user) window.location.replace("index.html");
    return user;
  }

  async function logout() {
    if (client) await client.auth.signOut();
    window.location.replace("index.html");
  }

  /**
   * Developer only: create an ADMIN account. Uses a throw-away client so the
   * developer stays signed in, then promotes the new account via the database.
   */
  async function createAdmin({ name, email, password }) {
    if (!client) throw new Error("Supabase isn't configured yet.");
    const tmp = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await tmp.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
    if (error) throw new Error(error.message);
    if (!data.user || (data.user.identities && data.user.identities.length === 0))
      throw new Error("An account with that email already exists. Use the Accounts list to promote it.");
    const { error: e2 } = await client.rpc("set_user_role", { target: data.user.id, new_role: "admin" });
    if (e2) throw new Error(e2.message);
    return data.user;
  }

  const isStaff = (u) => !!u && (u.role === "admin" || u.role === "developer");

  return { configured, isStaff, createAdmin, get client() { return client; }, login, register, resetPassword, loginWithProvider, currentUser, requireAuth, logout };
})();
