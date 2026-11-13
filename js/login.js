/* ---------- Login page behaviour ---------- */
(function () {
  // Already signed in? Go straight to the dashboard.
  Auth.currentUser().then((u) => { if (u) window.location.replace("dashboard.html"); });
  if (!Auth.configured) {
    document.getElementById("login-error").textContent = "Supabase isn't set up yet: add your URL and key in js/config.js.";
  }

  const tabs = document.querySelectorAll(".auth-tab");
  const panels = document.querySelectorAll(".auth-panel");

  function showPanel(id) {
    panels.forEach((p) => p.classList.toggle("hidden", p.id !== id));
    tabs.forEach((t) => {
      const active = t.dataset.target === id;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active);
    });
    document.querySelectorAll(".form-error").forEach((e) => (e.textContent = ""));
  }

  tabs.forEach((t) => t.addEventListener("click", () => showPanel(t.dataset.target)));
  document.querySelectorAll("[data-switch]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); showPanel(a.dataset.switch); })
  );

  // Show / hide password
  document.querySelectorAll(".toggle-pass").forEach((btn) =>
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.for);
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      btn.textContent = reveal ? "hide" : "show";
    })
  );

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // Login
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const err = document.getElementById("login-error");
    err.textContent = "";

    if (!validEmail(email)) return (err.textContent = "Please enter a valid email address.");
    if (!password) return (err.textContent = "Please enter your password.");

    try {
      await Auth.login(email, password);
      window.location.href = "dashboard.html";
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  // Sign up
  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("signup-name").value;
    const email = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;
    const err = document.getElementById("signup-error");
    err.textContent = "";

    if (name.trim().length < 2) return (err.textContent = "Please enter your full name.");
    if (!validEmail(email)) return (err.textContent = "Please enter a valid email address.");
    if (password.length < 6) return (err.textContent = "Password must be at least 6 characters.");

    try {
      const res = await Auth.register({ name, email, password });
      if (res.needsConfirm) {
        err.textContent = "";
        Utils.toast("Check your email to confirm your account, then log in.", 5000);
        return showPanel("panel-login");
      }
      window.location.href = "dashboard.html";
    } catch (ex) {
      err.textContent = ex.message;
    }
  });

  document.getElementById("forgot-link").addEventListener("click", (e) => {
    e.preventDefault();
    Utils.toast("Password reset isn't wired up in this demo.");
  });

  document.querySelectorAll(".social-btn").forEach((b) =>
    b.addEventListener("click", () => Utils.toast(`${b.dataset.provider} login isn't wired up in this demo.`))
  );
})();
