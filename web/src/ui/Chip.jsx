export default function Chip({ children, onRemove, removeLabel = "Remove", className = "" }) {
  return (
    <span className={`ui-chip ${className}`.trim()}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip-remove" onClick={onRemove} aria-label={removeLabel}>
          ×
        </button>
      )}
    </span>
  );
}
