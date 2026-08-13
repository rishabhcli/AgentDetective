import { useEffect, useMemo, useRef } from 'react';
import { DataSet } from 'vis-data';
import { Timeline, type TimelineOptions } from 'vis-timeline/standalone';
import type { CaseState } from '@thread/domain';
import type { Selection } from '../model.js';

interface TimelineBoardProps {
  state: CaseState;
  onSelect: (selection: Selection) => void;
}

interface TimelineItem {
  id: string;
  group: string;
  content: string;
  start: Date;
  end?: Date;
  type: 'point' | 'range';
  className: string;
  title: string;
}

export function TimelineBoard({ state, onSelect }: TimelineBoardProps) {
  const container = useRef<HTMLDivElement>(null);
  const items = useMemo<TimelineItem[]>(() => {
    const eventItems = state.entities
      .filter((entity) => entity.kind === 'event' && entity.interval)
      .map((entity) => {
        const interval = entity.interval!;
        const isPoint = interval.earliest === interval.latest;
        const item: TimelineItem = {
          id: `entity:${entity.id}`,
          group: 'events',
          content: `${entity.shortLabel} · ${entity.label}`,
          start: new Date(interval.earliest),
          type: isPoint ? 'point' : 'range',
          className:
            entity.confidence >= 0.7
              ? 'timeline-high'
              : entity.confidence >= 0.45
                ? 'timeline-medium'
                : 'timeline-low',
          title: `${Math.round(entity.confidence * 100)}% confidence · ${entity.description}`,
        };
        if (!isPoint) item.end = new Date(interval.latest);
        return item;
      });
    const observationItems = state.observations
      .filter((observation) => observation.interval)
      .map((observation) => {
        const interval = observation.interval!;
        const point =
          interval.earliest === interval.latest || interval.precision === 'minute';
        const item: TimelineItem = {
          id: `observation:${observation.id}`,
          group: 'sources',
          content: `${observation.sourceEvidenceId} · ${observation.text}`,
          start: new Date(interval.earliest),
          type: point ? 'point' : 'range',
          className:
            interval.confidence >= 0.75
              ? 'timeline-source-high'
              : interval.confidence >= 0.45
                ? 'timeline-source-medium'
                : 'timeline-source-low',
          title: `${Math.round(interval.confidence * 100)}% temporal confidence · ${observation.locator}`,
        };
        if (!point) item.end = new Date(interval.latest);
        return item;
      });
    return [...eventItems, ...observationItems];
  }, [state]);

  useEffect(() => {
    if (!container.current) return;
    const data = new DataSet(items);
    const groups = new DataSet([
      { id: 'events', content: 'EVENT CANDIDATES' },
      { id: 'sources', content: 'SOURCE INTERVALS' },
    ]);
    const options: TimelineOptions = {
      start: new Date('2026-08-04T19:35:00.000-07:00'),
      end: new Date('2026-08-04T22:00:00.000-07:00'),
      min: new Date('2026-08-04T00:00:00.000-07:00'),
      max: new Date('2026-08-05T00:00:00.000-07:00'),
      stack: true,
      zoomMin: 8 * 60 * 1000,
      zoomMax: 24 * 60 * 60 * 1000,
      orientation: { axis: 'top', item: 'top' },
      margin: { item: { horizontal: 8, vertical: 16 }, axis: 18 },
      showCurrentTime: false,
      selectable: true,
      multiselect: false,
      tooltip: { followMouse: true, overflowMethod: 'cap' },
      format: {
        minorLabels: { minute: 'h:mm A', hour: 'h A' },
        majorLabels: { minute: 'ddd D MMM', hour: 'ddd D MMM' },
      },
    };
    const timeline = new Timeline(container.current, data, groups, options);
    timeline.on('select', (properties: { items: unknown[] }) => {
      const id = properties.items[0];
      if (typeof id !== 'string') return;
      const [type, objectId] = id.split(':');
      if (!objectId) return;
      onSelect(
        type === 'entity'
          ? { type: 'entity', id: objectId }
          : { type: 'observation', id: objectId },
      );
    });
    return () => timeline.destroy();
  }, [items, onSelect]);

  const orderedEvents = state.entities
    .filter((entity) => entity.kind === 'event' && entity.interval)
    .sort((a, b) => Date.parse(a.interval!.earliest) - Date.parse(b.interval!.earliest));

  return (
    <div className="timeline-layout">
      <div className="timeline-scale-note">
        <span>VALID TIME</span>
        <strong>4 AUG 2026 · PACIFIC</strong>
        <small>
          Soft edges indicate temporal uncertainty. Transaction time is retained separately.
        </small>
      </div>
      <div ref={container} className="case-timeline" aria-label="Case interval timeline" />
      <div className="timeline-event-ledger">
        {orderedEvents.map((event, index) => (
          <button key={event.id} onClick={() => onSelect({ type: 'entity', id: event.id })}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{event.label}</strong>
            <small>
              {event.interval?.precision} · {Math.round(event.confidence * 100)}% confidence
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}
