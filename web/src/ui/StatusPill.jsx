// status: "ok" | "warn" | "bad" - colors always come from the matching
// token triad in theme.css, never a one-off color per call site.
export default function StatusPill({ status = "ok", children }) {
  return (
    <span className={`ui-status-pill ui-status-${status}`}>
      <span className="ui-status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
