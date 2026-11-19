/* ---------- Contact staff: message the developer or any admin ----------
   Lists every Developer / Admin account with a quick message box.
   The message lands in their normal Messages inbox, so they can reply there.
   (schema.sql section 18 lets anyone message staff, and lets staff reply to anyone.)
*/
const Contact = (() => {
  const esc = Utils.escapeHTML;
  const db = () => Auth.client;
  const ROLE_NOTE = {
    developer: "Bugs, account problems, feature ideas",
    admin: "Reports, posts, communities and moderation"
  };
  let token = 0;

  async function mount(el, me) {
    const mine = ++token;
    el.innerHTML = `
      <div class="page-intro">
        <h1 class="view-title">Contact staff</h1>
        <p class="sub">Need help or want to report something? Send a message to the developer or an admin. They reply in your Messages.</p>
      </div>
      <div id="contact-list"><div class="empty">Loading…</div></div>`;
    const box = el.querySelector("#contact-list");

    const { data, error } = await db().from("public_profiles")
      .select("id,name,avatar,banner,bio,role,created_at").in("role", ["developer", "admin"]).neq("id", me.id);
    if (mine !== token) return;
    if (error) { box.innerHTML = `<div class="empty-state"><h3>Couldn't load staff</h3><p>${esc(error.message)}</p></div>`; return; }

    const staff = (data || []).slice().sort((a, b) =>
      (a.role === "developer" ? 0 : 1) - (b.role === "developer" ? 0 : 1) || a.name.localeCompare(b.name));
    if (!staff.length) { box.innerHTML = `<div class="empty-state">There is nobody else on the staff team yet.</div>`; return; }

    box.innerHTML = `<div class="contact-grid">${staff.map(card).join("")}</div>`;

    box.querySelectorAll(".contact-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = form.querySelector("textarea"), btn = form.querySelector("button");
        const text = input.value.trim();
        if (!text) return input.focus();
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          await Messages.send(form.dataset.to, text);
          input.value = "";
          Utils.toast("Message sent. Replies will show up in Messages.", 3500);
        } catch (ex) {
          Utils.toast(ex.message, 5000);
        } finally {
          btn.disabled = false; btn.textContent = "Send message";
        }
      });
    });

    const paintOnline = () => {
      if (mine !== token || !box.isConnected) return false;
      box.querySelectorAll("[data-online]").forEach((n) => {
        const on = Social.isOnline(n.dataset.online);
        n.innerHTML = on ? '<span class="online-text">● Online now</span>' : "Offline";
      });
    };
    paintOnline();
    Social.on("presence", paintOnline);
    Social.fetchProfiles(staff.map((p) => p.id));   // so the Messages inbox can show their names
  }

  function card(p) {
    const label = p.role === "developer" ? "Developer" : "Admin";
    return `
      <article class="contact-card">
        ${Utils.banner(p.banner, "slim")}
        <div class="contact-body">
          <a class="contact-who" href="#user-${esc(p.id)}">
            ${Utils.avatar(p.name, p.avatar, "lg")}
            <div>
              <strong>${Utils.nameWithBadge(p.name, p.role)}</strong>
              <small data-online="${esc(p.id)}"></small>
            </div>
          </a>
          <p class="contact-note"><b>${label}</b> · ${esc(ROLE_NOTE[p.role] || "")}</p>
          ${p.bio ? `<p class="contact-bio">${esc(p.bio)}</p>` : ""}
          <form class="contact-form" data-to="${esc(p.id)}">
            <textarea class="text-input" rows="3" maxlength="1000" placeholder="Write a message to ${esc(p.name)}…" aria-label="Message to ${esc(p.name)}"></textarea>
            <div class="contact-actions">
              <a class="btn-sm ghost" href="#messages-${esc(p.id)}">Open chat</a>
              <button class="btn-sm primary" type="submit">Send message</button>
            </div>
          </form>
        </div>
      </article>`;
  }

  return { mount };
})();
