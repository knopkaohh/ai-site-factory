import type { ProjectEvent } from '../shared';
import { formatDateTime } from '../format';

export function EventList({ events }: { events: ProjectEvent[] }) {
  if (events.length === 0) {
    return <p className="muted">Событий пока нет.</p>;
  }
  return (
    <ol className="events">
      {events.map((event) => (
        <li key={event.id}>
          <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
          <p>{event.message}</p>
        </li>
      ))}
    </ol>
  );
}
