import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { CaseState } from '@thread/domain';
import type { Selection } from '../model.js';

interface BeliefGraphProps {
  state: CaseState;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

interface BeliefNodeData extends Record<string, unknown> {
  label: ReactNode;
  text: string;
  eyebrow: string;
  selectionType: 'belief' | 'assumption';
  status: string;
  confidence: number;
}

function beliefNodeStyle(kind: string, status: string, selected: boolean): CSSProperties {
  const isReconstruction = kind === 'reconstruction';
  const isQuestion = kind === 'unresolved-question';
  const isContradiction = kind === 'contradiction';
  return {
    width: isReconstruction ? 225 : 190,
    minHeight: isReconstruction ? 92 : 76,
    borderRadius: isQuestion ? 36 : 2,
    border: `${selected ? 2 : 1}px ${status === 'rejected' || isContradiction ? 'dashed' : 'solid'} ${
      selected
        ? '#ff6a58'
        : isContradiction
          ? '#d45b4e'
          : isQuestion
            ? '#c6aa59'
            : '#8e805f'
    }`,
    background: isReconstruction ? '#d6c7a4' : '#171b19',
    color: isReconstruction ? '#111412' : '#eee2c4',
    boxShadow: selected
      ? '0 0 0 7px rgba(244, 100, 84, .11)'
      : '0 12px 28px rgba(0,0,0,.18)',
    opacity: status === 'rejected' ? 0.5 : 1,
    padding: 0,
    fontFamily: 'IBM Plex Mono',
  };
}

function nodeLabel(data: BeliefNodeData) {
  return (
    <div className="belief-node-label">
      <span>{data.eyebrow}</span>
      <strong>{data.text}</strong>
      <small>
        {data.status.toUpperCase()} · {Math.round(data.confidence * 100)}%
      </small>
    </div>
  );
}

export function BeliefGraph({ state, selection, onSelect }: BeliefGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const assumptionNodes: Node<BeliefNodeData>[] = state.assumptions.map(
      (assumption, index) => {
        const data: BeliefNodeData = {
          label: null,
          text: assumption.label,
          eyebrow: assumption.id,
          selectionType: 'assumption',
          status: assumption.status,
          confidence:
            assumption.status === 'invalid'
              ? 0
              : assumption.status === 'contested'
                ? 0.55
                : 1,
        };
        return {
          id: assumption.id,
          position: { x: 25, y: 45 + index * 145 },
          data: { ...data, label: nodeLabel(data) },
          style: beliefNodeStyle(
            'assumption',
            assumption.status,
            selection?.type === 'assumption' && selection.id === assumption.id,
          ),
        };
      },
    );
    const beliefNodes: Node<BeliefNodeData>[] = state.beliefs.map((belief) => {
      let position: { x: number; y: number };
      if (belief.kind === 'reconstruction') {
        const reconstructionIndex = state.beliefs
          .filter((item) => item.kind === 'reconstruction')
          .findIndex((item) => item.id === belief.id);
        position = { x: 710, y: 105 + reconstructionIndex * 235 };
      } else if (belief.kind === 'hypothesis' || belief.kind === 'inference') {
        const hypothesisIndex = state.beliefs
          .filter((item) => item.kind === 'hypothesis' || item.kind === 'inference')
          .findIndex((item) => item.id === belief.id);
        position = { x: 360, y: 30 + hypothesisIndex * 140 };
      } else {
        const sideIndex = state.beliefs
          .filter(
            (item) =>
              item.kind !== 'reconstruction' &&
              item.kind !== 'hypothesis' &&
              item.kind !== 'inference',
          )
          .findIndex((item) => item.id === belief.id);
        position = { x: 365, y: 430 + sideIndex * 125 };
      }
      const data: BeliefNodeData = {
        label: null,
        text: belief.label,
        eyebrow: `${belief.id} · ${belief.kind.replaceAll('-', ' ')}`,
        selectionType: 'belief',
        status: belief.status,
        confidence: belief.confidence,
      };
      return {
        id: belief.id,
        position,
        data: { ...data, label: nodeLabel(data) },
        style: beliefNodeStyle(
          belief.kind,
          belief.status,
          selection?.type === 'belief' && selection.id === belief.id,
        ),
      };
    });
    const nodeIds = new Set([...assumptionNodes, ...beliefNodes].map((node) => node.id));
    const graphEdges: Edge[] = state.beliefEdges
      .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
      .map((edge) => {
        const contradicts = edge.predicate === 'CONTRADICTS';
        const selectedEdge = selection?.type === 'belief-edge' && selection.id === edge.id;
        return {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          label: edge.predicate,
          animated: selectedEdge,
          style: {
            stroke: selectedEdge ? '#ff6a58' : contradicts ? '#cc584b' : '#a6905d',
            strokeWidth: 1 + edge.weight * 3,
            strokeDasharray: contradicts ? '7 5' : undefined,
            opacity: Math.max(0.4, edge.weight + 0.2),
          },
          labelStyle: {
            fill: '#b9ad91',
            fontFamily: 'IBM Plex Mono',
            fontSize: 8,
          },
          labelBgStyle: { fill: '#0c0f0e', fillOpacity: 0.9 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: contradicts ? '#cc584b' : '#a6905d',
            width: 13,
            height: 13,
          },
        };
      });
    return { nodes: [...assumptionNodes, ...beliefNodes], edges: graphEdges };
  }, [state, selection]);

  return (
    <div className="belief-layout">
      <div className="belief-column-labels" aria-hidden="true">
        <span>ASSUMPTIONS</span>
        <span>HYPOTHESES + CHALLENGES</span>
        <span>RECONSTRUCTIONS</span>
      </div>
      <div className="belief-flow" aria-label="Belief dependency graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.35}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            const type = node.data.selectionType === 'assumption' ? 'assumption' : 'belief';
            onSelect({ type, id: node.id });
          }}
          onEdgeClick={(_event, edge) => onSelect({ type: 'belief-edge', id: edge.id })}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#393b34" gap={26} size={0.8} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </div>
      <section className="belief-ledger" aria-label="Belief graph relationships">
        <span>JUSTIFICATION LEDGER</span>
        <div>
          {state.beliefEdges.map((edge) => (
            <button
              key={edge.id}
              className={edge.predicate === 'CONTRADICTS' ? 'is-contradiction' : ''}
              onClick={() => onSelect({ type: 'belief-edge', id: edge.id })}
            >
              <strong>{edge.sourceId}</strong>
              <small>{edge.predicate}</small>
              <strong>{edge.targetId}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
