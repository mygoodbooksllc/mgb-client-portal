// ----------------------------------------------------------------------------
// TK_FilterBar.jsx — the Slate page search box (docs/slateplus-filters-spec.md).
//
// Exports: TK_SlateListSearch
//
// TK_SlateListSearch({ value, onChange(text), count }) — the "Search title,
// client, notes" box in the Slate toolbar (live for all staff). Instant: the
// list filters as you type (TK_applySearch in TK_filterLogic.js), nothing goes
// to the server. Esc clears the text, a second Esc leaves the box. The ×
// button clears it too. While typing, list keys never fire (the box is a
// typing target for TK_shouldHandleKey). Only TK_vMyTasksBody renders it, and
// only on the full Slate list (not embedded, not the summary, not View as).
// ----------------------------------------------------------------------------

function TK_SlateListSearch(props) {
  var value = props.value || "";
  var inputRef = React.useRef(null);
  var max = typeof TK_SEARCH_MAX === "number" ? TK_SEARCH_MAX : 200;
  var on = !!value.trim();
  var countText = on && typeof TK_searchCountText === "function" ? TK_searchCountText(props.count) : "";
  var clear = function (refocus) {
    props.onChange("");
    if (refocus && inputRef.current) {
      try {
        inputRef.current.focus();
      } catch (e) {}
    }
  };
  return (
    <span className={"tk-list-search" + (on ? " is-on" : "")} role="search" data-tour="tk-search">
      <TK_vIcon name="search" size={15} />
      <input
        ref={inputRef}
        type="text"
        className="tk-list-search-input"
        aria-label="Search this list by title, client or notes"
        placeholder="Search title, client, notes"
        maxLength={max}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={function (e) {
          props.onChange(e.target.value);
        }}
        onKeyDown={function (e) {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === "function") e.nativeEvent.stopImmediatePropagation();
          if (value) clear(false);
          else if (inputRef.current) inputRef.current.blur();
        }}
      />
      {value ? (
        <button
          type="button"
          className="tk-list-search-clear"
          aria-label="Clear search"
          title="Clear search (Esc)"
          onClick={function () {
            clear(true);
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <span className="tk-sr" aria-live="polite">
        {countText}
      </span>
    </span>
  );
}
