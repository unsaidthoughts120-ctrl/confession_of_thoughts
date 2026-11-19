/* ---------- Attachments: folders of photos and code ----------
   "All" shows everything you saved. Picking a folder shows only what is inside it.
   Only an admin or the developer can add / change folders, photos and code. Students can only look at the photos.
   (schema.sql section 19 creates the tables and the "attachments" photo bucket.)
*/
const Attachments = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const BUCKET = "attachments";
  const MAX_BYTES = 10 * 1024 * 1024;
  const SETUP_HINT = "Attachments aren't set up yet. Re-run supabase/schema.sql (section 19) in Supabase.";

  let me, root, token = 0, staff = false;
  let folders = [], items = [];
  let current = "all";            // "all" | "none" | folder id

  const fail = (err) => Utils.toast(/relation|bucket|does not exist|not found/i.test(err.message || "") ? SETUP_HINT : (err.message || String(err)), 5000);

  async function mount(el, user) {
    me = user; root = el; staff = Auth.isStaff(user);
    const mine = ++token;
    el.innerHTML = `<div class="empty">Loading…</div>`;
    const [f, a] = await Promise.all([
      db().from("attachment_folders").select("*").order("created_at"),
      db().from("attachments").select("*").order("created_at", { ascending: false })
    ]);
    if (mine !== token) return;
    const err = f.error || a.error;
    if (err) { el.innerHTML = `<h1 class="view-title">Attachments</h1><div class="empty-state"><h3>Couldn't load attachments</h3><p>${esc(/relation|does not exist/i.test(err.message) ? SETUP_HINT : err.message)}</p></div>`; return; }
    folders = f.data || [];
    items = (a.data || []).filter((x) => staff || x.kind === "photo");   // students only ever see photos
    if (current !== "all" && current !== "none" && !folders.some((x) => x.id === current)) current = "all";
    paint();
  }

  const visible = () => items.filter((x) => current === "all" ? true : current === "none" ? !x.folder_id : x.folder_id === current);
  const count = (id) => items.filter((x) => id === "all" ? true : id === "none" ? !x.folder_id : x.folder_id === id).length;
  const folderName = () => current === "all" ? "All attachments" : current === "none" ? "No folder" : (folders.find((x) => x.id === current) || {}).name || "";

  function paint() {
    const real = current !== "all" && current !== "none";
    const chip = (id, label, extra = "") =>
      `<button type="button" class="att-chip ${current === id ? "active" : ""}" data-folder="${esc(id)}">${extra}<span>${esc(label)}</span><em>${count(id)}</em></button>`;
    const folderIcon = `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`;
    const list = visible();

    root.innerHTML = `
      <div class="page-intro">
        <h1 class="view-title">Attachments</h1>
        <p class="sub">${staff ? "Save photos and code, and sort them into folders. Everyone can see the photos; only staff can see the code." : "Photos shared by the admin and developer team."}</p>
      </div>

      <div class="att-folders">
        ${chip("all", "All")}
        ${folders.map((f) => chip(f.id, f.name, folderIcon)).join("")}
        ${count("none") && folders.length ? chip("none", "No folder") : ""}
        ${staff ? `<button type="button" class="att-chip add" id="att-newfolder">+ New folder</button>` : ""}
      </div>

      <div class="att-bar">
        <h2 class="section-title">${esc(folderName())} <span class="count-chip">${list.length}</span></h2>
        <div class="att-actions">
          ${staff && real ? `<button class="btn-sm ghost" id="att-rename" type="button">Rename</button><button class="btn-sm ghost danger" id="att-delfolder" type="button">Delete folder</button>` : ""}
          ${staff ? `<input type="file" id="att-file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden />
          <button class="btn-sm primary" id="att-addphoto" type="button">+ Add photo</button>` : ""}
        </div>
      </div>
      <div class="att-grid" id="att-grid">
        ${list.length ? list.map(card).join("") : `<div class="empty-state att-empty">${staff ? (current === "all" ? "Nothing here yet. Add a photo or code below." : "This folder is empty. Add a photo or code below and it goes in here.") : (current === "all" ? "No photos yet." : "No photos in this folder yet.")}</div>`}
      </div>

      ${staff ? `<form class="dev-card att-code" id="att-code-form" novalidate>
        <label class="att-code-label" for="att-code-in">Attachment code:</label>
        <input class="text-input" id="att-code-title" type="text" maxlength="120" placeholder="Title (optional)" autocomplete="off" />
        <textarea class="text-input att-code-in" id="att-code-in" rows="6" maxlength="50000" spellcheck="false" placeholder="code here"></textarea>
        <div class="composer-bar">
          <small class="dim">${current === "all" || current === "none" ? "Saves without a folder." : `Saves into “${esc(folderName())}”.`}</small>
          <button class="btn primary" type="submit">Add code</button>
        </div>
      </form>` : ""}`;
    bind();
  }

  function card(x) {
    const when = Utils.formatShortDate(new Date(x.created_at));
    const fname = x.folder_id ? (folders.find((f) => f.id === x.folder_id) || {}).name : "";
    const meta = `<small>${esc(when)}${current === "all" && fname ? ` · ${esc(fname)}` : ""}</small>`;
    if (!staff) {
      return `<div class="att-card photo"><a href="${esc(x.media_url)}" target="_blank" rel="noopener"><img src="${esc(x.media_url)}" alt="${esc(x.title || "Photo")}" loading="lazy" /></a>
        <div class="att-body">${x.title ? `<strong>${esc(x.title)}</strong>` : ""}${meta}</div></div>`;
    }
    const move = `<select class="att-move" data-move="${esc(x.id)}" aria-label="Move to folder">
        <option value="">No folder</option>${folders.map((f) => `<option value="${esc(f.id)}" ${f.id === x.folder_id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`;
    const tools = `<div class="att-tools">${move}${x.kind === "code" ? `<button class="btn-link" data-copy="${esc(x.id)}" type="button">Copy</button>` : ""}<button class="btn-link danger" data-del="${esc(x.id)}" type="button">Delete</button></div>`;
    if (x.kind === "photo") {
      return `<div class="att-card photo"><a href="${esc(x.media_url)}" target="_blank" rel="noopener"><img src="${esc(x.media_url)}" alt="${esc(x.title || "Photo")}" loading="lazy" /></a>
        <div class="att-body">${x.title ? `<strong>${esc(x.title)}</strong>` : ""}${meta}${tools}</div></div>`;
    }
    return `<div class="att-card code"><div class="att-body">${x.title ? `<strong>${esc(x.title)}</strong>` : ""}${meta}
      <pre class="att-pre"><code>${esc(x.code)}</code></pre>${tools}</div></div>`;
  }

  function bind() {
    root.querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => { current = b.dataset.folder; paint(); }));
    if (!staff) return;     // students: view only, nothing to wire up
    root.querySelector("#att-newfolder").addEventListener("click", newFolder);
    const rn = root.querySelector("#att-rename"); if (rn) rn.addEventListener("click", rename);
    const df = root.querySelector("#att-delfolder"); if (df) df.addEventListener("click", delFolder);

    const file = root.querySelector("#att-file");
    root.querySelector("#att-addphoto").addEventListener("click", () => file.click());
    file.addEventListener("change", () => uploadPhotos([...file.files]).finally(() => (file.value = "")));

    root.querySelector("#att-code-form").addEventListener("submit", addCode);

    const grid = root.querySelector("#att-grid");
    grid.addEventListener("click", (e) => {
      const d = e.target.closest("[data-del]"), c = e.target.closest("[data-copy]");
      if (d) removeItem(d.dataset.del);
      if (c) {
        const it = items.find((x) => x.id === c.dataset.copy);
        navigator.clipboard.writeText(it ? it.code : "").then(() => Utils.toast("Code copied."), () => Utils.toast("Couldn't copy."));
      }
    });
    grid.addEventListener("change", (e) => { const s = e.target.closest("[data-move]"); if (s) moveItem(s.dataset.move, s.value || null); });
  }

  const currentFolderId = () => (current === "all" || current === "none" ? null : current);

  async function newFolder() {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const name = (prompt("Folder name") || "").trim().slice(0, 60);
    if (!name) return;
    const { data, error } = await db().from("attachment_folders").insert({ name, owner_id: me.id }).select().single();
    if (error) return fail(error);
    folders.push(data); current = data.id; paint();
  }

  async function rename() {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const f = folders.find((x) => x.id === current); if (!f) return;
    const name = (prompt("Rename folder", f.name) || "").trim().slice(0, 60);
    if (!name || name === f.name) return;
    const { error } = await db().from("attachment_folders").update({ name }).eq("id", f.id);
    if (error) return fail(error);
    f.name = name; paint();
  }

  async function delFolder() {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const f = folders.find((x) => x.id === current); if (!f) return;
    const n = count(f.id);
    if (!confirm(`Delete the folder “${f.name}”?${n ? ` Its ${n} item${n === 1 ? "" : "s"} will stay under All.` : ""}`)) return;
    const { error } = await db().from("attachment_folders").delete().eq("id", f.id);
    if (error) return fail(error);
    folders = folders.filter((x) => x.id !== f.id);
    items.forEach((x) => { if (x.folder_id === f.id) x.folder_id = null; });
    current = "all"; paint();
  }

  async function uploadPhotos(files) {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const btn = root.querySelector("#att-addphoto");
    const good = files.filter((f) => /^image\/(jpeg|png|gif|webp)$/.test(f.type) && f.size <= MAX_BYTES);
    if (good.length < files.length) Utils.toast("Only photos up to 10 MB are added (JPG, PNG, GIF, WebP).", 4000);
    if (!good.length) return;
    btn.disabled = true; btn.textContent = "Uploading…";
    const folder_id = currentFolderId();
    let ok = 0;
    for (const f of good) {
      const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      try {
        const up = await db().storage.from(BUCKET).upload(path, f, { contentType: f.type });
        if (up.error) throw up.error;
        const media_url = db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const { data, error } = await db().from("attachments")
          .insert({ owner_id: me.id, folder_id, kind: "photo", title: f.name.replace(/\.[^.]+$/, "").slice(0, 120), media_url }).select().single();
        if (error) { await db().storage.from(BUCKET).remove([path]); throw error; }
        items.unshift(data); ok++;
      } catch (err) { fail(err); }
    }
    if (ok) Utils.toast(ok === 1 ? "Photo added." : `${ok} photos added.`);
    paint();
  }

  async function addCode(e) {
    e.preventDefault();
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const code = root.querySelector("#att-code-in").value;
    if (!code.trim()) return root.querySelector("#att-code-in").focus();
    const btn = e.submitter; if (btn) btn.disabled = true;
    const title = root.querySelector("#att-code-title").value.trim().slice(0, 120) || null;
    const { data, error } = await db().from("attachments")
      .insert({ owner_id: me.id, folder_id: currentFolderId(), kind: "code", title, code }).select().single();
    if (error) { if (btn) btn.disabled = false; return fail(error); }
    items.unshift(data); Utils.toast("Code added."); paint();
  }

  async function removeItem(id) {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const it = items.find((x) => x.id === id); if (!it) return;
    if (!confirm(`Delete this ${it.kind}?`)) return;
    const { error } = await db().from("attachments").delete().eq("id", id);
    if (error) return fail(error);
    if (it.media_url && it.media_url.includes(`/${BUCKET}/`)) {
      db().storage.from(BUCKET).remove([decodeURIComponent(it.media_url.split(`/${BUCKET}/`)[1].split("?")[0])]).catch(() => {});
    }
    items = items.filter((x) => x.id !== id); paint();
  }

  async function moveItem(id, folder_id) {
    if (!staff) return Utils.toast("Only an admin or developer can do that.", 3500);
    const { error } = await db().from("attachments").update({ folder_id }).eq("id", id);
    if (error) return fail(error);
    const it = items.find((x) => x.id === id); if (it) it.folder_id = folder_id;
    Utils.toast("Moved."); paint();
  }

  return { mount };
})();
