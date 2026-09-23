// Distinct from EmptyState - always offers a retry, never a raw stack
// trace (brief item 3).
export default function ErrorState({ message, onRetry, retryLabel = "Retry" }) {
  return (
    <div className="ui-error-state" role="alert">
      <p className="ui-error-message">{message}</p>
      {onRetry && (
        <button type="button" className="ui-error-retry" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
