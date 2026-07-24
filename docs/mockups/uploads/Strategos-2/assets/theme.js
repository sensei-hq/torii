/* ─────────────────────────────────────────────────────────────
   Annotated Canvas · theme.js
   Reads stored theme, applies it, and wires every
   <button class="theme-toggle"> on the page to flip it.

   Markup (anywhere on the page):
     <button class="theme-toggle" aria-label="Flip theme">
       <span class="icon icon-sun" aria-hidden="true">☀</span>
       <span class="icon icon-moon" aria-hidden="true">☾</span>
       <span class="label"></span>
     </button>
   The label fills in automatically (light → "Dark", dark → "Light").
   ───────────────────────────────────────────────────────────── */
(function () {
  const KEY = 'ac-theme';
  const root = document.documentElement;
  const stored = (() => { try { return localStorage.getItem(KEY); } catch (e) { return null; } })();
  const initial = stored
    || root.getAttribute('data-theme')
    || (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  function setTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch (e) {}
    // Let any host (e.g. tweaks panel) know we flipped.
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { theme: t } }, '*'); } catch (e) {}
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
  }

  function toggle() {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  // Expose for programmatic use
  window.AnnotatedCanvas = Object.assign(window.AnnotatedCanvas || {}, {
    setTheme, toggleTheme: toggle, getTheme: () => root.getAttribute('data-theme')
  });

  function wire() {
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', toggle);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
