export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="state-block" role="status">
      {label}
    </div>
  );
}
