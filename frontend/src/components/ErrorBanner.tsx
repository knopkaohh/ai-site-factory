export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}
