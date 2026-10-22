import { PROJECT_STATUS_LABELS, STAGE_STATUS_LABELS, type ProjectStatus, type StageStatus } from '../shared';

const labels: Record<string, string> = {
  ...PROJECT_STATUS_LABELS,
  ...STAGE_STATUS_LABELS,
};

export function StatusBadge({ status }: { status: ProjectStatus | StageStatus }) {
  return <span className={`badge badge-${status}`}>{labels[status] ?? status}</span>;
}
