/* ---------- Dashboard ---------- */
(async function () {
  const user = await Auth.requireAuth();
  if (!user) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = Utils.escapeHTML;

  const state = { calMonth: new Date() };

  /* ---------- boot ---------- */
  init();

  async function init() {
    setupChrome();
    await Social.init(user, { onMeChange: paintMe });
    Communities.init(user);
    Messages.on(updateBadges);
    Messages.init(user);
    Notify.on(() => { renderNotifications(); updateBadges(); });
    Announce.on(() => {
      renderNotifications(); updateBadges();
      if (location.hash === "#announcements" && $("#ann-list")) paintAnnList();
    });
    Social.on("relations", () => { renderFriendsNav(); renderNotifications(); updateBadges(); paintRequests(); });
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
    paintMe();
    route();
  }

  /* ---------- chrome: sidebar, theme, menus ---------- */
  function setupChrome() {
    paintMe();

    const app = $("#app");
    if (window.innerWidth <= 1099) app.classList.add("collapsed");
    $("#menu-btn").addEventListener("click", () => app.classList.toggle("collapsed"));
    $("#scrim").addEventListener("click", () => app.classList.add("collapsed"));

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
    $("#chat-btn").addEventListener("click", () => { location.hash = "#messages"; });

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
    $("#menu-name").innerHTML = Utils.nameWithBadge(user.name, user.role);
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
    const mb = $("#msg-badge"), mn = Messages.unreadCount;
    mb.textContent = mn > 99 ? "99+" : mn;
    mb.classList.toggle("hidden", mn === 0);
    const nm = $("#nav-msg-badge");
    nm.textContent = mn;
    nm.classList.toggle("hidden", mn === 0);
    const cb = $("#com-badge");
    const n = Notify.list().filter((x) => !x.read && x.kind === "community_request").length;
    cb.textContent = n;
    cb.classList.toggle("hidden", n === 0);
  }

  /* ---------- routing ---------- */
  function route() {
    const hash = (location.hash || "#dashboard").slice(1);
    const view = hash.startsWith("user-") ? "user" : hash.startsWith("community-") ? "community" : hash.startsWith("messages") ? "messages" : hash;
    const navView = view === "community" ? "communities" : view;
    $("#view").dataset.page = view;
    $$(".nav-item[data-view], .subnav-item[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === navView));

    const views = {
      dashboard: renderDashboard,
      calendar: renderCalendar,
      announcements: renderAnnouncements,
      admin: () => Admin.mount($("#view"), user),
      developer: () => Developer.mount($("#view"), user),
      contact: () => Contact.mount($("#view"), user),
      attachments: () => Attachments.mount($("#view"), user),
      messages: () => Messages.mount($("#view"), hash.startsWith("messages-") ? hash.replace("messages-", "") : null),
      communities: () => Communities.mount($("#view")),
      community: () => Communities.mountDetail($("#view"), hash.replace("community-", "")),
      profile: () => Social.mountEdit($("#view")),
      requests: () => Social.mountRequests($("#view")),
      users: () => Social.mountUsers($("#view")),
      user: () => Social.mountUser($("#view"), hash.replace("user-", ""))
    };
    (views[view] || renderEmpty.bind(null, hash))();
    if (window.innerWidth <= 1099) $("#app").classList.add("collapsed");
  }

  /* ---------- views ---------- */
  function renderDashboard() {
    const role = user.role || "student";
    const first = (user.name || "").split(" ")[0].toUpperCase();
    $("#view").innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="greeting">${esc(Utils.greeting())}, ${esc(first)} <span class="role-chip ${esc(role)}">${esc(role === "student" ? "Student" : role)}</span></h1>
          <p class="today">${esc(Utils.formatLongDate(new Date()))}</p>
        </div>
        <div class="controls">
          <a class="btn-ctl" href="#users"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>Find</a>
          <a class="btn-ctl join" href="#communities"><svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/></svg>Join</a>
        </div>
      </div>

      <div class="grid-2">
        <section class="feed-col">
          <h2 class="section-title">Posts</h2>
          <div id="feed"></div>
        </section>

        <aside class="active-panel">
          <div id="req-card"></div>
          <h2 class="section-title">Active now <span class="count-chip" id="active-count">1</span></h2>
          <div class="active-list" id="active-list"></div>
        </aside>
      </div>`;

    Feed.mount($("#feed"), user);
    Social.mountActive($("#active-list"), $("#active-count"));
    paintRequests();
  }

  /** Right column: incoming friend requests with Confirm / Delete. */
  function paintRequests() {
    const el = $("#req-card");
    if (!el || !el.isConnected) return;
    const list = Social.incoming();
    if (!list.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="side-card">
        <div class="side-card-head"><h2 class="section-title">Friend requests</h2><a href="#requests" class="see-all">See all</a></div>
        ${list.slice(0, 3).map(({ p }) => `
          <div class="req-row">
            <a href="#user-${esc(p.id)}">${Utils.avatar(p.name, p.avatar, "lg")}</a>
            <div class="req-main">
              <a href="#user-${esc(p.id)}" class="req-name">${esc(p.name)}</a>
              <div class="req-btns">
                <button class="btn-sm primary" data-friend="accept" data-id="${esc(p.id)}">Confirm</button>
                <button class="btn-sm" data-friend="decline" data-id="${esc(p.id)}">Delete</button>
              </div>
            </div>
          </div>`).join("")}
      </div>`;
    el.querySelectorAll("[data-friend]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      await Social.respond(b.dataset.id, b.dataset.friend === "accept");
    }));
  }

  const annNames = new Set();   // user ids whose names we already asked for (announcement recipient lists)

  function renderAnnouncements() {
    const staff = Auth.isStaff(user);
    $("#view").innerHTML = `<h1 class="view-title">Announcements</h1>` + (staff ? `
      <div class="dev-card ann-compose">
        <h3>New announcement</h3>
        <p class="hint" style="margin-top:0">Send it to everyone, or pick exactly who should get it. They get a pop-up that shows once and stops after 24 hours.</p>
        <form id="ann-form" novalidate>
          <input class="text-input" id="ann-title-in" type="text" maxlength="120" placeholder="Title" autocomplete="off" />
          <textarea class="text-input" id="ann-body-in" rows="3" maxlength="2000" placeholder="Message (optional)" style="margin-top:10px"></textarea>

          <div class="aud-box">
            <span class="field-label">Send to</span>
            <div class="aud-toggle" role="radiogroup" aria-label="Who receives this announcement">
              <label class="aud-opt"><input type="radio" name="aud" value="all" checked /> <span>Everyone</span></label>
              <label class="aud-opt"><input type="radio" name="aud" value="some" /> <span>Specific people</span></label>
            </div>
            <div id="aud-picker" class="aud-picker hidden">
              <input class="text-input" id="aud-q" type="search" maxlength="40" placeholder="Search a username to add…" autocomplete="off" />
              <div id="aud-results" class="aud-results"></div>
              <div id="aud-chips" class="aud-chips"></div>
            </div>
          </div>

          <div class="composer-bar"><span class="dev-msg" id="ann-msg" role="alert"></span><button class="btn primary" type="submit">Post announcement</button></div>
        </form>
      </div>` : "") + `<div id="ann-list"></div>`;

    if (staff) setupAnnForm();
    paintAnnList();
    Announce.markAllSeen();   // opening the page counts as seeing them
  }

  /** Compose form: Everyone / Specific people picker + submit. */
  function setupAnnForm() {
    const picked = new Map();              // id -> profile
    const MAX = 100;
    let timer, searchToken = 0;
    const mode = () => $("#ann-form").elements.aud.value;

    const drawChips = () => {
      $("#aud-chips").innerHTML = picked.size
        ? [...picked.values()].map((p) => `<span class="aud-chip">${Utils.avatar(p.name, p.avatar, "sm")}<span>${esc(p.name)}</span><button type="button" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></span>`).join("")
        : `<small class="dim">Nobody picked yet.</small>`;
    };
    const drawResults = (list) => {
      $("#aud-results").innerHTML = list.length ? list.map((p) => `
        <button type="button" class="aud-result ${picked.has(p.id) ? "on" : ""}" data-add="${esc(p.id)}">
          ${Utils.avatar(p.name, p.avatar, "sm")}<span class="aud-name">${Utils.nameWithBadge(p.name, p.role)}</span>
          <span class="aud-state">${picked.has(p.id) ? "Added ✓" : "Add"}</span>
        </button>`).join("") : `<div class="empty">No users found.</div>`;
      list.forEach((p) => annResults.set(p.id, p));
    };
    const annResults = new Map();
    let lastList = [];

    const search = async () => {
      const q = $("#aud-q").value.trim(), t = ++searchToken;
      let query = Auth.client.from("public_profiles").select("id,name,avatar,bio,role,created_at").neq("id", user.id).limit(8);
      query = q ? query.ilike("name", `%${q}%`).order("name") : query.order("created_at", { ascending: false });
      const { data, error } = await query;
      if (t !== searchToken) return;
      if (error) { $("#aud-results").innerHTML = `<div class="empty">Couldn't search: ${esc(error.message)}</div>`; return; }
      lastList = data;
      drawResults(lastList);
    };

    $$('input[name="aud"]').forEach((r) => r.addEventListener("change", () => {
      const some = mode() === "some";
      $("#aud-picker").classList.toggle("hidden", !some);
      if (some && !lastList.length) search();
    }));
    $("#aud-q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    $("#aud-results").addEventListener("click", (e) => {
      const b = e.target.closest("[data-add]"); if (!b) return;
      const id = b.dataset.add;
      if (picked.has(id)) picked.delete(id);
      else if (picked.size >= MAX) return Utils.toast(`You can pick up to ${MAX} people. Choose Everyone instead.`);
      else picked.set(id, annResults.get(id));
      drawResults(lastList); drawChips();
    });
    $("#aud-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm]"); if (!b) return;
      picked.delete(b.dataset.rm);
      drawResults(lastList); drawChips();
    });
    drawChips();

    $("#ann-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = $("#ann-title-in").value, body = $("#ann-body-in").value, msg = $("#ann-msg");
      msg.textContent = "";
      if (!title.trim()) return (msg.textContent = "Add a title.");
      const some = mode() === "some";
      if (some && !picked.size) return (msg.textContent = "Pick at least one person, or choose Everyone.");
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        await Announce.post({ title, body, audience: some ? [...picked.keys()] : null });
        $("#ann-title-in").value = ""; $("#ann-body-in").value = "";
        Utils.toast(some ? `Announcement sent to ${picked.size} ${picked.size === 1 ? "person" : "people"}.` : "Announcement posted. Everyone will see a pop-up.", 3500);
        if (some) { picked.clear(); drawChips(); drawResults(lastList); }
      } catch (ex) {
        msg.textContent = ex.message.includes("announcements") ? "Couldn't post. Did you re-run supabase/schema.sql?" : ex.message;
      }
      if (btn) btn.disabled = false;
    });
  }

  /** "To: Everyone" / "To: Ann, Bo +3" for staff, "Sent to you" for the people who got it. */
  function audienceTag(a) {
    if (!Announce.isPrivate(a)) return Auth.isStaff(user) ? `<span class="aud-tag">To: Everyone</span>` : "";
    if (!Auth.isStaff(user) || (a.author_id !== user.id && user.role !== "developer")) return `<span class="aud-tag you">Sent to you</span>`;
    const names = a.audience.slice(0, 3).map((id) => esc(Social.person(id).name));
    const more = a.audience.length - names.length;
    return `<span class="aud-tag">To: ${names.join(", ")}${more > 0 ? ` +${more} more` : ""}</span>`;
  }

  function paintAnnList() {
    const list = $("#ann-list");
    if (!list) return;
    const rows = Announce.list();
    if (!rows.length) { list.innerHTML = `<div class="empty-state">No announcements yet.</div>`; return; }

    // Names for the "To: …" line (only the first few recipients of each announcement are shown).
    const need = [...new Set(rows.flatMap((a) => (Announce.isPrivate(a) ? a.audience.slice(0, 3) : [])))].filter((id) => !annNames.has(id));
    if (need.length && Auth.isStaff(user)) {
      need.forEach((id) => annNames.add(id));
      Social.fetchProfiles(need).then(() => { if ($("#ann-list") === list) paintAnnList(); });
    }

    list.innerHTML = rows.map((a) => {
      const canDelete = user.role === "developer" || a.author_id === user.id;
      return `
        <div class="list-card"><h4>${esc(a.title)}${Announce.isFresh(a) ? ` <span class="chip-new">NEW</span>` : ""}</h4>
          <small>${esc(a.author_name || "Admin")} <span class="role-tag ${esc(a.author_role)}">${esc(a.author_role)}</span> · ${Utils.formatLongDate(new Date(a.created_at))} ${audienceTag(a)}</small>
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
