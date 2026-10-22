export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress-wrap">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс проекта"
      >
        <span style={{ width: `${clamped}%` }} />
      </div>
      <span className="progress-value">{clamped}%</span>
    </div>
  );
}
