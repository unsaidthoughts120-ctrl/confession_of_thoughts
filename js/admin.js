/* ---------- Admin panel: users, new logins, post moderation ---------- */
const Admin = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const DAY = 86400000;

  let host = null;
  let tab = "logins";
  let data = { users: [], logins: [], posts: [], requests: [] };
  let watching = false;

  async function mount(el, user) {
    host = el;
    if (!Auth.isStaff(user)) {
      el.innerHTML = `<h1 class="view-title">Admin</h1><div class="empty-state">This page is for admins only.</div>`;
      return;
    }
    el.innerHTML = `<h1 class="view-title">Admin panel</h1><div class="empty-state">Loading…</div>`;
    await reload();
  }

  /** Toast + refresh whenever someone logs in (admins only). */
  function watch(user) {
    if (watching || !Auth.isStaff(user)) return;
    watching = true;
    db().channel("admin-logins")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "login_events" }, (payload) => {
        const n = payload.new || {};
        if (n.user_id !== user.id) Utils.toast(`New login: ${n.name || n.email || "a user"}`, 4000);
        if (host && document.body.contains(host.querySelector(".admin"))) reload();
      })
      .subscribe();
    // New / reviewed community requests: keep the Communities tab live.
    db().channel("admin-community-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_requests" }, () => {
        if (host && host.isConnected && host.querySelector(".admin")) reload();
      })
      .subscribe();
  }

  async function reload() {
    const [u, l, p, c] = await Promise.all([
      db().from("profiles").select("*").order("created_at", { ascending: false }),
      db().from("login_events").select("*").order("created_at", { ascending: false }).limit(200),
      db().from("posts").select("*").order("created_at", { ascending: false }).limit(100),
      db().from("community_requests").select("*").order("created_at", { ascending: false }).limit(200)
    ]);
    // Communities are optional: a missing table shouldn't break the rest of the panel.
    const err = u.error || l.error || p.error;
    if (err) {
      host.innerHTML = `<h1 class="view-title">Admin panel</h1><div class="empty-state">Couldn't load admin data: ${esc(err.message)}<br><br>Did you run <code>supabase/schema.sql</code>?</div>`;
      return;
    }
    data = { users: u.data, logins: l.data, posts: p.data, requests: c.error ? [] : c.data, requestsError: c.error ? c.error.message : null };
    render();
  }

  function render() {
    const now = Date.now();
    const lastLogin = {};
    data.logins.forEach((e) => { if (!lastLogin[e.user_id]) lastLogin[e.user_id] = e.created_at; });
    const logins24 = data.logins.filter((e) => now - new Date(e.created_at) < DAY).length;
    const admins = data.users.filter((x) => x.role === "admin" || x.role === "developer").length;

    const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

    const pendingReqs = data.requests.filter((r) => r.status === "pending");
    const tabs = [["logins", "New logins"], ["users", "Users"], ["posts", "Posts"], ["communities", "Communities"]]
      .map(([k, n]) => `<button class="tab ${tab === k ? "active" : ""}" data-tab="${k}">${n}${k === "communities" && pendingReqs.length ? ` <span class="nav-badge" style="margin-left:6px">${pendingReqs.length}</span>` : ""}</button>`).join("");

    let body = "";
    if (tab === "logins") {
      body = table(["User", "Email", "Logged in"],
        data.logins.map((e) => {
          const fresh = now - new Date(e.created_at) < 3600000 ? ` <span class="chip-new">NEW</span>` : "";
          return [`${esc(e.name || "—")}${fresh}`, esc(e.email), fmt(e.created_at)];
        }), "No logins recorded yet.");
    } else if (tab === "users") {
      body = table(["Name", "Email", "Role", "Joined", "Last login"],
        data.users.map((x) => [esc(x.name || "—"), esc(x.email), `<span class="role-tag ${esc(x.role)}">${esc(x.role)}</span>`, fmt(x.created_at), fmt(lastLogin[x.id])]),
        "No users yet.");
    } else if (tab === "communities") {
      body = communitiesTab(pendingReqs);
    } else {
      body = table(["Author", "Post", "Posted", ""],
        data.posts.map((p) => [
          esc(p.author_name),
          esc((p.body || "").slice(0, 80)) + (p.media_url ? ` <span class="chip-new">${esc(p.media_type || "media")}</span>` : ""),
          fmt(p.created_at),
          `<button class="btn-link danger" data-del="${esc(p.id)}">Delete</button>`
        ]), "No posts yet.");
    }

    host.innerHTML = `
      <h1 class="view-title">Admin panel</h1>
      <div class="admin">
        <div class="stats">${stat("Total users", data.users.length)}${stat("Admins + dev", admins)}${stat("Logins (24h)", logins24)}${stat("Posts", data.posts.length)}</div>
        <div class="tabs">${tabs}</div>
        ${body}
      </div>`;

    Communities.bindReview(host, reload);
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
    host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      const { error } = await db().from("posts").delete().eq("id", b.dataset.del);
      if (error) return Utils.toast("Couldn't delete: " + error.message);
      Utils.toast("Post deleted.");
      reload();
    }));
  }

  function communitiesTab(pendingReqs) {
    if (data.requestsError) {
      return `<div class="empty-state">Couldn't load community requests: ${esc(data.requestsError)}<br><br>Re-run <code>supabase/schema.sql</code> in Supabase.</div>`;
    }
    const who = (id) => data.users.find((x) => x.id === id) || { name: "Unknown", avatar: null };
    const done = data.requests.filter((r) => r.status !== "pending").slice(0, 30);
    const pill = (st) => `<span class="status-pill ${st === "approved" ? "ok" : "bad"}">${st[0].toUpperCase() + st.slice(1)}</span>`;
    return `
      <h2 class="section-title">Waiting for review <span class="count-chip">${pendingReqs.length}</span></h2>
      ${pendingReqs.length ? pendingReqs.map((r) => Communities.reviewRow(r, who(r.requester_id))).join("")
        : `<div class="empty">No requests waiting.</div>`}
      ${done.length ? `<h2 class="section-title">Recently reviewed</h2>` + done.map((r) => `
        <div class="person-row">
          <div class="person-main" style="cursor:default"><div><strong>${esc(r.name)}</strong>
            <small>${esc(who(r.requester_id).name)} · ${fmt(r.reviewed_at || r.created_at)}</small></div></div>
          <div class="person-actions">${pill(r.status)}</div>
        </div>`).join("") : ""}`;
  }

  function table(head, rows, empty) {
    if (!rows.length) return `<div class="empty-state">${empty}</div>`;
    return `<div class="table-wrap"><table class="grades-table admin-table">
      <thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  return { mount, watch };
})();
