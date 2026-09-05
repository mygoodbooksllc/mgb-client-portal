Badge from mygoodbooks-ds. Use via `window.MygoodbooksDS.Badge` (bundle loaded from the root `_ds_bundle.js`).

Pill badge with a small leading status dot. Synthesized from the
`.badge-live` / `.badge-dot` classes — in app.jsx these only appear once,
in the page header ("Prototype · Sample Data"), so there is no evidence of
color/tone variants; this component intentionally exposes just `label`
rather than inventing a `tone` prop with no real usage site to confirm it.

## Props

```ts
interface BadgeProps {
  /** Text shown next to the status dot (e.g. "Prototype · Sample Data"). */
  label: string;
  /** Additional class name(s) appended to the root element. */
  className?: string;
}
```

## Examples

### Default

```jsx
() => <Badge label="Prototype · Sample Data" />
```
