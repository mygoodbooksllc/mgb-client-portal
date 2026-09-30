// Staff training guide ("Help", #/help and #/help/<slug>).
//
// Articles live in the Supabase table staff_guide (supabase/staff-guide.sql),
// loaded from docs/staff-guide/*.md by docs/staff-guide/sync.mjs. Nothing of
// the guide's text ships in this file: Vercel serves this folder publicly, so
// the words stay behind RLS (active staff read staff articles, admins also
// read admin articles).
//
// Top-level names use the HLP_ prefix (shared Babel global scope). React hooks
// come from app.jsx line 1's destructure, so they're used as React.* here.
// Markdown is rendered to React elements by a small parser: text only, no
// HTML is ever injected.

const HLP_SEARCH_DEBOUNCE_MS = 250;

function HLP_HelpIcon(props) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// #/help/<slug> -> slug, else null.
function HLP_slugFromHash() {
  try {
    const m = /^#\/help\/([a-z0-9-]+)/.exec(window.location.hash || "");
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function HLP_go(slug) {
  const next = slug ? "#/help/" + slug : "#/help";
  if (window.location.hash !== next) window.location.hash = next;
}

// Only same-app hash links and http(s)/mailto links become clickable.
function HLP_safeHref(href) {
  const h = String(href || "").trim();
  if (/^#\//.test(h)) return h;
  if (/^(https?:|mailto:)/i.test(h)) return h;
  return null;
}

// Inline markdown: **bold**, *italic*, `code`, [text](link).
function HLP_inline(text, keyBase) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = keyBase + "-" + i++;
    if (m[2] != null) out.push(<strong key={k}>{HLP_inline(m[2], k)}</strong>);
    else if (m[3] != null) out.push(<code key={k} className="hlp-code">{m[3]}</code>);
    else if (m[4] != null) {
      const href = HLP_safeHref(m[5]);
      if (!href) out.push(m[4]);
      else if (href.startsWith("#/")) out.push(<a key={k} href={href}>{m[4]}</a>);
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[4]}
          </a>,
        );
    } else if (m[6] != null) out.push(<em key={k}>{m[6]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Block markdown: #/##/### headings, paragraphs, - and 1. lists (one nested
// level by indent), > callouts, --- rules, | tables |.
function HLP_Markdown({ source }) {
  const blocks = React.useMemo(() => {
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
    const res = [];
    let i = 0;
    const isList = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        res.push({ t: "h", level: m[1].length, text: m[2].trim() });
        i++;
      } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        res.push({ t: "hr" });
        i++;
      } else if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        res.push({ t: "quote", text: buf.join(" ").trim() });
      } else if (/^\s*\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        res.push({ t: "table", rows });
      } else if (isList(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && (isList(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i])))) {
          const l = lines[i];
          const lm = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
          if (lm && lm[1].length >= 2 && items.length) {
            const parent = items[items.length - 1];
            parent.sub = parent.sub || { ordered: /\d/.test(lm[2]), items: [] };
            parent.sub.items.push(lm[3]);
          } else if (lm) {
            items.push({ text: lm[3] });
          } else if (items.length) {
            const parent = items[items.length - 1];
            if (parent.sub) parent.sub.items[parent.sub.items.length - 1] += " " + l.trim();
            else parent.text += " " + l.trim();
          }
          i++;
        }
        res.push({ t: "list", ordered, items });
      } else {
        const buf = [];
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^(#{1,4})\s+/.test(lines[i]) &&
          !/^\s*>/.test(lines[i]) &&
          !/^\s*\|/.test(lines[i]) &&
          !isList(lines[i])
        ) {
          buf.push(lines[i].trim());
          i++;
        }
        res.push({ t: "p", text: buf.join(" ") });
      }
    }
    return res;
  }, [source]);

  return (
    <div className="hlp-md">
      {blocks.map((b, n) => {
        const k = "b" + n;
        if (b.t === "h") {
          const Tag = b.level <= 2 ? "h3" : "h4";
          return <Tag key={k}>{HLP_inline(b.text, k)}</Tag>;
        }
        if (b.t === "hr") return <hr key={k} />;
        if (b.t === "quote")
          return (
            <div key={k} className="hlp-callout">
              {HLP_inline(b.text, k)}
            </div>
          );
        if (b.t === "table") {
          const [head, ...body] = b.rows;
          return (
            <div key={k} className="hlp-table-wrap">
              <table className="hlp-table">
                {head && (
                  <thead>
                    <tr>{head.map((c, ci) => <th key={ci}>{HLP_inline(c, k + "h" + ci)}</th>)}</tr>
                  </thead>
                )}
                <tbody>
                  {body.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => <td key={ci}>{HLP_inline(c, k + "r" + ri + "c" + ci)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.t === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={k}>
              {b.items.map((it, ii) => {
                const SubTag = it.sub && it.sub.ordered ? "ol" : "ul";
                return (
                  <li key={ii}>
                    {HLP_inline(it.text, k + "i" + ii)}
                    {it.sub && (
                      <SubTag>
                        {it.sub.items.map((s, si) => (
                          <li key={si}>{HLP_inline(s, k + "i" + ii + "s" + si)}</li>
                        ))}
                      </SubTag>
                    )}
                  </li>
                );
              })}
            </Tag>
          );
        }
        return <p key={k}>{HLP_inline(b.text, k)}</p>;
      })}
    </div>
  );
}

// Search snippets come back with ⟦highlight⟧ markers.
function HLP_Snippet({ text }) {
  const parts = String(text || "").split(/(⟦[^⟧]*⟧)/);
  return (
    <span className="hlp-snippet">
      {parts.map((p, i) =>
        p.startsWith("⟦") && p.endsWith("⟧") ? <mark key={i}>{p.slice(1, -1)}</mark> : <React.Fragment key={i}>{p}</React.Fragment>,
      )}
    </span>
  );
}

function HLP_AdminPill() {
  return <span className="hlp-pill">Admin</span>;
}

// Sections ordered by their lowest sort value.
function HLP_groupBySection(list) {
  const map = new Map();
  for (const a of list) {
    if (!map.has(a.section)) map.set(a.section, { section: a.section, min: a.sort, items: [] });
    const g = map.get(a.section);
    g.items.push(a);
    g.min = Math.min(g.min, a.sort);
  }
  return [...map.values()]
    .sort((a, b) => a.min - b.min || a.section.localeCompare(b.section))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title)) }));
}

function HLP_fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (e) {
    return "";
  }
}

function HLP_StaffGuidePage() {
  const [slug, setSlug] = React.useState(HLP_slugFromHash);
  const [list, setList] = React.useState({ loading: true, error: null, rows: [] });
  const [query, setQuery] = React.useState("");
  const [search, setSearch] = React.useState({ loading: false, error: null, q: "", rows: [] });
  const [article, setArticle] = React.useState({ loading: false, error: null, row: null });
  const searchSeq = React.useRef(0);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    const onHash = () => setSlug(HLP_slugFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Table of contents (titles only; RLS drops admin rows for non-admins).
  React.useEffect(() => {
    const supabase = window.mgbSupabase;
    if (!supabase) {
      setList({ loading: false, error: "Can't reach the database.", rows: [] });
      return;
    }
    let live = true;
    supabase
      .from("staff_guide")
      .select("slug,title,section,audience,sort,updated_at")
      .order("sort", { ascending: true })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setList({ loading: false, error: "Couldn't load the guide. " + error.message, rows: [] });
        else setList({ loading: false, error: null, rows: data || [] });
      });
    return () => {
      live = false;
    };
  }, []);

  // One article.
  React.useEffect(() => {
    if (!slug) {
      setArticle({ loading: false, error: null, row: null });
      return;
    }
    const supabase = window.mgbSupabase;
    if (!supabase) return;
    let live = true;
    setArticle({ loading: true, error: null, row: null });
    supabase
      .from("staff_guide")
      .select("slug,title,section,audience,body_md,updated_at")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setArticle({ loading: false, error: "Couldn't load this article. " + error.message, row: null });
        else setArticle({ loading: false, error: null, row: data || null });
      });
    try {
      const main = document.querySelector(".main");
      if (main) main.scrollTop = 0;
      window.scrollTo(0, 0);
    } catch (e) {}
    return () => {
      live = false;
    };
  }, [slug]);

  // Search as you type, debounced; stale responses are dropped.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      searchSeq.current++;
      setSearch({ loading: false, error: null, q: "", rows: [] });
      return;
    }
    const supabase = window.mgbSupabase;
    if (!supabase) return;
    const seq = ++searchSeq.current;
    setSearch((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      supabase.rpc("search_staff_guide", { q }).then(({ data, error }) => {
        if (seq !== searchSeq.current) return;
        if (error) setSearch({ loading: false, error: "Search failed. " + error.message, q, rows: [] });
        else setSearch({ loading: false, error: null, q, rows: data || [] });
      });
    }, HLP_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const groups = React.useMemo(() => HLP_groupBySection(list.rows), [list.rows]);
  const searching = query.trim().length >= 2;

  const openArticle = (s) => {
    setQuery("");
    HLP_go(s);
  };

  const searchBox = (
    <div className="hlp-search" role="search">
      <svg className="hlp-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        className="hlp-search-input"
        placeholder="Search the guide, e.g. “request a document” or “sync”"
        aria-label="Search the staff guide"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
          if (e.key === "Enter" && search.rows.length && !search.loading) openArticle(search.rows[0].slug);
        }}
        autoComplete="off"
        spellCheck="false"
      />
      {query && (
        <button type="button" className="link-btn hlp-search-clear" onClick={() => { setQuery(""); inputRef.current && inputRef.current.focus(); }}>
          Clear
        </button>
      )}
    </div>
  );

  let body;
  if (searching) {
    body = (
      <div className="card hlp-results" aria-live="polite">
        {search.error ? (
          <p className="hlp-error" role="alert">{search.error}</p>
        ) : search.loading && !search.rows.length ? (
          <p className="hlp-dim">Searching…</p>
        ) : !search.rows.length ? (
          <p className="hlp-dim">
            Nothing matches “{query.trim()}”. Try a shorter word, or browse the sections below the search box once you clear it.
          </p>
        ) : (
          <ul className="hlp-result-list">
            {search.rows.map((r) => (
              <li key={r.slug}>
                <a
                  href={"#/help/" + r.slug}
                  className="hlp-result"
                  onClick={(e) => {
                    e.preventDefault();
                    openArticle(r.slug);
                  }}
                >
                  <span className="hlp-result-head">
                    <span className="hlp-result-title">{r.title}</span>
                    {r.audience === "admin" && <HLP_AdminPill />}
                  </span>
                  <span className="hlp-result-section">{r.section}</span>
                  {r.snippet && <HLP_Snippet text={r.snippet} />}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } else if (slug) {
    const row = article.row;
    const siblings = row ? groups.find((g) => g.section === row.section) : null;
    body = (
      <div className="hlp-article-layout">
        <article className="card hlp-article">
          <button type="button" className="link-btn hlp-back" onClick={() => HLP_go(null)}>
            ← All help topics
          </button>
          {article.loading ? (
            <p className="hlp-dim">Loading…</p>
          ) : article.error ? (
            <p className="hlp-error" role="alert">{article.error}</p>
          ) : !row ? (
            <p className="hlp-dim">This article doesn’t exist or isn’t available to you.</p>
          ) : (
            <>
              <div className="hlp-article-meta">
                <span>{row.section}</span>
                {row.audience === "admin" && <HLP_AdminPill />}
              </div>
              <h2 className="hlp-article-title">{row.title}</h2>
              <HLP_Markdown source={row.body_md} />
              {row.updated_at && <p className="hlp-updated">Last updated {HLP_fmtDate(row.updated_at)}</p>}
            </>
          )}
        </article>
        {siblings && siblings.items.length > 1 && (
          <aside className="card hlp-related" aria-label={"More in " + siblings.section}>
            <h3 className="hlp-related-title">More in {siblings.section}</h3>
            <ul>
              {siblings.items.map((a) => (
                <li key={a.slug}>
                  <a
                    href={"#/help/" + a.slug}
                    className={a.slug === slug ? "active" : undefined}
                    aria-current={a.slug === slug ? "page" : undefined}
                  >
                    {a.title}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    );
  } else {
    body = list.loading ? (
      <div className="card"><p className="hlp-dim">Loading…</p></div>
    ) : list.error ? (
      <div className="card"><p className="hlp-error" role="alert">{list.error}</p></div>
    ) : !list.rows.length ? (
      <div className="card"><p className="hlp-dim">The guide hasn’t been loaded yet. Ask an admin to run the staff guide sync.</p></div>
    ) : (
      <div className="hlp-sections">
        {groups.map((g) => (
          <section key={g.section} className="card hlp-section">
            <h3 className="hlp-section-title">{g.section}</h3>
            <ul className="hlp-toc">
              {g.items.map((a) => (
                <li key={a.slug}>
                  <a href={"#/help/" + a.slug}>{a.title}</a>
                  {a.audience === "admin" && <HLP_AdminPill />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="hlp-page">
      {searchBox}
      {body}
    </div>
  );
}
