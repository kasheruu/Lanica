/**
 * Runs after Google's api.js loads. Mounts only when #login-recaptcha exists (DOM ready).
 */
window.onLanicaRecaptchaLoad = function () {
  function mount() {
    var key = String(window.LANICA_RECAPTCHA_SITE_KEY || "").trim();
    var el = document.getElementById("login-recaptcha");
    if (!key) {
      if (el) el.style.display = "none";
      console.warn(
        "[Lanica] Login captcha is disabled: set window.LANICA_RECAPTCHA_SITE_KEY in recaptcha-config.js (use the same file path your login page loads: /recaptcha-config.js vs /public/recaptcha-config.js)."
      );
      return;
    }
    if (el) el.style.display = "";
    if (!el || typeof grecaptcha === "undefined") return;
    if (window.LANICA_RECAPTCHA_WIDGET_ID !== undefined && window.LANICA_RECAPTCHA_WIDGET_ID !== null) {
      return;
    }
    window.LANICA_RECAPTCHA_WIDGET_ID = grecaptcha.render(el, { sitekey: key });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
};
