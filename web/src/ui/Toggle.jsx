import { useId } from "react";

// Boolean control with a label + one-line explanation, never a bare
// checkbox (brief item 3).
export default function Toggle({ checked, onChange, label, hint, id }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  return (
    <label className="ui-toggle" htmlFor={inputId}>
      <span className="ui-toggle-switch">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-toggle-track" aria-hidden="true" />
      </span>
      <span className="ui-toggle-text">
        <span className="ui-toggle-label">{label}</span>
        {hint && <span className="ui-toggle-hint">{hint}</span>}
      </span>
    </label>
  );
}
