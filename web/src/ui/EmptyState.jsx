// Icon + one-line message + a clear action, for legitimately-empty lists
// (brief item 3) - distinct from ErrorState, which is for failures.
export default function EmptyState({ icon = "\u{1F5C2}\u{FE0F}", title, hint, action }) {
  return (
    <div className="ui-empty-state">
      <div className="ui-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="ui-empty-title">{title}</p>
      {hint && <p className="ui-empty-hint">{hint}</p>}
      {action}
    </div>
  );
}
