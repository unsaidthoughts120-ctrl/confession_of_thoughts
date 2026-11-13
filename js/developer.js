/* ---------- Developer panel: create admins, manage every account ---------- */
const Developer = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  let host = null, me = null, users = [];

  async function mount(el, user) {
    host = el; me = user;
    if (user.role !== "developer") {
      el.innerHTML = `<h1 class="view-title">Developer</h1><div class="empty-state">This page is for the developer account only.</div>`;
      return;
    }
    el.innerHTML = `<h1 class="view-title">Developer panel</h1><div class="empty-state">Loading…</div>`;
    await reload();
  }

  async function reload() {
    const { data, error } = await db().from("profiles").select("*").order("created_at", { ascending: false });
    if (error) {
      host.innerHTML = `<h1 class="view-title">Developer panel</h1><div class="empty-state">Couldn't load accounts: ${esc(error.message)}<br><br>Did you re-run <code>supabase/schema.sql</code>?</div>`;
      return;
    }
    users = data;
    render();
  }

  function render() {
    const count = (r) => users.filter((u) => u.role === r).length;
    const stat = (l, v) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;

    const rows = users.map((u) => {
      const self = u.role === "developer";
      const roleCell = self
        ? `<span class="role-tag developer">developer</span>`
        : `<select class="role-select" data-role="${esc(u.id)}">
             <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
             <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
           </select>`;
      const action = self ? "" : `<button class="btn-link danger" data-del="${esc(u.id)}" data-name="${esc(u.name || u.email)}">Delete</button>`;
      return `<tr><td>${esc(u.name || "—")}</td><td>${esc(u.email)}</td><td>${roleCell}</td><td>${fmt(u.created_at)}</td><td>${action}</td></tr>`;
    }).join("");

    host.innerHTML = `
      <h1 class="view-title">Developer panel</h1>
      <div class="admin">
        <div class="stats">${stat("Accounts", users.length)}${stat("Admins", count("admin"))}${stat("Students", count("student"))}</div>

        <div class="dev-card">
          <h3>Create an admin account</h3>
          <p class="hint">Admin accounts can only be created here. Admins can moderate posts and see users and logins.</p>
          <form class="dev-form" id="admin-form" novalidate>
            <input type="text" id="adm-name" placeholder="Full name" autocomplete="off" />
            <input type="email" id="adm-email" placeholder="Email" autocomplete="off" />
            <input type="password" id="adm-pass" placeholder="Password (min 6)" autocomplete="new-password" />
            <button class="btn primary" type="submit">Create admin</button>
          </form>
          <p class="dev-msg" id="adm-msg" role="alert"></p>
        </div>

        <div class="dev-card">
          <h3>All accounts</h3>
          <p class="hint">Change someone between Student and Admin, or delete their account (this also deletes their posts).</p>
          <div class="table-wrap"><table class="grades-table admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>
        </div>
      </div>`;

    host.querySelector("#admin-form").addEventListener("submit", onCreate);

    host.querySelectorAll("[data-role]").forEach((sel) => sel.addEventListener("change", async () => {
      const { error } = await db().rpc("set_user_role", { target: sel.dataset.role, new_role: sel.value });
      if (error) { Utils.toast("Couldn't change role: " + error.message); return reload(); }
      Utils.toast("Role updated.");
      reload();
    }));

    host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Permanently delete ${b.dataset.name}? This also deletes their posts.`)) return;
      const { error } = await db().rpc("delete_user", { target: b.dataset.del });
      if (error) return Utils.toast("Couldn't delete: " + error.message);
      Utils.toast("Account deleted.");
      reload();
    }));
  }

  async function onCreate(e) {
    e.preventDefault();
    const msg = host.querySelector("#adm-msg");
    const name = host.querySelector("#adm-name").value;
    const email = host.querySelector("#adm-email").value;
    const password = host.querySelector("#adm-pass").value;
    msg.className = "dev-msg"; msg.textContent = "";

    if (name.trim().length < 2) return (msg.textContent = "Enter the admin's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (msg.textContent = "Enter a valid email address.");
    if (password.length < 6) return (msg.textContent = "Password must be at least 6 characters.");

    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      await Auth.createAdmin({ name, email, password });
      Utils.toast(`Admin account created for ${email.trim()}.`, 3500);
      await reload();
    } catch (ex) {
      msg.textContent = ex.message;
      if (btn) btn.disabled = false;
    }
  }

  return { mount };
})();
