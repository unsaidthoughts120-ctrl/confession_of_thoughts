/* ---------- Announcements: posted by an admin / developer, shown as a pop-up ONCE ----------
   Rules
   - A pop-up only appears for 24 hours after the announcement was posted.
   - Once a person has seen it (pressed "Got it" or closed it) it never pops up again.
     "Seen" is saved in the database (announcement_seen), plus a local copy as a backup.
   - After 24 hours it stops popping up but stays on the Announcements page.
*/
const Announce = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const DAY = 24 * 60 * 60 * 1000;

  let me = null;
  let items = [];              // newest first
  let seen = new Set();
  const listeners = [];
  const queue = [];
  let current = null;          // id of the pop-up on screen
  let retryTimer = null;

  const on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => fn());

  /* ----- "seen" backup in this browser (used if the database is unreachable) ----- */
  const lsKey = () => "studyhub.annSeen." + me.id;
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(lsKey()) || "[]"); } catch { return []; } };
  const writeLocal = () => { try { localStorage.setItem(lsKey(), JSON.stringify([...seen].slice(-200))); } catch {} };

  const isFresh = (a) => Date.now() - new Date(a.created_at).getTime() < DAY;
  /** Should this one pop up / count as new? Fresh, not mine, not seen yet. */
  const isNew = (a) => !!me && isFresh(a) && a.author_id !== me.id && !seen.has(a.id);

  async function load() {
    const [a, s] = await Promise.all([
      db().from("announcements").select("*").order("created_at", { ascending: false }).limit(50),
      db().from("announcement_seen").select("announcement_id")
    ]);
    if (a.error) { console.warn("Announcements unavailable:", a.error.message); items = []; }
    else items = a.data;
    seen = new Set(readLocal());
    if (!s.error) s.data.forEach((r) => seen.add(r.announcement_id));
  }

  async function markSeen(ids) {
    const fresh = ids.filter((id) => !seen.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => seen.add(id));
    writeLocal();
    emit();
    const { error } = await db().from("announcement_seen")
      .upsert(fresh.map((id) => ({ user_id: me.id, announcement_id: id })), { onConflict: "user_id,announcement_id", ignoreDuplicates: true });
    if (error) console.warn("Could not save seen announcement:", error.message);
  }

  /** Viewing the Announcements page / "Mark all as read". */
  const markAllSeen = () => markSeen(items.filter(isNew).map((a) => a.id));

  /* ----- pop-up ----- */
  function enqueue(a) {
    if (a.id === current || queue.some((x) => x.id === a.id)) return;
    queue.push(a);
    showNext();
  }

  function showNext() {
    if (current) return;
    // Wait while another dialog is open so two pop-ups never stack on top of each other.
    if (document.querySelector(".modal-backdrop")) {
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; showNext(); }, 800);
      return;
    }
    let a;
    while ((a = queue.shift())) { if (isNew(a)) break; }   // skip anything already seen / expired
    if (!a) return;

    current = a.id;
    const roleLabel = a.author_role === "developer" ? "Developer" : "Admin";
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal notif-popup ann-popup" role="dialog" aria-modal="true" aria-labelledby="ann-title">
        <div class="np-icon ann"><svg viewBox="0 0 24 24"><path d="M3 11v3a1 1 0 001 1h3l6 4V6L7 10H4a1 1 0 00-1 1zM16 8a5 5 0 010 8"/></svg></div>
        <small class="ann-kicker">Announcement</small>
        <h3 id="ann-title">${esc(a.title)}</h3>
        ${a.body ? `<p class="ann-text">${esc(a.body)}</p>` : ""}
        <small class="ann-meta">From ${esc(a.author_name || roleLabel)} · ${roleLabel} · ${timeAgo(a.created_at)}</small>
        <div class="modal-actions">
          <button class="btn primary ann-close" type="button">Got it</button>
        </div>
      </div>`;
    const close = () => {
      wrap.remove();
      current = null;
      markSeen([a.id]);      // seen = never pops up again
      showNext();
    };
    wrap.querySelector(".ann-close").addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    wrap.querySelector(".ann-close").focus();
  }

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Utils.formatShortDate(new Date(iso));
  }

  /* ----- start ----- */
  async function init(user) {
    me = user;
    await load();
    emit();

    // Anything posted while the person was away (still inside the 24 hours, not seen yet).
    items.filter(isNew).forEach(enqueue);

    db().channel("announcements-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (payload) => {
        const a = payload.new;
        if (!a || items.some((x) => x.id === a.id)) return;
        items.unshift(a);
        emit();
        if (isNew(a)) enqueue(a);          // pops up right away for everyone who is online
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "announcements" }, (payload) => {
        const id = payload.old && payload.old.id;
        if (!id) return;
        items = items.filter((x) => x.id !== id);
        const i = queue.findIndex((x) => x.id === id);
        if (i >= 0) queue.splice(i, 1);
        emit();
      })
      .subscribe();
  }

  /* ----- staff actions ----- */
  async function post({ title, body }) {
    const { data, error } = await db().from("announcements")
      .insert({ author_id: me.id, title: title.trim(), body: body.trim() }).select().single();
    if (error) throw new Error(error.message);
    if (!items.some((x) => x.id === data.id)) items.unshift(data);
    seen.add(data.id); writeLocal();
    emit();
    return data;
  }

  async function remove(id) {
    const { error } = await db().from("announcements").delete().eq("id", id);
    if (error) throw new Error(error.message);
    items = items.filter((x) => x.id !== id);
    emit();
  }

  return {
    init, on, post, remove, markSeen, markAllSeen, isNew, isFresh,
    list: () => items,
    get newCount() { return items.filter(isNew).length; }
  };
})();
