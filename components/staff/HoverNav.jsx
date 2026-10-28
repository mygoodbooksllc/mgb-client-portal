// components/staff/HoverNav.jsx — hover navigation preview (owner request 2026-10-21).
//
// Gate (HN_on, the one place that decides): the firm switch
// tk_settings.hovernav_enabled (the inline script in index.html caches it in
// mgb_hovernav_cache and fires the window event "mgb:hovernav" when it changes;
// code never writes the switch). The per-person checkboxes mgb_hovernav_preview
// (retired 2026-10-25) and the Classic menus opt-out mgb_hovernav_classic
// (retired 2026-10-28) are gone: the switch is on for everyone.
// Off: nothing here shows and the sidebars behave as before.
//   1. A themed tip replaces the browser's gray native title="" tooltip.
//   2. Pointing at a sidebar icon whose place has tabs opens a small flyout of
//      clickable tabs beside it (staff rail: Work, Team, HR; client sidebar:
//      Finances), so you can jump straight to a tab.
// Prefix: HN_. Styles: .hn-tip, .hn-fly in styles.css.

function HN_on() {
  try {
    const ls = window.localStorage;
    return ls.getItem("mgb_hovernav_cache") === "1";
  } catch (e) {
    return false;
  }
}

// Themed replacement for native title tooltips. One document-level listener,
// installed only once hover menus are on (at load, or when the firm switch
// arrives); the handlers also check HN_on(), so a switch turned off goes quiet.
let HN_titleTipsInstalled = false;
function HN_installTitleTips() {
  if (HN_titleTipsInstalled || typeof document === "undefined" || !HN_on()) return;
  HN_titleTipsInstalled = true;
  let tipEl = null;
  let owner = null;
  function hide() {
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
    if (owner) {
      const t = owner.getAttribute("data-hn-title");
      if (t != null && !owner.hasAttribute("title")) owner.setAttribute("title", t);
      owner.removeAttribute("data-hn-title");
      owner = null;
    }
  }
  document.addEventListener("mouseover", (e) => {
    if (!HN_on()) return;
    const el = e.target && e.target.closest ? e.target.closest("[title]") : null;
    if (!el || el === owner) return;
    const text = el.getAttribute("title");
    if (!text) return;
    hide();
    owner = el;
    el.setAttribute("data-hn-title", text);
    el.removeAttribute("title");
    tipEl = document.createElement("div");
    tipEl.className = "hn-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    const r = el.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + tipEl.offsetHeight < window.innerHeight;
    tipEl.style.left = left + "px";
    tipEl.style.top = (below ? r.bottom + 8 : r.top - 8 - tipEl.offsetHeight) + "px";
  });
  document.addEventListener("mouseout", (e) => {
    if (!owner) return;
    if (e.relatedTarget && owner.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("scroll", hide, true);
}
HN_installTitleTips();
if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("mgb:hovernav", HN_installTitleTips);

// Flyout state for one sidebar. Returns { enabled, node, open, scheduleClose }.
//   open(event, { title, items: [{ key, label, current }], onPick })
function HN_useFlyout() {
  const enabled = HN_on();
  const [, bumpOn] = React.useState(0);
  React.useEffect(() => {
    const f = () => bumpOn((n) => n + 1);
    window.addEventListener("mgb:hovernav", f);
    return () => window.removeEventListener("mgb:hovernav", f);
  }, []);
  const [spec, setSpec] = React.useState(null);
  const timer = React.useRef(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    cancel();
    setSpec(null);
  };
  const scheduleClose = () => {
    cancel();
    timer.current = setTimeout(() => setSpec(null), 200);
  };
  const open = (e, s) => {
    if (!enabled || !s || !s.items || s.items.length < 2 || window.innerWidth < 761) return false;
    cancel();
    setSpec({ ...s, rect: e.currentTarget.getBoundingClientRect() });
    return true;
  };
  React.useEffect(() => {
    if (!spec) return;
    const onKey = (ev) => ev.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [spec]);
  React.useEffect(() => cancel, []);
  const node = spec
    ? ReactDOM.createPortal(
        <div
          className="hn-fly"
          role="menu"
          aria-label={spec.title}
          style={{
            left: spec.rect.right + 6,
            top: Math.max(8, Math.min(spec.rect.top, window.innerHeight - 48 - spec.items.length * 34)),
          }}
          onMouseEnter={cancel}
          onMouseLeave={scheduleClose}
        >
          <div className="hn-fly-head">{spec.title}</div>
          {spec.items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={"hn-fly-item" + (it.current ? " current" : "")}
              onClick={() => {
                close();
                spec.onPick(it.key);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;
  return { enabled, node, open, scheduleClose, close };
}
