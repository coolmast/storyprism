// A 2-4 way mutually-exclusive choice, used in place of a <select> or a
// radio group (brief item 3). options: [{ value, label, title? }] - title
// is an optional tooltip/accessible-name override, for a compact icon-only
// label that still needs a readable name for screen readers.
export default function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="ui-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          aria-label={opt.title}
          title={opt.title}
          className={value === opt.value ? "active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
