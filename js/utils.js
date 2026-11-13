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

  return { initials, avatar, toast, escapeHTML, loadJSON, startOfDay, daysBetween, formatTime, formatShortDate, formatLongDate, greeting };
})();
