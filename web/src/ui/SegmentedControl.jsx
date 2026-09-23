// A 2-4 way mutually-exclusive choice, used in place of a <select> or a
// radio group (brief item 3). options: [{ value, label }].
export default function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="ui-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={value === opt.value ? "active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
