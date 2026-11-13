/* ---------- Notifications: role changes, community requests / approvals ---------- */
const Notify = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;

  let me = null;
  let items = [];
  const listeners = [];
  let onRole = () => {};
  let channel = null;
  const popupQueue = [];
  let popupOpen = false;

  const on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => fn());

  async function load() {
    const { data, error } = await db().from("notifications").select("*").order("created_at", { ascending: false }).limit(40);
    if (error) { console.warn("Notifications unavailable:", error.message); items = []; }
    else items = data;
    emit();
  }

  async function markRead(id) {
    const n = items.find((x) => x.id === id);
    if (!n || n.read) return;
    n.read = true; emit();
    await db().from("notifications").update({ read: true }).eq("id", id);
  }

  async function markAllRead() {
    const ids = items.filter((x) => !x.read).map((x) => x.id);
    if (!ids.length) return;
    items.forEach((x) => { x.read = true; });
    emit();
    await db().from("notifications").update({ read: true }).in("id", ids);
  }

  /* ----- pop-up for the important ones (becoming an admin, community approved) ----- */
  const POPUP_KINDS = new Set(["role", "community_approved"]);

  function enqueuePopup(n) {
    if (popupQueue.some((x) => x.id === n.id)) return;
    popupQueue.push(n);
    showNextPopup();
  }

  function showNextPopup() {
    if (popupOpen || !popupQueue.length) return;
    const n = popupQueue.shift();
    popupOpen = true;
    const isRole = n.kind === "role";
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal notif-popup" role="dialog" aria-modal="true" aria-labelledby="np-title">
        <div class="np-icon ${isRole ? "role" : "ok"}">${isRole
          ? '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>'
          : '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c.6-3.6 3.2-5.4 6.5-5.4s5.9 1.8 6.5 5.4M16 4.8a3.2 3.2 0 010 6.4M18 14.8c2 .6 3.2 2.3 3.5 5.2"/></svg>'}</div>
        <h3 id="np-title">${esc(n.title)}</h3>
        <p>${esc(n.body)}</p>
        <div class="modal-actions">
          ${n.link ? `<a class="btn primary np-go" href="${esc(n.link)}">${isRole ? "Open" : "View community"}</a>` : ""}
          <button class="btn ghost np-close" type="button">Got it</button>
        </div>
      </div>`;
    const close = () => {
      wrap.remove(); popupOpen = false;
      markRead(n.id);
      showNextPopup();
    };
    wrap.querySelector(".np-close").addEventListener("click", close);
    const go = wrap.querySelector(".np-go");
    if (go) go.addEventListener("click", close);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    wrap.querySelector(".np-close").focus();
  }

  async function init(user, { onRoleChange } = {}) {
    me = user;
    onRole = onRoleChange || (() => {});
    await load();

    // Anything important that arrived while the person was away.
    items.filter((n) => !n.read && POPUP_KINDS.has(n.kind)).reverse().forEach(enqueuePopup);

    channel = db().channel("my-notifications")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` },
        async (payload) => {
          const n = payload.new;
          if (!n || items.some((x) => x.id === n.id)) return;
          items.unshift(n); emit();
          if (n.kind === "role") await onRole();      // show / hide the Admin panel right away
          if (POPUP_KINDS.has(n.kind)) enqueuePopup(n);
          else Utils.toast(n.title + (n.body ? " — " + n.body : ""), 4500);
        })
      .subscribe();
  }

  return {
    init, on, markRead, markAllRead,
    list: () => items,
    get unreadCount() { return items.filter((n) => !n.read).length; }
  };
})();
