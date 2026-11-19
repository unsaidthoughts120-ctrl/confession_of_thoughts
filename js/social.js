/* ---------- Social: profiles, friends, requests, active users ---------- */
const Social = (() => {
  const AVATAR_BUCKET = "avatars";
  const MAX_AVATAR = 5 * 1024 * 1024;
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;

  let me = null;
  let rels = [];                 // my friendship rows
  const people = new Map();      // id -> public profile (cache)
  let online = new Map();        // id -> presence meta
  let presence = null;
  let onMeChanged = () => {};
  const watchers = { relations: [], presence: [] };
  let viewToken = 0;
  const probed = new Set();       // ids we already tried to load a profile for (avoids refetch loops)
  let activeToken = 0;

  function on(name, fn) { watchers[name].push(fn); }
  function emit(name) { watchers[name] = watchers[name].filter((fn) => fn() !== false); }

  /* ---------- data ---------- */
  async function fetchProfiles(ids) {
    if (!ids.length) return [];
    const { data, error } = await db().from("public_profiles").select("id,name,avatar,banner,bio,role,created_at").in("id", ids);
    if (error) { console.warn(error.message); return []; }
    data.forEach((p) => people.set(p.id, p));
    return data;
  }
  async function fetchProfile(id) { return (await fetchProfiles([id]))[0] || null; }

  const other = (r) => (r.requester_id === me.id ? r.addressee_id : r.requester_id);

  async function loadRelations() {
    const { data, error } = await db().from("friendships").select("*").order("created_at", { ascending: false });
    if (error) { console.warn("Friends unavailable:", error.message); rels = []; }
    else rels = data;
    const ids = [...new Set(rels.map(other))];
    if (ids.length) await fetchProfiles(ids);
    emit("relations");
  }

  function relation(id) {
    const r = rels.find((x) => x.requester_id === id || x.addressee_id === id);
    if (!r) return { state: "none" };
    if (r.status === "accepted") return { state: "friends", row: r };
    return { state: r.requester_id === me.id ? "sent" : "received", row: r };
  }

  const person = (id) => people.get(id) || { id, name: "Unknown", avatar: null, banner: null, bio: "", role: "student" };
  const friends = () => rels.filter((r) => r.status === "accepted").map((r) => person(other(r)));
  const incoming = () => rels.filter((r) => r.status === "pending" && r.addressee_id === me.id).map((r) => ({ row: r, p: person(r.requester_id) }));
  const outgoing = () => rels.filter((r) => r.status === "pending" && r.requester_id === me.id).map((r) => ({ row: r, p: person(r.addressee_id) }));
  const isOnline = (id) => id === me.id || online.has(id);

  async function addFriend(id) {
    const rel = relation(id);
    if (rel.state === "received") return accept(rel.row);
    if (rel.state !== "none") return;
    const { error } = await db().from("friendships").insert({ requester_id: me.id, addressee_id: id });
    if (error) return Utils.toast("Couldn't send request: " + error.message);
    Utils.toast("Friend request sent.");
    await loadRelations();
  }
  async function accept(row) {
    const { error } = await db().from("friendships").update({ status: "accepted" }).eq("id", row.id);
    if (error) return Utils.toast("Couldn't accept: " + error.message);
    Utils.toast("Friend request accepted.");
    await loadRelations();
  }
  async function dropRow(row, msg) {
    const { error } = await db().from("friendships").delete().eq("id", row.id);
    if (error) return Utils.toast("Something went wrong: " + error.message);
    Utils.toast(msg);
    await loadRelations();
  }

  /** Used by the notification panel: accept or decline an incoming request by the sender's id. */
  async function respond(id, accepted) {
    const rel = relation(id);
    if (rel.state !== "received") return;
    if (accepted) await accept(rel.row);
    else await dropRow(rel.row, "Request declined.");
  }

  /* ---------- shared UI bits ---------- */
  function actionsHTML(id) {
    const { state } = relation(id);
    const b = (act, label, cls = "") => `<button class="btn-sm ${cls}" data-act="${act}" data-id="${esc(id)}">${label}</button>`;
    if (state === "friends") return `<span class="status-pill ok">Friends</span>${b("unfriend", "Unfriend", "ghost")}`;
    if (state === "sent") return `<span class="status-pill">Request sent</span>${b("cancel", "Cancel", "ghost")}`;
    if (state === "received") return b("accept", "Accept", "primary") + b("reject", "Reject", "ghost");
    return b("add", "Add friend", "primary");
  }

  function bindActions(root) {
    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const rel = relation(id);
        btn.disabled = true;
        switch (btn.dataset.act) {
          case "add": await addFriend(id); break;
          case "accept": if (rel.row) await accept(rel.row); break;
          case "reject": if (rel.row) await dropRow(rel.row, "Request rejected."); break;
          case "cancel": if (rel.row) await dropRow(rel.row, "Request cancelled."); break;
          case "unfriend":
            if (rel.row && confirm(`Remove ${person(id).name} from your friends?`)) await dropRow(rel.row, "Friend removed.");
            else btn.disabled = false;
            break;
        }
      });
    });
  }

  function row(p, right = "") {
    return `<div class="person-row">
      <a href="#user-${esc(p.id)}" class="person-main">
        ${Utils.avatar(p.name, p.avatar)}
        <div><strong>${Utils.nameWithBadge(p.name, p.role)}</strong><small>${p.bio ? esc(p.bio) : "No bio yet"}</small></div>
      </a>
      <div class="person-actions">${right}</div>
    </div>`;
  }

  /* ---------- Edit my profile ---------- */
  function mountEdit(el) {
    ++viewToken;
    el.innerHTML = `
      <div class="page-intro">
        <h1 class="view-title">Edit profile</h1>
        <p class="sub">Choose how other people see you on ConfessHub.</p>
      </div>
      <form class="profile-edit" id="pf-form" novalidate>
        <div class="banner-edit">
          <label class="field-label">Profile banner</label>
          <div id="banner-preview"></div>
          <div class="pfp-btns">
            <label class="btn-sm primary file-btn">Change banner
              <input type="file" id="banner-file" accept="image/jpeg,image/png,image/gif,image/webp" hidden />
            </label>
            <button class="btn-sm ghost" id="banner-remove" type="button">Remove</button>
          </div>
          <small class="dim">Wide pictures look best (about 3:1) · JPG, PNG, GIF or WEBP · max 5 MB</small>
        </div>
        <div class="pfp-edit">
          <div id="pfp-preview"></div>
          <div class="pfp-btns">
            <label class="btn-sm primary file-btn">Change photo
              <input type="file" id="pfp-file" accept="image/jpeg,image/png,image/gif,image/webp" hidden />
            </label>
            <button class="btn-sm ghost" id="pfp-remove" type="button">Remove</button>
          </div>
          <small class="dim">JPG, PNG, GIF or WEBP · max 5 MB</small>
        </div>
        <div class="form-col">
          <label class="field-label" for="pf-name">Username ${Utils.roleBadge(me.role)}</label>
          <input class="text-input" id="pf-name" maxlength="40" autocomplete="nickname" value="${esc(me.name)}" />
          <label class="field-label" for="pf-bio">Bio <span class="dim" id="bio-count"></span></label>
          <textarea class="text-input" id="pf-bio" rows="4" maxlength="300" placeholder="Tell people a little about you…">${esc(me.bio || "")}</textarea>
          <label class="field-label" for="pf-email">Email</label>
          <input class="text-input" id="pf-email" value="${esc(me.email || "")}" disabled />
          <p class="hint">Other people only see your photo, username and bio. Your email stays private.</p>
          <div class="form-actions">
            <button class="btn primary" id="pf-save" type="submit">Save changes</button>
          </div>
        </div>
      </form>`;

    const $ = (s) => el.querySelector(s);
    let pickedFile = null, previewUrl = null, removed = false;
    let bannerFile = null, bannerPreview = null, bannerRemoved = false;

    const drawPfp = () => {
      const url = removed ? null : (previewUrl || me.avatar);
      $("#pfp-preview").innerHTML = Utils.avatar($("#pf-name").value || me.name, url, "xl");
    };
    const drawBanner = () => {
      const url = bannerRemoved ? null : (bannerPreview || me.banner);
      $("#banner-preview").innerHTML = Utils.banner(url);
    };
    const countBio = () => { $("#bio-count").textContent = `${$("#pf-bio").value.length}/300`; };
    drawPfp(); drawBanner(); countBio();

    $("#pf-bio").addEventListener("input", countBio);
    $("#pf-name").addEventListener("input", () => { if (!previewUrl && (removed || !me.avatar)) drawPfp(); });
    $("#pfp-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { e.target.value = ""; return Utils.toast("Please choose a JPG, PNG, GIF or WEBP photo."); }
      if (f.size > MAX_AVATAR) { e.target.value = ""; return Utils.toast("That photo is over 5 MB."); }
      pickedFile = f; removed = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(f);
      drawPfp();
    });
    $("#banner-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) { e.target.value = ""; return Utils.toast("Please choose a JPG, PNG, GIF or WEBP picture."); }
      if (f.size > MAX_AVATAR) { e.target.value = ""; return Utils.toast("That picture is over 5 MB."); }
      bannerFile = f; bannerRemoved = false;
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      bannerPreview = URL.createObjectURL(f);
      drawBanner();
    });
    $("#banner-remove").addEventListener("click", () => {
      bannerFile = null; bannerRemoved = true;
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      bannerPreview = null; $("#banner-file").value = "";
      drawBanner();
    });
    $("#pfp-remove").addEventListener("click", () => {
      pickedFile = null; removed = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null; $("#pfp-file").value = "";
      drawPfp();
    });

    /** Update the profile row and make sure a row was really changed (RLS can silently match 0 rows). */
    async function saveRow(fields) {
      const run = () => db().from("profiles").update(fields).eq("id", me.id).select("id");
      let res = await run();
      if (!res.error && !(res.data && res.data.length)) {
        await db().rpc("ensure_my_profile");          // profile row missing? create it, then retry once
        res = await run();
      }
      if (res.error) throw res.error;
      if (!res.data || !res.data.length)
        throw new Error("The database refused the update. Re-run supabase/schema.sql (section 16) in Supabase.");
    }

    $("#pf-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#pf-name").value.trim();
      const bio = $("#pf-bio").value.trim();
      if (!name) return Utils.toast("Username can't be empty.");
      const btn = $("#pf-save");
      btn.disabled = true; btn.textContent = "Saving…";
      const uploaded = [];      // new files, removed again if the save fails
      /** Upload one picture into this person's folder and return its public URL. */
      const upload = async (file, prefix) => {
        const ext = (file.name.match(/\.(\w{1,5})$/) || [, "jpg"])[1].toLowerCase();
        const path = `${me.id}/${prefix}${Date.now()}.${ext}`;
        const up = await db().storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600" });
        if (up.error) throw new Error(/bucket not found/i.test(up.error.message)
          ? "Photo storage isn't set up yet. Re-run supabase/schema.sql (section 16) in Supabase."
          : /row-level security|not authorized|policy/i.test(up.error.message)
            ? "Photo upload was blocked. Re-run supabase/schema.sql (section 16) in Supabase."
            : up.error.message);
        uploaded.push(path);
        return db().storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      };
      try {
        let avatar = me.avatar || null, banner = me.banner || null;
        const oldPath = avatarPath(me.avatar), oldBanner = avatarPath(me.banner);
        if (pickedFile) avatar = await upload(pickedFile, "");
        else if (removed) avatar = null;
        if (bannerFile) banner = await upload(bannerFile, "banner-");
        else if (bannerRemoved) banner = null;
        try { await saveRow({ name, bio, avatar, banner }); }
        catch (err) {
          if (/banner/i.test(err.message || "")) throw new Error("Banner isn't set up yet. Re-run supabase/schema.sql (section 18) in Supabase.");
          throw err;
        }
        const stale = [];
        if (oldPath && avatar !== me.avatar) stale.push(oldPath);
        if (oldBanner && banner !== me.banner) stale.push(oldBanner);
        if (stale.length) db().storage.from(AVATAR_BUCKET).remove(stale).catch(() => {});
        me.name = name; me.bio = bio; me.avatar = avatar; me.banner = banner;
        people.set(me.id, { id: me.id, name, bio, avatar, banner, role: me.role, created_at: me.created_at });
        if (presence) presence.track({ name, avatar });
        onMeChanged();
        pickedFile = null; removed = false; bannerFile = null; bannerRemoved = false; uploaded.length = 0;
        if (bannerPreview) { URL.revokeObjectURL(bannerPreview); bannerPreview = null; }
        $("#pfp-file").value = ""; $("#banner-file").value = "";
        drawBanner();
        emit("presence");
        Utils.toast("Profile saved!");
      } catch (err) {
        if (uploaded.length) db().storage.from(AVATAR_BUCKET).remove(uploaded).catch(() => {});
        Utils.toast("Couldn't save: " + (err.message || err), 5000);
      } finally {
        btn.disabled = false; btn.textContent = "Save changes";
      }
    });
  }

  function avatarPath(url) {
    if (!url || !url.includes(`/${AVATAR_BUCKET}/`)) return null;
    return decodeURIComponent(url.split(`/${AVATAR_BUCKET}/`)[1].split("?")[0]);
  }

  /* ---------- Someone else's profile ---------- */
  async function mountUser(el, id) {
    if (id === me.id) { location.hash = "#profile"; return; }
    const token = ++viewToken;
    el.innerHTML = `<div class="empty">Loading profile…</div>`;

    // Ask the database directly so a real error is never mistaken for "no such user".
    const { data, error } = await db().from("public_profiles").select("id,name,avatar,banner,bio,role,created_at").eq("id", id).maybeSingle();
    if (token !== viewToken) return;

    let p = data;
    if (p) people.set(p.id, p);
    else {
      // No profile row (or it couldn't be read): fall back to what we already know about this person.
      const known = people.get(id);
      const live = online.get(id);
      if (known) p = known;
      else if (live) p = { id, name: live.name || "Unknown", avatar: live.avatar || null, bio: "", role: "student", created_at: null };
    }

    if (!p) {
      el.innerHTML = error
        ? `<p class="today"><a href="#dashboard" style="color:var(--accent)">← Back</a></p>
           <div class="empty-state"><h3>Couldn't load this profile</h3><p>${esc(error.message)}</p>
           <p>If this keeps happening, re-run <code>supabase/schema.sql</code> in Supabase.</p>
           <button class="btn primary" id="retry-profile">Try again</button></div>`
        : `<p class="today"><a href="#dashboard" style="color:var(--accent)">← Back</a></p>
           <div class="empty-state">This account no longer exists.</div>`;
      const retry = el.querySelector("#retry-profile");
      if (retry) retry.addEventListener("click", () => mountUser(el, id));
      return;
    }

    const joined = p.created_at ? new Date(p.created_at) : null;
    const draw = () => {
      if (token !== viewToken) return false;
      const isFriend = relation(id).state === "friends";
      el.innerHTML = `
        <p class="today"><a href="#dashboard" style="color:var(--accent)">← Back</a></p>
        <div class="profile-card">
        ${Utils.banner(p.banner)}
        <div class="profile-head">
          ${Utils.avatar(p.name, p.avatar, "xl")}
          <div class="profile-info">
            <h1 class="view-title profile-name">${Utils.nameWithBadge(p.name, p.role)}</h1>
            ${p.role === "developer" || p.role === "admin" ? `<p class="staff-note">${p.role === "developer" ? "Developer of ConfessHub" : "Admin / moderator"} · verified staff account</p>` : ""}
            <p class="bio">${p.bio ? esc(p.bio) : '<span class="dim">No bio yet.</span>'}</p>
            <small class="dim">${[joined ? `Joined ${Utils.formatShortDate(joined)}, ${joined.getFullYear()}` : "", isOnline(id) ? '<span class="online-text">● Online now</span>' : ""].filter(Boolean).join(" · ")}</small>
          </div>
          <div class="profile-actions"><a class="btn-sm primary" href="#messages-${esc(id)}">Message</a> ${actionsHTML(id)}</div>
        </div>
        </div>
        <div id="profile-posts"></div>`;
      bindActions(el);
      const box = el.querySelector("#profile-posts");
      if (isFriend) {
        box.innerHTML = `<h2 class="section-title">Posts by ${esc(p.name)}</h2><div id="profile-feed"></div>`;
        Feed.userPosts(box.querySelector("#profile-feed"), me, id);
      } else {
        box.innerHTML = `<div class="lock-card">Add ${esc(p.name)} as a friend and, once they accept, you can see all their posts right here.</div>`;
      }
    };
    draw();
    on("relations", draw);
  }

  /* ---------- Friend requests + friends list ---------- */
  function mountRequests(el) {
    const token = ++viewToken;
    const draw = () => {
      if (token !== viewToken) return false;
      const inc = incoming(), out = outgoing(), fr = friends();
      const section = (title, count, body) => `<h2 class="section-title">${title} <span class="count-chip">${count}</span></h2>${body}`;
      el.innerHTML = `
        <h1 class="view-title">Friend requests</h1>
        ${section("Received", inc.length, inc.length
          ? inc.map(({ p }) => row(p, actionsHTML(p.id))).join("")
          : `<div class="empty">No pending requests.</div>`)}
        ${section("Sent", out.length, out.length
          ? out.map(({ p }) => row(p, actionsHTML(p.id))).join("")
          : `<div class="empty">You haven't sent any requests.</div>`)}
        ${section("My friends", fr.length, fr.length
          ? fr.map((p) => row(p, `${isOnline(p.id) ? '<span class="online-text">● Online</span>' : ""}<a class="btn-sm primary" href="#user-${esc(p.id)}">View profile</a>`)).join("")
          : `<div class="empty">No friends yet. Use <a href="#users" style="color:var(--accent)">Search → User</a> to find people.</div>`)}`;
      bindActions(el);
    };
    draw();
    on("relations", draw);
    loadRelations();
  }

  /* ---------- Search users ---------- */
  function mountUsers(el) {
    const token = ++viewToken;
    el.innerHTML = `
      <h1 class="view-title">Find people</h1>
      <input class="text-input search-input" id="user-q" placeholder="Search by username…" maxlength="40" autocomplete="off" />
      <div id="user-results"></div>`;
    const results = el.querySelector("#user-results");
    let lastList = [];
    let timer;

    const draw = () => {
      if (token !== viewToken) return false;
      results.innerHTML = lastList.length
        ? lastList.map((p) => row(p, actionsHTML(p.id))).join("")
        : `<div class="empty">No users found.</div>`;
      bindActions(results);
    };
    const search = async () => {
      const q = el.querySelector("#user-q").value.trim();
      let query = db().from("public_profiles").select("id,name,avatar,banner,bio,role,created_at").neq("id", me.id).limit(30);
      query = q ? query.ilike("name", `%${q}%`).order("name") : query.order("created_at", { ascending: false });
      const { data, error } = await query;
      if (token !== viewToken) return;
      if (error) { results.innerHTML = `<div class="empty">Couldn't search: ${esc(error.message)}</div>`; return; }
      data.forEach((p) => people.set(p.id, p));
      lastList = data;
      draw();
    };
    el.querySelector("#user-q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    on("relations", draw);
    search();
  }

  /* ---------- Active users panel (dashboard, next to posts) ---------- */
  function mountActive(listEl, countEl) {
    const token = ++activeToken;
    const draw = () => {
      if (token !== activeToken || !listEl.isConnected) return false;
      const ids = [me.id, ...[...online.keys()].filter((id) => id !== me.id)];
      const friendIds = new Set(friends().map((f) => f.id));
      const metaOf = (id) => (id === me.id ? { name: me.name, avatar: me.avatar } : online.get(id));
      ids.sort((a, b) => (a === me.id ? -1 : b === me.id ? 1 : (friendIds.has(b) - friendIds.has(a)) || metaOf(a).name.localeCompare(metaOf(b).name)));
      countEl.textContent = ids.length;
      // Roles aren't in the presence data: fetch any profile we haven't seen yet, then redraw once.
      const unknown = ids.filter((id) => !people.has(id) && !probed.has(id));
      if (unknown.length) { unknown.forEach((id) => probed.add(id)); fetchProfiles(unknown).then(() => { if (listEl.isConnected) draw(); }); }
      listEl.innerHTML = ids.map((id) => {
        const m = metaOf(id);
        const tag = id === me.id ? "You" : friendIds.has(id) ? "Friend" : "";
        return `<a class="active-user" href="${id === me.id ? "#profile" : "#user-" + esc(id)}">
          <span class="av-wrap">${Utils.avatar(m.name, m.avatar, "sm")}<i class="dot"></i></span>
          <span class="active-name">${Utils.nameWithBadge(m.name, id === me.id ? me.role : (people.get(id) || {}).role)}</span>${tag ? `<small>${tag}</small>` : ""}
        </a>`;
      }).join("");
    };
    draw();
    on("presence", draw);
    on("relations", draw);
  }

  /* ---------- boot ---------- */
  async function init(user, { onMeChange } = {}) {
    me = user;
    onMeChanged = onMeChange || (() => {});
    people.set(me.id, { id: me.id, name: me.name, avatar: me.avatar, banner: me.banner || null, bio: me.bio || "", role: me.role, created_at: me.created_at });

    presence = db().channel("online-users", { config: { presence: { key: me.id } } });
    presence
      .on("presence", { event: "sync" }, () => {
        const state = presence.presenceState();
        online = new Map(Object.entries(state).map(([id, metas]) => [id, metas[0]]));
        emit("presence");
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await presence.track({ name: me.name, avatar: me.avatar });
      });

    db().channel("my-friendships")
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => loadRelations())
      .subscribe();

    await loadRelations();
  }

  return {
    init, on, fetchProfiles, person, respond, mountEdit, mountUser, mountRequests, mountUsers, mountActive,
    friends, incoming, isOnline,
    get pendingCount() { return incoming().length; }
  };
})();
