/* ---------- Feed: text / photo / video posts ---------- */
const Feed = (() => {
  const BUCKET = "post-media";
  const MAX_BYTES = 50 * 1024 * 1024;
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;

  let me = null;
  let channel = null;

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Utils.formatShortDate(new Date(iso)) + ", " + Utils.formatTime(new Date(iso));
  }

  function mount(el, user) {
    me = user;
    el.innerHTML = `
      <div class="composer">
        <textarea id="post-text" rows="3" maxlength="2000" placeholder="What's on your mind, ${esc(user.name.split(" ")[0])}?"></textarea>
        <div class="composer-preview hidden" id="post-preview"></div>
        <div class="composer-bar">
          <label class="attach" title="Add a photo or video">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>
            <span>Photo / Video</span>
            <input type="file" id="post-file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime" hidden />
          </label>
          <button class="btn primary" id="post-btn" disabled>Post</button>
        </div>
      </div>
      <div class="feed-scroll"><div id="feed-list"><div class="empty">Loading posts…</div></div></div>`;

    const text = el.querySelector("#post-text");
    const file = el.querySelector("#post-file");
    const btn = el.querySelector("#post-btn");
    const prev = el.querySelector("#post-preview");
    let picked = null;
    let previewUrl = null;

    const refresh = () => { btn.disabled = !(text.value.trim() || picked); };

    function clearFile() {
      picked = null; file.value = "";
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      prev.classList.add("hidden"); prev.innerHTML = "";
      refresh();
    }

    text.addEventListener("input", refresh);
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      if (!/^(image|video)\//.test(f.type)) { Utils.toast("Please choose a photo or a video."); return clearFile(); }
      if (f.size > MAX_BYTES) { Utils.toast("That file is over 50 MB."); return clearFile(); }
      picked = f;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(f);
      const media = f.type.startsWith("video/")
        ? `<video src="${previewUrl}" controls muted></video>`
        : `<img src="${previewUrl}" alt="Selected photo" />`;
      prev.innerHTML = `${media}<button type="button" class="remove-media" aria-label="Remove attachment">×</button>`;
      prev.classList.remove("hidden");
      prev.querySelector(".remove-media").addEventListener("click", clearFile);
      refresh();
    });

    btn.addEventListener("click", async () => {
      const body = text.value.trim();
      if (!body && !picked) return;
      btn.disabled = true; btn.textContent = "Posting…";
      try {
        let media_url = null, media_type = null, path = null;
        if (picked) {
          const safe = picked.name.replace(/[^\w.\-]+/g, "_");
          path = `${me.id}/${Date.now()}-${safe}`;
          const up = await db().storage.from(BUCKET).upload(path, picked, { contentType: picked.type });
          if (up.error) throw up.error;
          media_url = db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          media_type = picked.type.startsWith("video/") ? "video" : "image";
        }
        const { error } = await db().from("posts").insert({ user_id: me.id, body, media_url, media_type });
        if (error) {
          if (path) await db().storage.from(BUCKET).remove([path]);
          throw error;
        }
        text.value = ""; clearFile();
        Utils.toast("Posted!");
        await load();
      } catch (err) {
        Utils.toast("Couldn't post: " + (err.message || err));
      } finally {
        btn.textContent = "Post"; refresh();
      }
    });

    subscribe();
    load();
  }

  function subscribe() {
    if (channel) return;
    channel = db().channel("feed-posts")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => {
        if (document.getElementById("feed-list")) load();
      })
      .subscribe();
    // other people's reactions / comments: refresh just the engagement bars, not the whole feed
    let t;
    const soon = () => { clearTimeout(t); t = setTimeout(() => refreshEngage(), 300); };
    db().channel("feed-engage")
      .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, soon)
      .subscribe();
  }

  async function load() {
    const list = document.getElementById("feed-list");
    if (!list) return;
    const { data, error } = await db().from("posts").select("*").order("created_at", { ascending: false }).limit(50);
    if (!document.getElementById("feed-list")) return;
    if (error) { list.innerHTML = `<div class="empty">Couldn't load posts: ${esc(error.message)}</div>`; return; }
    if (!data.length) { list.innerHTML = `<div class="empty">No posts yet. Be the first to post!</div>`; return; }
    const profiles = await authors(data);
    if (!document.getElementById("feed-list")) return;
    list.innerHTML = data.map((p) => card(p, profiles)).join("");
    list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remove(b.dataset.del, load)));
    hydrate(list);
  }

  /** Latest username + picture for every author in a list of posts. */
  async function authors(posts) {
    const ids = [...new Set(posts.map((p) => p.user_id))];
    const found = await Social.fetchProfiles(ids);
    return new Map(found.map((p) => [p.id, p]));
  }

  /** Posts by one person (used on a friend's profile). */
  async function userPosts(el, user, userId) {
    me = user;
    el.innerHTML = `<div class="empty">Loading posts…</div>`;
    const { data, error } = await db().from("posts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    if (error) { el.innerHTML = `<div class="empty">Couldn't load posts: ${esc(error.message)}</div>`; return; }
    if (!data.length) { el.innerHTML = `<div class="empty">No posts yet.</div>`; return; }
    const profiles = await authors(data);
    el.innerHTML = data.map((p) => card(p, profiles)).join("");
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remove(b.dataset.del, () => userPosts(el, user, userId))));
    hydrate(el);
  }

  function card(p, profiles = new Map()) {
    const prof = profiles.get(p.user_id);
    const name = (prof && prof.name) || p.author_name || "Unknown";
    const link = p.user_id === me.id ? "#profile" : `#user-${esc(p.user_id)}`;
    const canDelete = p.user_id === me.id || Auth.isStaff(me);
    const media = !p.media_url ? "" : p.media_type === "video"
      ? `<video class="post-media" src="${esc(p.media_url)}" controls preload="metadata"></video>`
      : `<img class="post-media" src="${esc(p.media_url)}" alt="Post photo" loading="lazy" />`;
    return `
      <article class="post">
        <header>
          <a href="${link}" class="post-who">${Utils.avatar(name, prof && prof.avatar)}</a>
          <div><a href="${link}" class="post-name"><strong>${esc(name)}</strong></a><small>${timeAgo(p.created_at)}</small></div>
          ${canDelete ? `<button class="post-del" data-del="${esc(p.id)}" aria-label="Delete post" title="Delete post">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>` : ""}
        </header>
        ${p.body ? `<p class="post-body">${esc(p.body)}</p>` : ""}
        ${media}
        <div class="engage" data-engage="${esc(p.id)}" data-owner="${esc(p.user_id)}">
          <div class="post-actions"></div>
          <div class="comments hidden">
            <div class="c-list"></div>
            <form class="c-form" autocomplete="off">
              <input class="text-input c-input" maxlength="500" placeholder="Write a comment…" aria-label="Write a comment" />
              <button class="btn-sm primary" type="submit">Send</button>
            </form>
          </div>
        </div>
      </article>`;
  }

  /* ================= reactions + comments ================= */
  const REACTIONS = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", fire: "🔥" };
  const LABELS = { like: "Like", love: "Love", haha: "Haha", wow: "Wow", sad: "Sad", fire: "Fire" };
  const eng = new Map();   // post id -> { reacts: [{user_id, kind}], count, comments: [] | null, open, draft }
  const state = (id) => { if (!eng.has(id)) eng.set(id, { reacts: [], count: 0, comments: null, open: false, draft: "" }); return eng.get(id); };
  const engEl = (id) => [...document.querySelectorAll("[data-engage]")].filter((e) => e.dataset.engage === id);

  /** Fetch reactions + comment counts for the posts inside `root`, draw them, and wire the buttons once. */
  async function hydrate(root) {
    bind(root);
    await refreshEngage(root);
  }

  async function refreshEngage(root = document) {
    const els = [...root.querySelectorAll("[data-engage]")];
    const ids = [...new Set(els.map((e) => e.dataset.engage))];
    if (!ids.length) return;
    const [r, c] = await Promise.all([
      db().from("post_reactions").select("post_id,user_id,kind").in("post_id", ids),
      db().from("post_comments").select("post_id").in("post_id", ids)
    ]);
    if (r.error || c.error) {
      els.forEach((e) => { e.querySelector(".post-actions").innerHTML = `<small class="dim">Reactions unavailable — re-run <code>supabase/schema.sql</code>.</small>`; });
      return;
    }
    ids.forEach((id) => { const st = state(id); st.reacts = []; st.count = 0; });
    r.data.forEach((x) => state(x.post_id).reacts.push(x));
    c.data.forEach((x) => { state(x.post_id).count++; });
    // open comment threads need their full text refreshed too
    await Promise.all(ids.filter((id) => state(id).open).map((id) => loadComments(id)));
    ids.forEach(paint);
  }

  async function loadComments(id) {
    const st = state(id);
    const { data, error } = await db().from("post_comments").select("*").eq("post_id", id).order("created_at");
    if (error) { Utils.toast("Couldn't load comments: " + error.message); return; }
    st.comments = data; st.count = data.length;
    const found = await Social.fetchProfiles([...new Set(data.map((x) => x.user_id))]);
    st.people = new Map(found.map((p) => [p.id, p]));
  }

  function paint(id) {
    const st = state(id);
    const mine = st.reacts.find((x) => x.user_id === me.id);
    const tally = {};
    st.reacts.forEach((x) => { tally[x.kind] = (tally[x.kind] || 0) + 1; });
    const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a]).slice(0, 3).map((k) => REACTIONS[k]).join("");
    engEl(id).forEach((el) => {
      el.querySelector(".post-actions").innerHTML = `
        <div class="react-wrap">
          <button type="button" class="act-btn ${mine ? "on" : ""}" data-react-main aria-haspopup="true">
            ${mine ? REACTIONS[mine.kind] + " " + LABELS[mine.kind] : "👍 Like"}</button>
          <div class="react-picker" role="menu">
            ${Object.keys(REACTIONS).map((k) => `<button type="button" role="menuitem" class="${mine && mine.kind === k ? "on" : ""}" data-react="${k}" title="${LABELS[k]}" aria-label="${LABELS[k]}">${REACTIONS[k]}</button>`).join("")}
          </div>
        </div>
        <button type="button" class="act-btn ${st.open ? "on" : ""}" data-comment-toggle aria-expanded="${st.open}">💬 Comment${st.count ? ` · ${st.count}` : ""}</button>
        ${st.reacts.length ? `<span class="react-sum" title="${st.reacts.length} reaction${st.reacts.length === 1 ? "" : "s"}">${top} ${st.reacts.length}</span>` : ""}`;

      const box = el.querySelector(".comments");
      box.classList.toggle("hidden", !st.open);
      if (st.open) {
        const owner = el.dataset.owner;
        const list = el.querySelector(".c-list");
        list.innerHTML = st.comments === null ? `<div class="empty">Loading…</div>`
          : st.comments.length ? st.comments.map((c) => {
              const p = (st.people && st.people.get(c.user_id)) || { name: "Unknown" };
              const can = c.user_id === me.id || owner === me.id || Auth.isStaff(me);
              return `<div class="comment">
                <a href="${c.user_id === me.id ? "#profile" : "#user-" + esc(c.user_id)}" class="post-who">${Utils.avatar(p.name, p.avatar, "sm")}</a>
                <div class="c-bubble"><strong>${esc(p.name)}</strong> <small>${timeAgo(c.created_at)}</small>
                  <p>${esc(c.body)}</p></div>
                ${can ? `<button type="button" class="post-del" data-cdel="${esc(c.id)}" aria-label="Delete comment" title="Delete comment">×</button>` : ""}
              </div>`;
            }).join("")
          : `<div class="empty">No comments yet. Say something!</div>`;
        const input = el.querySelector(".c-input");
        if (document.activeElement !== input) input.value = st.draft;
      }
    });
  }

  function bind(root) {
    if (root._engageBound) return;
    root._engageBound = true;
    const idOf = (t) => t.closest("[data-engage]").dataset.engage;

    root.addEventListener("click", async (e) => {
      const t = e.target;
      const main = t.closest("[data-react-main]");
      const pick = t.closest("[data-react]");
      const tog = t.closest("[data-comment-toggle]");
      const del = t.closest("[data-cdel]");

      if (main) {
        const id = idOf(main), st = state(id);
        const wrap = main.closest(".react-wrap");
        // desktop: one click likes / un-likes; the picker opens on hover. touch: first tap opens the picker.
        if (window.matchMedia("(hover: none)").matches && !wrap.classList.contains("open")) {
          document.querySelectorAll(".react-wrap.open").forEach((w) => w.classList.remove("open"));
          wrap.classList.add("open"); return;
        }
        wrap.classList.remove("open");
        return react(id, st.reacts.some((x) => x.user_id === me.id) ? null : "like");
      }
      if (pick) {
        pick.closest(".react-wrap").classList.remove("open");
        const id = idOf(pick), mine = state(id).reacts.find((x) => x.user_id === me.id);
        return react(id, mine && mine.kind === pick.dataset.react ? null : pick.dataset.react);
      }
      if (tog) {
        const id = idOf(tog), st = state(id);
        st.open = !st.open; paint(id);
        if (st.open) {
          if (st.comments === null) { await loadComments(id); paint(id); }
          const el = engEl(id)[0]; if (el) el.querySelector(".c-input").focus();
        }
        return;
      }
      if (del) {
        const id = idOf(del);
        const { error } = await db().from("post_comments").delete().eq("id", del.dataset.cdel);
        if (error) return Utils.toast("Couldn't delete: " + error.message);
        await loadComments(id); paint(id);
      }
    });

    root.addEventListener("input", (e) => {
      if (e.target.matches(".c-input")) state(idOf(e.target)).draft = e.target.value;
    });

    root.addEventListener("submit", async (e) => {
      if (!e.target.matches(".c-form")) return;
      e.preventDefault();
      const id = idOf(e.target), st = state(id);
      const input = e.target.querySelector(".c-input"), btn = e.target.querySelector("button");
      const body = input.value.trim();
      if (!body) return;
      btn.disabled = true;
      const { error } = await db().from("post_comments").insert({ post_id: id, user_id: me.id, body });
      btn.disabled = false;
      if (error) return Utils.toast("Couldn't comment: " + error.message);
      st.draft = ""; input.value = "";
      await loadComments(id); paint(id);
    });
  }

  /** kind = a reaction key, or null to remove yours. Updates the screen first, rolls back on error. */
  async function react(id, kind) {
    const st = state(id);
    const before = st.reacts.slice();
    st.reacts = st.reacts.filter((x) => x.user_id !== me.id);
    if (kind) st.reacts.push({ post_id: id, user_id: me.id, kind });
    paint(id);
    const { error } = kind
      ? await db().from("post_reactions").upsert({ post_id: id, user_id: me.id, kind }, { onConflict: "post_id,user_id" })
      : await db().from("post_reactions").delete().eq("post_id", id).eq("user_id", me.id);
    if (error) { st.reacts = before; paint(id); Utils.toast("Couldn't react: " + error.message); }
  }

  // close an open reaction picker (touch) when tapping elsewhere
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".react-wrap.open").forEach((w) => { if (!w.contains(e.target)) w.classList.remove("open"); });
  });

  async function remove(id, reload) {
    if (!confirm("Delete this post?")) return;
    const { data: row } = await db().from("posts").select("media_url").eq("id", id).maybeSingle();
    const { error } = await db().from("posts").delete().eq("id", id);
    if (error) return Utils.toast("Couldn't delete: " + error.message);
    if (row && row.media_url && row.media_url.includes(`/${BUCKET}/`)) {
      await db().storage.from(BUCKET).remove([decodeURIComponent(row.media_url.split(`/${BUCKET}/`)[1])]);
    }
    Utils.toast("Post deleted.");
    reload();
  }

  return { mount, load, userPosts };
})();
