import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { CaseState } from '@thread/domain';
import { CheckCircle2, FileWarning, Hash } from 'lucide-react';
import type { Selection } from '../model.js';

interface EvidenceGraphProps {
  state: CaseState;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

const evidenceStyles = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-family': 'IBM Plex Mono',
      'font-size': 8,
      color: '#eee2c2',
      'text-wrap': 'wrap',
      'text-max-width': 115,
      'text-valign': 'center',
      'text-halign': 'center',
      'background-color': '#1b201e',
      'border-width': 1,
      'border-color': '#95825b',
      width: 118,
      height: 52,
      shape: 'round-rectangle',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'node[nodeType = "artifact"]',
    style: {
      width: 150,
      height: 78,
      'background-color': '#d9cba7',
      color: '#121513',
      'border-width': 4,
      'border-color': '#302f29',
      'font-size': 10,
      'font-weight': 600,
    },
  },
  {
    selector: 'node[nodeType = "claim"]',
    style: {
      shape: 'round-diamond',
      width: 100,
      height: 68,
      'background-color': '#2a2420',
      'border-color': '#c85b4e',
    },
  },
  {
    selector: 'node[nodeType = "observation"]',
    style: {
      'background-color': '#1d2928',
      'border-color': '#73a19a',
    },
  },
  {
    selector: 'node[nodeType = "reference"]',
    style: {
      shape: 'ellipse',
      width: 62,
      height: 62,
      'background-color': '#2a2922',
      'border-style': 'dashed',
      'border-color': '#d2b867',
    },
  },
  {
    selector: 'node:selected',
    style: { 'border-color': '#ff6a58', 'border-width': 3 },
  },
  {
    selector: 'edge',
    style: {
      width: 1.4,
      'line-color': '#7c745f',
      'target-arrow-color': '#7c745f',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.55,
      'curve-style': 'bezier',
      label: 'data(label)',
      color: '#b9ad91',
      'font-family': 'IBM Plex Mono',
      'font-size': 7,
      'text-background-color': '#0c0f0e',
      'text-background-opacity': 0.9,
      'text-background-padding': 2,
      'overlay-opacity': 0,
    },
  },
] as unknown as cytoscape.StylesheetJson;

function buildEvidenceElements(state: CaseState, evidenceId: string): ElementDefinition[] {
  const artifact = state.evidence.find((item) => item.id === evidenceId);
  if (!artifact) return [];
  const observations = state.observations.filter(
    (item) => item.sourceEvidenceId === evidenceId,
  );
  const claims = state.claims.filter((item) => item.sourceEvidenceId === evidenceId);
  const referenceIds = new Set(claims.flatMap((claim) => claim.unresolvedReferenceIds));
  const references = state.unresolvedReferences.filter((reference) =>
    referenceIds.has(reference.id),
  );
  const elements: ElementDefinition[] = [
    {
      data: {
        id: artifact.id,
        label: `${artifact.id}\n${artifact.title}`,
        nodeType: 'artifact',
      },
      position: { x: 430, y: 220 },
    },
  ];
  observations.forEach((observation, index) => {
    const y = 80 + index * 120;
    elements.push({
      data: { id: observation.id, label: observation.text, nodeType: 'observation' },
      position: { x: 160, y },
    });
    elements.push({
      data: {
        id: `EG-${artifact.id}-${observation.id}`,
        source: artifact.id,
        target: observation.id,
        label: 'CONTAINS OBSERVATION',
      },
    });
  });
  claims.forEach((claim, index) => {
    const y = 70 + index * 105;
    elements.push({
      data: { id: claim.id, label: claim.proposition, nodeType: 'claim' },
      position: { x: 700, y },
    });
    elements.push({
      data: {
        id: `EG-${artifact.id}-${claim.id}`,
        source: artifact.id,
        target: claim.id,
        label: 'CONTAINS CLAIM',
      },
    });
  });
  references.forEach((reference, index) => {
    elements.push({
      data: {
        id: reference.id,
        label: `“${reference.surfaceForm}”\nUNRESOLVED`,
        nodeType: 'reference',
      },
      position: { x: 880, y: 110 + index * 105 },
    });
    const sourceClaim = claims.find((claim) =>
      claim.unresolvedReferenceIds.includes(reference.id),
    );
    if (sourceClaim) {
      elements.push({
        data: {
          id: `EG-${sourceClaim.id}-${reference.id}`,
          source: sourceClaim.id,
          target: reference.id,
          label: 'RETAINS AMBIGUITY',
        },
      });
    }
  });
  return elements;
}

export function EvidenceGraph({ state, selection, onSelect }: EvidenceGraphProps) {
  const initialEvidence =
    selection?.type === 'evidence' &&
    state.evidence.some((item) => item.id === selection.id)
      ? selection.id
      : (state.evidence.find((item) => item.id === 'EV-014')?.id ??
        state.evidence[0]?.id ??
        '');
  const [activeEvidenceId, setActiveEvidenceId] = useState(initialEvidence);
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const elements = useMemo(
    () => buildEvidenceElements(state, activeEvidenceId),
    [state, activeEvidenceId],
  );

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements,
      style: evidenceStyles,
      layout: { name: 'preset', fit: true, padding: 56 },
      minZoom: 0.35,
      maxZoom: 1.8,
    });
    cy.on('tap', 'node', (event: cytoscape.EventObjectNode) => {
      const id = event.target.id();
      if (state.evidence.some((item) => item.id === id)) onSelect({ type: 'evidence', id });
      else if (state.claims.some((item) => item.id === id)) onSelect({ type: 'claim', id });
      else if (state.observations.some((item) => item.id === id))
        onSelect({ type: 'observation', id });
      else if (state.unresolvedReferences.some((item) => item.id === id))
        onSelect({ type: 'reference', id });
    });
    graph.current = cy;
    return () => cy.destroy();
  }, [elements, onSelect, state]);

  return (
    <div className="evidence-layout">
      <aside className="evidence-register" aria-label="Evidence register">
        <div className="register-heading">
          <span>CHAIN REGISTER</span>
          <strong>{state.evidence.length}</strong>
        </div>
        <div className="evidence-scroll">
          {state.evidence.map((artifact) => (
            <button
              key={artifact.id}
              className={activeEvidenceId === artifact.id ? 'is-active' : ''}
              onClick={() => {
                setActiveEvidenceId(artifact.id);
                onSelect({ type: 'evidence', id: artifact.id });
              }}
            >
              <span className="evidence-id">{artifact.id}</span>
              <span className="evidence-register-title">{artifact.title}</span>
              <span className="evidence-register-meta">
                {artifact.extractionStatus === 'requires-adapter' ? (
                  <FileWarning size={12} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={12} aria-hidden="true" />
                )}
                {artifact.kind} · {artifact.claimIds.length} claims
              </span>
            </button>
          ))}
        </div>
        <div className="register-foot">
          <Hash size={12} aria-hidden="true" />
          SHA-256 on receipt
        </div>
      </aside>
      <div className="evidence-graph-pane">
        <div
          ref={container}
          className="evidence-graph"
          role="img"
          aria-label="Evidence graph showing artifacts containing observations and claims"
        />
        <div className="evidence-principle">
          <span>MODELING RULE 01</span>
          <strong>An artifact’s statement is a claim—not a world fact.</strong>
        </div>
      </div>
    </div>
  );
}
