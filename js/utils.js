/* ---------- Shared helpers ---------- */
const Utils = (() => {
  let toastTimer;

  function toast(message, ms = 2600) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  function escapeHTML(str = "") {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.json();
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function formatTime(date) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function formatShortDate(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function formatLongDate(date) {
    return date.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });
  }

  function greeting(date = new Date()) {
    const h = date.getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  function initials(name = "") {
    return name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  }

  /** Round avatar: picture if there is one, otherwise initials. size: "", "sm", "lg", "xl" */
  function avatar(name, url, size = "") {
    const inner = url ? `<img src="${escapeHTML(url)}" alt="" loading="lazy" />` : escapeHTML(initials(name));
    return `<span class="av ${size}">${inner}</span>`;
  }

  /** Wide cover image for a profile; a soft gradient when the person hasn't picked one. */
  function banner(url, cls = "") {
    return `<div class="banner ${url ? "" : "empty"} ${cls}">${url ? `<img src="${escapeHTML(url)}" alt="" loading="lazy" />` : ""}</div>`;
  }

  /** Badge shown next to the name of a developer or admin. Students get nothing. */
  function roleBadge(role) {
    if (role !== "developer" && role !== "admin") return "";
    const label = role === "developer" ? "Developer" : "Admin";
    const icon = role === "developer"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>';
    return `<span class="role-badge ${role}" title="${label}">${icon}${label}</span>`;
  }

  /** Escaped name followed by the role badge (if any). */
  function nameWithBadge(name, role) {
    return `${escapeHTML(name)}${roleBadge(role)}`;
  }

  return { initials, avatar, banner, roleBadge, nameWithBadge, toast, escapeHTML, loadJSON, startOfDay, daysBetween, formatTime, formatShortDate, formatLongDate, greeting };
})();
