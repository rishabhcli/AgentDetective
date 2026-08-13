import { useEffect, useMemo, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { CaseState, Entity, WorldEdge } from '@thread/domain';
import type { Selection } from '../model.js';

interface WorldGraphProps {
  state: CaseState;
  lens: 'people' | 'place' | 'objects';
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

const focalEntity: Record<WorldGraphProps['lens'], string> = {
  people: 'E-JORDAN',
  place: 'E-WAREHOUSE',
  objects: 'E-BADGE17',
};

function positions(entities: Entity[], lens: WorldGraphProps['lens']) {
  const focal = focalEntity[lens];
  const others = entities.filter((entity) => entity.id !== focal);
  return new Map(
    entities.map((entity) => {
      if (entity.id === focal) return [entity.id, { x: 490, y: 275 }] as const;
      const index = others.findIndex((item) => item.id === entity.id);
      const angle = -Math.PI / 2 + (index / Math.max(others.length, 1)) * Math.PI * 2;
      const radiusX = entity.kind === 'event' ? 205 : 310;
      const radiusY = entity.kind === 'event' ? 145 : 205;
      return [
        entity.id,
        { x: 490 + Math.cos(angle) * radiusX, y: 275 + Math.sin(angle) * radiusY },
      ] as const;
    }),
  );
}

function graphElements(
  state: CaseState,
  lens: WorldGraphProps['lens'],
): ElementDefinition[] {
  const edges = state.worldEdges.filter((edge) => edge.lenses.includes(lens));
  const ids = new Set(edges.flatMap((edge) => [edge.subjectId, edge.objectId]));
  const entities = state.entities.filter((entity) => ids.has(entity.id));
  const coordinates = positions(entities, lens);
  const nodes: ElementDefinition[] = entities.map((entity) => ({
    group: 'nodes',
    data: {
      id: entity.id,
      label: entity.label,
      shortLabel: entity.shortLabel,
      kind: entity.kind,
      confidence: `${Math.round(entity.confidence * 100)}%`,
      opacity: Math.max(0.48, entity.confidence),
    },
    position: coordinates.get(entity.id)!,
  }));
  const graphEdges: ElementDefinition[] = edges.map((edge) => ({
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.subjectId,
      target: edge.objectId,
      label: edge.predicate.replaceAll('_', ' '),
      confidence: `${Math.round(edge.confidence * 100)}%`,
      disputed: String(edge.disputed),
      opacity: Math.max(0.25, edge.confidence),
      width: 1.2 + edge.confidence * 2.8,
    },
  }));
  return [...nodes, ...graphEdges];
}

const styles = [
  {
    selector: 'node',
    style: {
      'background-color': '#171b1a',
      'border-color': '#bda875',
      'border-width': 1.5,
      color: '#f0e6cb',
      label: 'data(label)',
      'font-family': 'IBM Plex Mono',
      'font-size': 9,
      'font-weight': 500,
      'text-wrap': 'wrap',
      'text-max-width': 92,
      'text-valign': 'bottom',
      'text-margin-y': 12,
      width: 54,
      height: 54,
      opacity: 'data(opacity)',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'node[kind = "person"]',
    style: {
      shape: 'ellipse',
      'background-color': '#ded1ae',
      color: '#f0e6cb',
      'border-width': 4,
      'border-color': '#252a27',
    },
  },
  {
    selector: 'node[kind = "identity"]',
    style: {
      shape: 'ellipse',
      'background-color': '#727975',
      'border-style': 'dashed',
      'border-color': '#d6c79f',
    },
  },
  {
    selector: 'node[kind = "location"]',
    style: {
      shape: 'round-rectangle',
      width: 72,
      height: 48,
      'background-color': '#263231',
      'border-color': '#739b95',
    },
  },
  {
    selector: 'node[kind = "event"]',
    style: {
      shape: 'diamond',
      width: 52,
      height: 52,
      'background-color': '#2a2520',
      'border-color': '#d25548',
    },
  },
  {
    selector: 'node[kind = "object"], node[kind = "vehicle"]',
    style: {
      shape: 'hexagon',
      'background-color': '#2d2b20',
      'border-color': '#c5a85c',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#f46454',
      'border-width': 3,
      'underlay-color': '#f46454',
      'underlay-opacity': 0.12,
      'underlay-padding': 10,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'data(width)',
      'line-color': '#a18d5f',
      'target-arrow-color': '#a18d5f',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.65,
      'curve-style': 'bezier',
      opacity: 'data(opacity)',
      label: 'data(label)',
      'font-family': 'IBM Plex Mono',
      'font-size': 7,
      color: '#cfc3a5',
      'text-background-color': '#0c0f0e',
      'text-background-opacity': 0.86,
      'text-background-padding': 3,
      'text-rotation': 'autorotate',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'edge[disputed = "true"]',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [7, 5],
      'line-color': '#c65045',
      'target-arrow-color': '#c65045',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#ff6a58',
      'target-arrow-color': '#ff6a58',
      opacity: 1,
      'z-index': 20,
    },
  },
] as unknown as cytoscape.StylesheetJson;

function entityLabel(state: CaseState, id: string): string {
  return state.entities.find((entity) => entity.id === id)?.label ?? id;
}

export function WorldGraph({ state, lens, selection, onSelect }: WorldGraphProps) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const elements = useMemo(() => graphElements(state, lens), [state, lens]);
  const visibleEdges = useMemo(
    () => state.worldEdges.filter((edge) => edge.lenses.includes(lens)),
    [state, lens],
  );

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements,
      style: styles,
      layout: { name: 'preset', fit: true, padding: 78 },
      minZoom: 0.42,
      maxZoom: 1.8,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (event: cytoscape.EventObjectNode) =>
      onSelect({ type: 'entity', id: event.target.id() }),
    );
    cy.on('tap', 'edge', (event: cytoscape.EventObjectEdge) =>
      onSelect({ type: 'edge', id: event.target.id() }),
    );
    graph.current = cy;
    return () => {
      cy.destroy();
      graph.current = null;
    };
  }, [elements, onSelect]);

  useEffect(() => {
    const cy = graph.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selection?.type === 'entity' || selection?.type === 'edge') {
      cy.getElementById(selection.id).select();
    }
  }, [selection]);

  return (
    <div className="graph-wrap">
      <div
        ref={container}
        className="world-graph"
        role="img"
        aria-label={`${lens} lens world graph with ${visibleEdges.length} inspectable relationships`}
      />
      <div className="graph-compass" aria-hidden="true">
        <span>N</span>
        <i />
      </div>
      <section className="string-ledger" aria-label="Visible graph relationships">
        <div className="string-ledger-title">
          <span>VISIBLE STRINGS</span>
          <strong>{visibleEdges.length}</strong>
        </div>
        <div className="string-ledger-list">
          {visibleEdges.map((edge) => (
            <StringButton
              key={edge.id}
              edge={edge}
              state={state}
              selected={selection?.type === 'edge' && selection.id === edge.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function StringButton({
  edge,
  state,
  selected,
  onSelect,
}: {
  edge: WorldEdge;
  state: CaseState;
  selected: boolean;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <button
      className={`${edge.disputed ? 'is-disputed' : ''} ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect({ type: 'edge', id: edge.id })}
    >
      <span
        className="string-swatch"
        style={{ opacity: Math.max(edge.confidence, 0.32) }}
      />
      <span>
        <strong>{entityLabel(state, edge.subjectId)}</strong>
        <small>
          {edge.predicate.replaceAll('_', ' ')} · {Math.round(edge.confidence * 100)}%
        </small>
        <strong>{entityLabel(state, edge.objectId)}</strong>
      </span>
    </button>
  );
}
