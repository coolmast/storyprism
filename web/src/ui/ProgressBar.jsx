export default function ProgressBar({ value, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="ui-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
