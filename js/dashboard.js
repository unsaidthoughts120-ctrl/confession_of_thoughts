/* ---------- Dashboard ---------- */
(async function () {
  const user = await Auth.requireAuth();
  if (!user) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = Utils.escapeHTML;

  const state = { term: null, calMonth: new Date() };

  /* ---------- boot ---------- */
  init();

  async function init() {
    setupChrome();
    try {
      const classes = await Utils.loadJSON("data/classes.json");
      state.term = classes.term;
    } catch (err) {
      $("#view").innerHTML = `
        <div class="empty-state">
          <h3>Couldn't load data</h3>
          <p>${esc(err.message)}</p>
          <p>Open this project through a local server (for example <code>python3 -m http.server</code>) instead of double-clicking the file.</p>
        </div>`;
      return;
    }

    $("#sy-label").textContent = `SY ${state.term.schoolYear} · ${state.term.semester}`;
    await Social.init(user, { onMeChange: paintMe });
    Communities.init(user);
    Notify.on(() => { renderNotifications(); updateBadges(); });
    Announce.on(() => {
      renderNotifications(); updateBadges();
      if (location.hash === "#announcements" && $("#ann-list")) paintAnnList();
    });
    Social.on("relations", () => { renderFriendsNav(); renderNotifications(); updateBadges(); });
    Social.on("presence", () => renderFriendsNav());
    renderFriendsNav();
    renderNotifications();
    updateBadges();
    applyRole();
    window.addEventListener("hashchange", route);
    route();
    // Starts last so an "you're now an admin" pop-up appears over a fully drawn page.
    await Notify.init(user, { onRoleChange: refreshRole });
    await Announce.init(user);
  }

  /** Show / hide the Admin + Developer links for the current role. */
  function applyRole() {
    $("#nav-admin").classList.toggle("hidden", !Auth.isStaff(user));
    $("#nav-developer").classList.toggle("hidden", user.role !== "developer");
    if (Auth.isStaff(user)) Admin.watch(user);
  }

  /** The developer just changed this account's role: reload it and update the page without a refresh. */
  async function refreshRole() {
    const fresh = await Auth.currentUser();
    if (!fresh || fresh.role === user.role) return;
    Object.assign(user, fresh);   // same object Social / Feed / Communities hold
    applyRole();
    route();
  }

  /* ---------- chrome: sidebar, theme, menus ---------- */
  function setupChrome() {
    paintMe();

    const app = $("#app");
    if (window.innerWidth <= 760) app.classList.add("collapsed");
    $("#menu-btn").addEventListener("click", () => app.classList.toggle("collapsed"));

    $("#theme-btn").addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("studyhub.theme", next); } catch {}
    });

    $("#notif-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#notif-panel").classList.toggle("hidden"); $("#user-menu").classList.add("hidden"); });
    $("#avatar-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#user-menu").classList.toggle("hidden"); $("#notif-panel").classList.add("hidden"); });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".notif-wrap")) $("#notif-panel").classList.add("hidden");
      if (!e.target.closest(".user-wrap")) $("#user-menu").classList.add("hidden");
    });
    $("#logout-btn").addEventListener("click", Auth.logout);
    $("#notif-panel").addEventListener("click", async (e) => {
      e.stopPropagation();   // the panel re-renders mid-click; don't let the outside-click handler close it
      const fb = e.target.closest("[data-friend]");
      if (fb) {
        fb.disabled = true;
        await Social.respond(fb.dataset.id, fb.dataset.friend === "accept");
        return;
      }
      if (e.target.closest("#notif-readall")) { Notify.markAllRead(); Announce.markAllSeen(); return; }
      const link = e.target.closest("a");
      if (link) {
        if (link.dataset.nid) Notify.markRead(link.dataset.nid);
        $("#notif-panel").classList.add("hidden");
      }
    });
    $("#user-menu").addEventListener("click", (e) => { if (e.target.closest("a")) $("#user-menu").classList.add("hidden"); });
    $("#chat-btn").addEventListener("click", () => Utils.toast("Messages aren't available in this demo."));

    [["classes-toggle", "classes-subnav"], ["library-toggle", "library-subnav"]].forEach(([btn, panel]) => {
      $("#" + btn).addEventListener("click", () => {
        const b = $("#" + btn);
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", !open);
        $("#" + panel).classList.toggle("hidden", open);
      });
    });
  }

  /** Top-right avatar + menu text (re-run after the profile is edited). */
  function paintMe() {
    const avatar = $("#avatar-btn");
    avatar.innerHTML = user.avatar ? `<img src="${esc(user.avatar)}" alt="" />` : esc(Utils.initials(user.name));
    $("#menu-name").textContent = user.name;
    $("#menu-email").textContent = user.email;
  }

  function renderFriendsNav() {
    const list = Social.friends();
    $("#classes-subnav").innerHTML = list.length
      ? list.map((f) => `<a class="subnav-item friend-link" href="#user-${esc(f.id)}"><i class="dot ${Social.isOnline(f.id) ? "on" : ""}"></i>${esc(f.name)}</a>`).join("")
      : `<span class="subnav-item dim">No friends yet</span>`;
  }

  const NOTIF_ICON = { staff_login: "🟢", role: "🛡️", community_request: "📨", community_approved: "✅", community_rejected: "⚠️", community_added: "👥", post_reaction: "👍", post_comment: "💬" };

  function renderNotifications() {
    const reqs = Social.incoming().map(({ p }) => `
      <div class="notif-item notif-friend">
        <div class="notif-row">
          ${Utils.avatar(p.name, p.avatar, "sm")}
          <div><strong>${esc(p.name)} sent you a friend request</strong><small>Add them as a friend?</small></div>
        </div>
        <div class="notif-actions">
          <button class="btn-sm primary" data-friend="accept" data-id="${esc(p.id)}">Add friend</button>
          <button class="btn-sm ghost" data-friend="decline" data-id="${esc(p.id)}">Decline</button>
        </div>
      </div>`);

    const mine = Notify.list().map((n) => `
      <a class="notif-item notif-sys ${n.read ? "" : "unread"}" href="${esc(n.link || "#dashboard")}" data-nid="${esc(n.id)}" style="display:block">
        <div class="notif-row">
          <span class="notif-emoji">${NOTIF_ICON[n.kind] || "🔔"}</span>
          <div><strong>${esc(n.title)}</strong><span class="notif-body">${esc(n.body)}</span>
          <small>${timeAgo(n.created_at)}${n.kind === "role" || n.kind === "staff_login" || n.kind.startsWith("community_") ? " · Admin / Developer" : ""}</small></div>
        </div>
      </a>`);

    const anns = Announce.list().slice(0, 5).map((a) => `
      <a class="notif-item notif-sys ${Announce.isNew(a) ? "unread" : ""}" href="#announcements" style="display:block">
        <div class="notif-row">
          <span class="notif-emoji">📢</span>
          <div><strong>${esc(a.title)}</strong>
          <small>${esc(a.author_name || "Admin")} · ${timeAgo(a.created_at)} · Announcement</small></div>
        </div>
      </a>`);

    const head = (Notify.unreadCount || Announce.newCount)
      ? `<div class="notif-head"><span>Notifications</span><button class="btn-link" id="notif-readall" type="button">Mark all as read</button></div>` : "";
    const all = reqs.concat(mine, anns);
    $("#notif-panel").innerHTML = head + (all.length ? all.join("") : `<div class="empty">You're all caught up.</div>`);
  }

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Utils.formatShortDate(new Date(iso));
  }

  function updateBadges() {
    const pending = Social.pendingCount;
    const total = pending + Notify.unreadCount + Announce.newCount;   // real counts only
    const nb = $("#notif-badge");
    nb.textContent = total > 99 ? "99+" : total;
    nb.classList.toggle("hidden", total === 0);
    const rb = $("#req-badge");
    rb.textContent = pending;
    rb.classList.toggle("hidden", pending === 0);
    const cb = $("#com-badge");
    const n = Notify.list().filter((x) => !x.read && x.kind === "community_request").length;
    cb.textContent = n;
    cb.classList.toggle("hidden", n === 0);
  }

  /* ---------- routing ---------- */
  function route() {
    const hash = (location.hash || "#dashboard").slice(1);
    const view = hash.startsWith("user-") ? "user" : hash.startsWith("community-") ? "community" : hash;
    const navView = view === "community" ? "communities" : view;
    $$(".nav-item[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === navView));

    const views = {
      dashboard: renderDashboard,
      calendar: renderCalendar,
      announcements: renderAnnouncements,
      admin: () => Admin.mount($("#view"), user),
      developer: () => Developer.mount($("#view"), user),
      communities: () => Communities.mount($("#view")),
      community: () => Communities.mountDetail($("#view"), hash.replace("community-", "")),
      profile: () => Social.mountEdit($("#view")),
      requests: () => Social.mountRequests($("#view")),
      users: () => Social.mountUsers($("#view")),
      user: () => Social.mountUser($("#view"), hash.replace("user-", ""))
    };
    (views[view] || renderEmpty.bind(null, hash))();
    if (window.innerWidth <= 760) $("#app").classList.add("collapsed");
  }

  /* ---------- views ---------- */
  function renderDashboard() {
    const now = new Date();
    $("#view").innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="greeting">${Utils.greeting(now)}, ${esc(user.name.toUpperCase())} <span class="role-chip">${esc(user.role || "student")}</span></h1>
          <p class="today">${Utils.formatLongDate(now)}</p>
        </div>
      </div>

      <div class="grid-2">
        <section>
          <h2 class="section-title">Posts</h2>
          <div id="feed"></div>
        </section>

        <aside class="active-panel">
          <h2 class="section-title">Active now <span class="count-chip" id="active-count">1</span></h2>
          <div class="active-list" id="active-list"></div>
        </aside>
      </div>`;

    Feed.mount($("#feed"), user);
    Social.mountActive($("#active-list"), $("#active-count"));
  }

  function renderAnnouncements() {
    const staff = Auth.isStaff(user);
    $("#view").innerHTML = `<h1 class="view-title">Announcements</h1>` + (staff ? `
      <div class="dev-card ann-compose">
        <h3>New announcement</h3>
        <p class="hint" style="margin-top:0">Everyone gets a pop-up. It shows once per person and stops popping up after 24 hours.</p>
        <form id="ann-form" novalidate>
          <input class="text-input" id="ann-title-in" type="text" maxlength="120" placeholder="Title" autocomplete="off" />
          <textarea class="text-input" id="ann-body-in" rows="3" maxlength="2000" placeholder="Message (optional)" style="margin-top:10px"></textarea>
          <div class="composer-bar"><span class="dev-msg" id="ann-msg" role="alert"></span><button class="btn primary" type="submit">Post announcement</button></div>
        </form>
      </div>` : "") + `<div id="ann-list"></div>`;

    if (staff) {
      $("#ann-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = $("#ann-title-in").value, body = $("#ann-body-in").value, msg = $("#ann-msg");
        msg.textContent = "";
        if (!title.trim()) return (msg.textContent = "Add a title.");
        const btn = e.submitter; if (btn) btn.disabled = true;
        try {
          await Announce.post({ title, body });
          $("#ann-title-in").value = ""; $("#ann-body-in").value = "";
          Utils.toast("Announcement posted. Everyone will see a pop-up.", 3500);
        } catch (ex) {
          msg.textContent = ex.message.includes("announcements") ? "Couldn't post. Did you re-run supabase/schema.sql?" : ex.message;
        }
        if (btn) btn.disabled = false;
      });
    }
    paintAnnList();
    Announce.markAllSeen();   // opening the page counts as seeing them
  }

  function paintAnnList() {
    const list = $("#ann-list");
    if (!list) return;
    const rows = Announce.list();
    if (!rows.length) { list.innerHTML = `<div class="empty-state">No announcements yet.</div>`; return; }
    list.innerHTML = rows.map((a) => {
      const canDelete = user.role === "developer" || a.author_id === user.id;
      return `
        <div class="list-card"><h4>${esc(a.title)}${Announce.isFresh(a) ? ` <span class="chip-new">NEW</span>` : ""}</h4>
          <small>${esc(a.author_name || "Admin")} <span class="role-tag ${esc(a.author_role)}">${esc(a.author_role)}</span> · ${Utils.formatLongDate(new Date(a.created_at))}</small>
          ${a.body ? `<p class="ann-text">${esc(a.body)}</p>` : ""}
          ${canDelete ? `<button class="btn-link danger" data-ann-del="${esc(a.id)}" type="button" style="margin-top:8px;padding:0">Delete</button>` : ""}
        </div>`;
    }).join("");
    list.querySelectorAll("[data-ann-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Delete this announcement for everyone?")) return;
      try { await Announce.remove(b.dataset.annDel); Utils.toast("Announcement deleted."); }
      catch (ex) { Utils.toast("Couldn't delete: " + ex.message); }
    }));
  }

  function renderCalendar() {
    const m = state.calMonth;
    const year = m.getFullYear(), month = m.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const events = [];

    let cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < first.getDay(); i++) cells += `<div class="cal-day blank"></div>`;
    for (let d = 1; d <= days; d++) {
      const date = new Date(year, month, d);
      const isToday = Utils.daysBetween(today, date) === 0;
      const todays = events.filter((e) => Utils.daysBetween(date, new Date(e.due)) === 0);
      cells += `<div class="cal-day ${isToday ? "today" : ""}">${d}${todays.map((e) => `<div class="cal-event" title="${esc(e.title)}">${esc(e.title)}</div>`).join("")}</div>`;
    }

    $("#view").innerHTML = `<h1 class="view-title">Calendar</h1>
      <div class="cal"><div class="cal-head">
        <button id="cal-prev" aria-label="Previous month">‹</button>
        <h3>${m.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
        <button id="cal-next" aria-label="Next month">›</button></div>
        <div class="cal-grid">${cells}</div></div>`;

    $("#cal-prev").addEventListener("click", () => { state.calMonth = new Date(year, month - 1, 1); renderCalendar(); });
    $("#cal-next").addEventListener("click", () => { state.calMonth = new Date(year, month + 1, 1); renderCalendar(); });
  }

  function renderEmpty(name) {
    const label = name ? name.charAt(0).toUpperCase() + name.slice(1) : "This page";
    $("#view").innerHTML = `<h1 class="view-title">${esc(label)}</h1><div class="empty-state">${esc(label)} is coming soon.</div>`;
  }
})();
