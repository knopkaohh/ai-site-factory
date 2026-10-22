import type { ProjectStage } from '../shared';
import { StatusBadge } from './StatusBadge';

export function StageList({ stages }: { stages: ProjectStage[] }) {
  return (
    <ol className="stages">
      {stages.map((stage) => (
        <li key={stage.id} className={`stage stage-${stage.status}`}>
          <div className="stage-index" aria-hidden="true">
            {stage.position}
          </div>
          <div className="stage-body">
            <div className="stage-title">{stage.title}</div>
            <StatusBadge status={stage.status} />
            {stage.errorMessage ? <p className="stage-error">{stage.errorMessage}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
