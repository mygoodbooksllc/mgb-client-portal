// Themed hover tooltips for every `title` attribute in the app (owner request
// 2026-09-30: the browser's own grey tooltip didn't match the navy theme).
//
// Plain script, no React: on hover or keyboard focus it moves an element's
// `title` into `data-tip` (so the native tooltip never shows) and displays one
// shared navy bubble (.mgb-tip, styles in components/ui/tooltips.css) above
// the element, or below it when there's no room. The bubble is linked with
// aria-describedby while shown. Icon-only controls that relied on `title` for
// their accessible name get it copied to aria-label first.
//
// React only rewrites `title` when its value changes, so a new value simply
// gets moved again on the next hover.
(function () {
  var tip = null;
  var current = null;
  var showTimer = null;
  var DELAY = 350;

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "mgb-tip";
    tip.id = "mgb-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    return tip;
  }

  function adopt(el) {
    var t = el.getAttribute("title");
    if (t) {
      el.setAttribute("data-tip", t);
      el.removeAttribute("title");
      if (!el.hasAttribute("aria-label") && !(el.textContent || "").trim()) {
        el.setAttribute("aria-label", t);
      }
    }
    return el.getAttribute("data-tip");
  }

  function position(el) {
    var r = el.getBoundingClientRect();
    var t = ensureTip();
    var tw = t.offsetWidth;
    var th = t.offsetHeight;
    var gap = 8;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    var top = r.top - th - gap;
    var below = top < 8;
    if (below) top = r.bottom + gap;
    t.style.left = left + "px";
    t.style.top = top + "px";
    t.classList.toggle("mgb-tip--below", below);
  }

  function show(el) {
    var text = adopt(el);
    if (!text) return;
    var t = ensureTip();
    t.textContent = text;
    t.classList.add("mgb-tip--on");
    position(el);
    el.setAttribute("aria-describedby", "mgb-tip");
    current = el;
  }

  function hide() {
    clearTimeout(showTimer);
    if (current) current.removeAttribute("aria-describedby");
    current = null;
    if (tip) tip.classList.remove("mgb-tip--on");
  }

  function target(node) {
    return node && node.closest ? node.closest("[title], [data-tip]") : null;
  }

  document.addEventListener("mouseover", function (e) {
    var el = target(e.target);
    if (el === current) return;
    hide();
    if (!el) return;
    adopt(el);
    showTimer = setTimeout(function () { show(el); }, DELAY);
  });
  document.addEventListener("mouseout", function (e) {
    var el = target(e.target);
    if (el && el.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener("focusin", function (e) {
    var el = target(e.target);
    if (el && el === e.target) {
      hide();
      show(el);
    }
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("mousedown", hide, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
})();
