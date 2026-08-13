import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Maximize2,
  Lock,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Unlock,
} from 'lucide-react';
import type { CaseState, EvidenceArtifact, WorldEdge } from '@thread/domain';
import type { Selection } from '../model.js';

interface EvidenceCanvasProps {
  state: CaseState;
  selection: Selection | null;
  pulse: number;
  busyAction: string | null;
  onSelect: (selection: Selection) => void;
  onUpload: () => void;
  onInvestigate: (anomalyId: string) => void;
}

interface BoardItemData extends Record<string, unknown> {
  kind: 'evidence' | 'entity' | 'reconstruction' | 'question';
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  tone: 'paper' | 'photo' | 'sticky' | 'dark' | 'blue';
  selection: Selection | null;
  artifact?: EvidenceArtifact;
  accent?: string;
  badge?: string;
  editable: boolean;
  sourceBrief: string;
  connectionBrief: string;
  onOpen: (selection: Selection) => void;
  onInvestigate?: () => void;
}

type BoardNode = Node<BoardItemData, 'boardItem'>;
interface ThreadEdgeData extends Record<string, unknown> {
  relation: WorldEdge | null;
  selection: Selection;
  label: string;
  confidence: number;
  metric: string;
  disputed: boolean;
  onOpen: (selection: Selection) => void;
}
type ThreadEdge = Edge<ThreadEdgeData, 'thread'>;

const basePositions: Record<
  string,
  { x: number; y: number; width: number; height: number }
> = {
  'EV-014': { x: 90, y: 95, width: 340, height: 258 },
  'EV-041': { x: 505, y: 70, width: 330, height: 232 },
  'EV-058': { x: 920, y: 56, width: 380, height: 300 },
  'EV-071': { x: 1390, y: 92, width: 348, height: 264 },
  'EV-081': { x: 1765, y: 465, width: 335, height: 252 },
  'EV-107': { x: 95, y: 505, width: 355, height: 252 },
  'EV-121': { x: 1385, y: 500, width: 350, height: 258 },
  'E-BADGE17': { x: 535, y: 410, width: 315, height: 205 },
  'E-JORDAN': { x: 930, y: 430, width: 330, height: 225 },
  'E-WAREHOUSE': { x: 930, y: 805, width: 350, height: 220 },
  'R-C': { x: 485, y: 815, width: 405, height: 280 },
  'AN-J': { x: 1165, y: 835, width: 380, height: 260 },
};

const rotations: Record<string, number> = {
  'EV-014': -2.1,
  'EV-041': 1.4,
  'EV-058': -1.3,
  'EV-071': 1.8,
  'EV-081': -1.8,
  'EV-107': 1.1,
  'EV-121': -1.1,
  'R-C': -0.8,
  'AN-J': 1.2,
};

function firstLine(value: string | null | undefined, limit = 150): string {
  if (!value) return 'Preserved source with no text interpretation.';
  const text = value.replaceAll('\n', ' · ');
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function artifactTone(artifact: EvidenceArtifact): BoardItemData['tone'] {
  if (artifact.kind === 'image') return 'photo';
  if (artifact.kind === 'message' || artifact.kind === 'email') return 'paper';
  if (artifact.kind === 'audio') return 'blue';
  return 'paper';
}

function generatedIcon(kind: EvidenceArtifact['kind']): string {
  if (kind === 'image') return 'camera';
  if (kind === 'message') return 'message';
  if (kind === 'audio') return 'witness';
  if (kind === 'location') return 'place';
  if (kind === 'email') return 'evidence';
  return 'evidence';
}

function boardItemIcon(data: BoardItemData): string {
  if (data.artifact) return generatedIcon(data.artifact.kind);
  if (data.kind === 'question') return 'question';
  if (data.kind === 'reconstruction') return 'reconstruction';
  if (data.eyebrow.includes('PERSON')) return 'person';
  if (data.eyebrow.includes('PLACE')) return 'warehouse';
  if (data.eyebrow.includes('OBJECT')) return 'badge';
  return 'relationship';
}

function evidenceBrief(state: CaseState, artifact: EvidenceArtifact) {
  const observations = state.observations.filter(
    (item) => item.sourceEvidenceId === artifact.id,
  );
  const claims = state.claims.filter((item) => item.sourceEvidenceId === artifact.id);
  const entityIds = new Set([
    ...observations.flatMap((item) => item.entityIds),
    ...state.entities
      .filter((item) => item.sourceEvidenceIds.includes(artifact.id))
      .map((item) => item.id),
  ]);
  const linkedEdges = state.worldEdges.filter(
    (edge) =>
      edge.sourceObservationIds.some((id) => artifact.observationIds.includes(id)) ||
      edge.sourceClaimIds.some((id) => artifact.claimIds.includes(id)),
  );
  const labels = state.entities
    .filter((item) => entityIds.has(item.id))
    .map((item) => item.shortLabel)
    .slice(0, 3);
  return {
    source: `${observations.length} observation${observations.length === 1 ? '' : 's'} · ${claims.length} attributed claim${claims.length === 1 ? '' : 's'}. ${firstLine(artifact.content, 118)}`,
    connection:
      linkedEdges.length > 0 || labels.length > 0
        ? `Touches ${labels.join(', ') || 'the case model'} through ${linkedEdges.length} qualified relationship${linkedEdges.length === 1 ? '' : 's'}. Open it to inspect the exact locators and opposition.`
        : 'Preserved, but not yet connected to a qualified relationship. The board does not invent one.',
  };
}

const layoutSlots = [
  { x: 90, y: 95, width: 340, height: 258 },
  { x: 505, y: 70, width: 330, height: 232 },
  { x: 920, y: 56, width: 380, height: 300 },
  { x: 1390, y: 92, width: 348, height: 264 },
  { x: 1765, y: 465, width: 335, height: 252 },
  { x: 95, y: 505, width: 355, height: 252 },
  { x: 1385, y: 500, width: 350, height: 258 },
  { x: 535, y: 410, width: 315, height: 205 },
  { x: 930, y: 430, width: 330, height: 225 },
  { x: 930, y: 805, width: 350, height: 220 },
  { x: 485, y: 815, width: 405, height: 280 },
  { x: 1165, y: 835, width: 380, height: 260 },
] as const;

function BoardItem({ id, data, selected }: NodeProps<BoardNode>) {
  const reduceMotion = useReducedMotion();
  const artifact = data.artifact;
  return (
    <motion.article
      className={`freeform-card freeform-${data.kind} tone-${data.tone} ${selected ? 'is-selected' : ''} ${data.editable ? 'is-editable' : 'is-locked'}`}
      tabIndex={0}
      style={
        {
          '--card-rotation': `${rotations[id] ?? 0}deg`,
        } as unknown as Record<string, string>
      }
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92, rotate: 0 }}
      animate={{ opacity: 1, scale: 1, rotate: rotations[id] ?? 0 }}
      transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
      {...(reduceMotion
        ? {}
        : {
            whileHover: {
              scale: 1.035,
              rotate: 0,
              y: -8,
              transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] },
            },
          })}
    >
      <NodeResizer
        isVisible={data.editable && selected}
        minWidth={280}
        minHeight={190}
        maxWidth={620}
        maxHeight={500}
        color="#ff6759"
        handleClassName="board-resize-handle"
        lineClassName="board-resize-line"
      />
      <Handle className="thread-handle" type="target" position={Position.Left} />
      <Handle className="thread-handle" type="source" position={Position.Right} />
      <span className="board-pin" aria-hidden="true">
        <i />
      </span>
      <header className="freeform-card-header board-drag-handle">
        <span>
          <img
            className="freeform-generated-icon"
            src={`/icons/generated/${boardItemIcon(data)}.png`}
            alt=""
            aria-hidden="true"
          />
          {data.eyebrow}
        </span>
        <small>{data.meta}</small>
      </header>
      {data.tone === 'photo' ? (
        <div className="evidence-photo" aria-hidden="true">
          {artifact?.extractor === 'redacted-case-derivative' ? (
            <div className="redacted-photo-frame">
              <span>OFFICIAL PUBLIC POST</span>
              <strong>04 PHOTOGRAPHS</strong>
              <i />
              <i />
              <i />
              <i />
              <small>Identifying detail withheld</small>
            </div>
          ) : artifact && !artifact.synthetic && artifact.mimeType.startsWith('image/') ? (
            <img
              src={`/api/cases/${encodeURIComponent(artifact.caseId)}/evidence/${encodeURIComponent(artifact.id)}/content`}
              alt=""
              draggable={false}
            />
          ) : (
            <>
              <span className="camera-noise" />
              <div className="warehouse-frame">
                <i className="warehouse-door" />
                <i className="warehouse-person" />
                <i className="warehouse-car" />
              </div>
            </>
          )}
          <time>
            {artifact?.extractor === 'redacted-case-derivative'
              ? 'PUBLIC SOURCE · IDENTIFIERS WITHHELD'
              : '21:09:03 · CAM 04'}
          </time>
        </div>
      ) : null}
      <div className="freeform-card-copy">
        <h3>{data.title}</h3>
        <p>{data.detail}</p>
      </div>
      <aside className="card-hover-brief" aria-label={`Summary of ${data.title}`}>
        <span>
          <b>IN THIS SOURCE</b>
          {data.sourceBrief}
        </span>
        <span>
          <b>WHY IT MATTERS</b>
          {data.connectionBrief}
        </span>
      </aside>
      {artifact ? (
        <footer>
          <span className={artifact.synthetic ? 'fixture' : 'user-content'}>
            {artifact.synthetic
              ? 'SYNTHETIC SOURCE'
              : artifact.extractor === 'redacted-case-derivative'
                ? 'REDACTED REAL SOURCE'
                : 'USER UPLOAD'}
          </span>
          <button
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpen({ type: 'evidence', id: artifact.id });
            }}
          >
            Inspect source
          </button>
        </footer>
      ) : data.kind === 'question' && data.onInvestigate ? (
        <footer>
          <span>{data.badge}</span>
          <button
            className="nodrag nopan investigate-board-question"
            onClick={(event) => {
              event.stopPropagation();
              data.onInvestigate?.();
            }}
          >
            Investigate
          </button>
        </footer>
      ) : (
        <footer>
          <span>{data.badge}</span>
          {data.selection ? (
            <button
              className="nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                if (data.selection) data.onOpen(data.selection);
              }}
            >
              Open reasoning
            </button>
          ) : null}
        </footer>
      )}
    </motion.article>
  );
}

function ThreadString({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<ThreadEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.28,
  });
  const confidence = data?.confidence ?? 0.5;
  const disputed = data?.disputed ?? false;
  return (
    <>
      <BaseEdge
        id={`${id}-shadow`}
        path={path}
        interactionWidth={0}
        className={`evidence-rope-shadow ${disputed ? 'is-disputed' : ''}`}
        style={{ strokeWidth: 5.4 + confidence * 2.8, opacity: 0.38 }}
      />
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        interactionWidth={28}
        className={`evidence-thread evidence-rope-core ${disputed ? 'is-disputed' : ''} ${selected ? 'is-selected' : ''}`}
        style={{
          strokeWidth: 2.4 + confidence * 2.7,
          opacity: 0.52 + confidence * 0.44,
        }}
      />
      <BaseEdge
        id={`${id}-fiber`}
        path={path}
        interactionWidth={0}
        className={`evidence-rope-fiber ${disputed ? 'is-disputed' : ''}`}
        style={{ strokeWidth: 0.8 + confidence * 0.5, opacity: 0.72 }}
      />
      <EdgeLabelRenderer>
        <button
          className={`thread-label nodrag nopan ${disputed ? 'is-disputed' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          onClick={() => {
            if (data) data.onOpen(data.selection);
          }}
          aria-label={`Inspect ${data?.label ?? 'board'} relationship`}
        >
          {data?.label} · {data?.metric ?? `${Math.round(confidence * 100)}%`}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { boardItem: BoardItem };
const edgeTypes = { thread: ThreadString };

function createNodes(
  state: CaseState,
  onSelect: (selection: Selection) => void,
  onInvestigate: (anomalyId: string) => void,
  editable: boolean,
): BoardNode[] {
  const fixturePins = [
    'EV-014',
    'EV-041',
    'EV-058',
    'EV-071',
    'EV-081',
    'EV-107',
    'EV-121',
  ];
  const preferred = fixturePins.some((id) => state.evidence.some((item) => item.id === id))
    ? fixturePins
    : state.evidence.slice(0, 7).map((item) => item.id);
  const newEvidence = state.evidence
    .filter(
      (item) =>
        !preferred.includes(item.id) &&
        (item.extractor === 'local-deterministic' ||
          item.extractor === 'fireworks' ||
          item.extractor === 'elevenlabs' ||
          item.id === 'EV-143'),
    )
    .slice(0, 3);
  const visibleEvidence = [
    ...preferred
      .map((id) => state.evidence.find((item) => item.id === id))
      .filter((item): item is EvidenceArtifact => Boolean(item)),
    ...newEvidence,
  ];
  const evidenceNodes = visibleEvidence.map((artifact, index): BoardNode => {
    const layout = basePositions[artifact.id] ?? layoutSlots[index % 7]!;
    const brief = evidenceBrief(state, artifact);
    return {
      id: artifact.id,
      type: 'boardItem',
      position: { x: layout.x, y: layout.y },
      width: layout.width,
      height: layout.height,
      data: {
        kind: 'evidence',
        eyebrow: `${artifact.id} · ${artifact.kind}`,
        title: artifact.title,
        detail: firstLine(artifact.content),
        meta: newEvidence.some((item) => item.id === artifact.id)
          ? 'new evidence'
          : (artifact.capturedAt?.precision ?? artifact.extractionStatus),
        tone: artifactTone(artifact),
        selection: { type: 'evidence', id: artifact.id },
        artifact,
        editable,
        sourceBrief: brief.source,
        connectionBrief: brief.connection,
        onOpen: onSelect,
      },
      ariaLabel: `${artifact.title}, ${editable ? 'movable and resizable' : 'locked'} evidence card`,
      dragHandle: '.board-drag-handle',
    };
  });

  const reviewNodes = state.beliefMemory
    .filter((record) => record.id.startsWith('MB-REVIEW-'))
    .slice(0, 2)
    .map((record, index): BoardNode => {
      const beliefId = `B-${record.subjectId}`;
      const selection = state.beliefs.some((belief) => belief.id === beliefId)
        ? ({ type: 'belief', id: beliefId } as const)
        : null;
      const hypothesis = record.id.includes('-H-');
      return {
        id: `BOARD-${record.id}`,
        type: 'boardItem',
        position: { x: 1820 + index * 400, y: 850 },
        width: 365,
        height: 250,
        data: {
          kind: 'reconstruction',
          eyebrow: `${hypothesis ? 'HYPOTHESIS ENGINE' : 'FALSIFIER'} · BELIEF MEMORY`,
          title: hypothesis ? 'Model-supported account' : 'Independent challenge',
          detail: record.summary,
          meta: 'not evidence',
          tone: hypothesis ? 'blue' : 'dark',
          selection,
          badge: `REV ${record.revision} · ${record.sourceIds.length} sources`,
          editable,
          sourceBrief: `${record.sourceIds.length} case objects were included in this model review.`,
          connectionBrief:
            'This is belief memory, not evidence. Its source IDs and creating run remain inspectable.',
          onOpen: onSelect,
        },
        ariaLabel: `${hypothesis ? 'Hypothesis' : 'Falsifier'} model review stored as belief memory`,
        dragHandle: '.board-drag-handle',
      };
    });

  const fixtureEntityIds = ['E-BADGE17', 'E-JORDAN', 'E-WAREHOUSE'];
  const entityIds = fixtureEntityIds.every((id) =>
    state.entities.some((item) => item.id === id),
  )
    ? fixtureEntityIds
    : state.entities
        .slice()
        .sort(
          (a, b) =>
            b.sourceEvidenceIds.length - a.sourceEvidenceIds.length ||
            b.confidence - a.confidence,
        )
        .slice(0, 3)
        .map((item) => item.id);
  const reconstructionLayout = basePositions['R-C']!;
  const anomalyLayout = basePositions['AN-J']!;
  const leading =
    state.reconstructions.find((item) => item.isLeading) ?? state.reconstructions[0];
  const anomaly = state.anomalies.find((item) => item.id === 'AN-J') ?? state.anomalies[0];
  const entityNodes = entityIds.flatMap((id, index): BoardNode[] => {
    const entity = state.entities.find((item) => item.id === id);
    if (!entity) return [];
    const layout = basePositions[id] ?? layoutSlots[7 + index]!;
    const qualifiedEdges = state.worldEdges.filter(
      (edge) => edge.subjectId === id || edge.objectId === id,
    );
    return [
      {
        id,
        type: 'boardItem',
        position: { x: layout.x, y: layout.y },
        width: layout.width,
        height: layout.height,
        data: {
          kind: 'entity',
          eyebrow:
            `${entity.kind.replaceAll('-', ' ').toUpperCase()} ${entity.confidence < 0.6 ? 'CANDIDATE' : ''}`.trim(),
          title: entity.label,
          detail: entity.description,
          meta: `${Math.round(entity.confidence * 100)}% · ${entity.sourceEvidenceIds.length} sources`,
          tone: entity.kind === 'location' || entity.kind === 'event' ? 'blue' : 'dark',
          selection: { type: 'entity', id },
          badge: entity.confidence < 0.6 ? 'UNRESOLVED BINDING' : 'QUALIFIED ENTITY',
          editable,
          sourceBrief: `${entity.sourceEvidenceIds.length} source artifacts currently describe this ${entity.kind.replaceAll('-', ' ')}.`,
          connectionBrief: `${qualifiedEdges.length} qualified relationship${qualifiedEdges.length === 1 ? '' : 's'} touch this card; confidence describes the entity record, not identity proof.`,
          onOpen: onSelect,
        },
        ariaLabel: `${entity.label}, ${editable ? 'movable and resizable' : 'locked'} ${entity.kind} card`,
        dragHandle: '.board-drag-handle',
      },
    ];
  });
  const notes: BoardNode[] = [
    ...(leading
      ? [
          {
            id: leading.id,
            type: 'boardItem' as const,
            position: { x: reconstructionLayout.x, y: reconstructionLayout.y },
            width: reconstructionLayout.width,
            height: reconstructionLayout.height,
            data: {
              kind: 'reconstruction' as const,
              eyebrow: 'LEADING RECONSTRUCTION',
              title: leading.title,
              detail: leading.summary,
              meta: `${leading.coveragePercent}% coverage`,
              tone: 'sticky' as const,
              selection:
                leading.hypothesisIds
                  .map((id) => state.beliefs.find((belief) => belief.id === id))
                  .find(Boolean) !== undefined
                  ? ({
                      type: 'belief' as const,
                      id: leading.hypothesisIds.find((id) =>
                        state.beliefs.some((belief) => belief.id === id),
                      )!,
                    } as const)
                  : null,
              badge: `${leading.contradictions} contradictions · ${leading.assumptions} assumptions`,
              editable,
              sourceBrief: `${leading.statements.length} statements are individually labeled as supported, inferred, disputed, or unknown.`,
              connectionBrief: `${leading.coveragePercent}% weighted coverage. ${leading.contradictions} contradiction${leading.contradictions === 1 ? '' : 's'} and ${leading.assumptions} assumption${leading.assumptions === 1 ? '' : 's'} remain visible.`,
              onOpen: onSelect,
            },
            ariaLabel: `${leading.title}, ${editable ? 'movable and resizable' : 'locked'} reconstruction card`,
            dragHandle: '.board-drag-handle',
          },
        ]
      : []),
    ...(anomaly
      ? [
          {
            id: anomaly.id,
            type: 'boardItem' as const,
            position: { x: anomalyLayout.x, y: anomalyLayout.y },
            width: anomalyLayout.width,
            height: anomalyLayout.height,
            data: {
              kind: 'question' as const,
              eyebrow: 'OPEN INVESTIGATIVE QUESTION',
              title: anomaly.question,
              detail: anomaly.lastResult ?? anomaly.detail,
              meta: `${Math.round(anomaly.expectedInformationGain * 100)} EIG`,
              tone: 'sticky' as const,
              selection: null,
              badge: anomaly.status.toUpperCase(),
              editable,
              sourceBrief: `${anomaly.relatedIds.length} case objects are directly attached to this question.`,
              connectionBrief: `Expected information gain ${Math.round(anomaly.expectedInformationGain * 100)}%. Running it works only those linked objects and records what remains unresolved.`,
              onOpen: onSelect,
              ...(anomaly.status === 'open'
                ? { onInvestigate: () => onInvestigate(anomaly.id) }
                : {}),
            },
            ariaLabel: `${anomaly.question}, ${editable ? 'movable and resizable' : 'locked'} investigative question`,
            dragHandle: '.board-drag-handle',
          },
        ]
      : []),
  ];
  return [...evidenceNodes, ...reviewNodes, ...entityNodes, ...notes];
}

function relationFor(state: CaseState, source: string, target: string): WorldEdge | null {
  return (
    state.worldEdges.find(
      (edge) => edge.subjectId === source && edge.objectId === target,
    ) ??
    state.worldEdges.find(
      (edge) => edge.subjectId === target && edge.objectId === source,
    ) ??
    null
  );
}

function createEdges(
  state: CaseState,
  availableIds: Set<string>,
  onSelect: (selection: Selection) => void,
): ThreadEdge[] {
  const edges: ThreadEdge[] = [];
  const add = (input: {
    id: string;
    source: string;
    target: string;
    relation: WorldEdge | null;
    label: string;
    confidence: number;
    metric: string;
    disputed: boolean;
    selection: Selection;
  }) => {
    if (!availableIds.has(input.source) || !availableIds.has(input.target)) return;
    if (edges.some((edge) => edge.id === input.id)) return;
    edges.push({
      id: input.id,
      type: 'thread',
      source: input.source,
      target: input.target,
      selectable: true,
      focusable: true,
      ariaLabel: `${input.label}, ${Math.round(input.confidence * 100)} percent confidence${input.disputed ? ', disputed' : ''}`,
      data: {
        relation: input.relation,
        selection: input.selection,
        label: input.label,
        confidence: input.confidence,
        metric: input.metric,
        disputed: input.disputed,
        onOpen: onSelect,
      },
    });
  };

  // Direct entity-to-entity strings are literal world relationships.
  for (const relation of state.worldEdges
    .filter((edge) => availableIds.has(edge.subjectId) && availableIds.has(edge.objectId))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)) {
    add({
      id: relation.id,
      source: relation.subjectId,
      target: relation.objectId,
      relation,
      label: relation.predicate.replaceAll('_', ' ').toLowerCase(),
      confidence: relation.confidence,
      metric: `${Math.round(relation.confidence * 100)}% confidence`,
      disputed: relation.disputed,
      selection: { type: 'edge', id: relation.id },
    });
  }

  // Each evidence-to-entity string exists only when the artifact contributed a
  // claim/observation to that relationship (or is explicitly a source for the entity).
  for (const artifact of state.evidence.filter((item) => availableIds.has(item.id))) {
    const sourcedRelations = state.worldEdges
      .filter(
        (edge) =>
          edge.sourceObservationIds.some((id) => artifact.observationIds.includes(id)) ||
          edge.sourceClaimIds.some((id) => artifact.claimIds.includes(id)),
      )
      .sort((a, b) => b.confidence - a.confidence);
    const relation = sourcedRelations.find(
      (edge) => availableIds.has(edge.subjectId) || availableIds.has(edge.objectId),
    );
    const target = relation
      ? availableIds.has(relation.subjectId)
        ? relation.subjectId
        : relation.objectId
      : state.entities.find(
          (entity) =>
            availableIds.has(entity.id) && entity.sourceEvidenceIds.includes(artifact.id),
        )?.id;
    if (!target) continue;
    const targetEntity = state.entities.find((item) => item.id === target);
    add({
      id: `THREAD-SOURCE-${artifact.id}-${target}`,
      source: artifact.id,
      target,
      relation: relation ?? null,
      label: relation
        ? relation.predicate.replaceAll('_', ' ').toLowerCase()
        : `source for ${targetEntity?.shortLabel.toLocaleLowerCase() ?? 'entity'}`,
      confidence: relation?.confidence ?? 1,
      metric: relation
        ? `${Math.round(relation.confidence * 100)}% confidence`
        : 'exact source link',
      disputed: relation?.disputed ?? false,
      selection: relation
        ? { type: 'edge', id: relation.id }
        : { type: 'evidence', id: artifact.id },
    });
  }

  const leading = state.reconstructions.find(
    (item) => item.isLeading && availableIds.has(item.id),
  );
  if (leading) {
    const sourceIds = new Set(leading.statements.flatMap((item) => item.sourceIds));
    for (const artifact of state.evidence
      .filter(
        (item) =>
          availableIds.has(item.id) &&
          (sourceIds.has(item.id) ||
            item.observationIds.some((id) => sourceIds.has(id)) ||
            item.claimIds.some((id) => sourceIds.has(id))),
      )
      .slice(0, 2)) {
      add({
        id: `THREAD-RECON-${artifact.id}-${leading.id}`,
        source: artifact.id,
        target: leading.id,
        relation: null,
        label: 'used by account',
        confidence: leading.coveragePercent / 100,
        metric: `${leading.coveragePercent}% coverage`,
        disputed: leading.contradictions > 0,
        selection: { type: 'evidence', id: artifact.id },
      });
    }
  }

  const anomaly = state.anomalies.find((item) => availableIds.has(item.id));
  if (anomaly) {
    const source = anomaly.relatedIds.find((id) => availableIds.has(id));
    if (source) {
      const fallbackSelection: Selection = state.evidence.some((item) => item.id === source)
        ? { type: 'evidence', id: source }
        : { type: 'entity', id: source };
      add({
        id: `THREAD-QUESTION-${source}-${anomaly.id}`,
        source,
        target: anomaly.id,
        relation: relationFor(state, source, anomaly.id),
        label: 'opens question',
        confidence: anomaly.expectedInformationGain,
        metric: `${Math.round(anomaly.expectedInformationGain * 100)}% EIG`,
        disputed: true,
        selection: fallbackSelection,
      });
    }
  }
  return edges;
}

export function EvidenceCanvas({
  state,
  selection: _selection,
  pulse,
  busyAction,
  onSelect,
  onUpload,
  onInvestigate,
}: EvidenceCanvasProps) {
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [boardUnlocked, setBoardUnlocked] = useState(false);
  const compactViewport = window.matchMedia('(max-width: 820px)').matches;
  const layoutStorageKey = `thread-board-layout:${state.metadata.id}`;
  const restoreLayout = useCallback(
    (items: BoardNode[]): BoardNode[] => {
      try {
        const saved = JSON.parse(
          window.localStorage.getItem(layoutStorageKey) ?? '{}',
        ) as Record<string, { x: number; y: number; width?: number; height?: number }>;
        return items.map((item) => {
          const layout = saved[item.id];
          if (!layout) return item;
          return {
            ...item,
            position: { x: layout.x, y: layout.y },
            ...(layout.width ? { width: layout.width } : {}),
            ...(layout.height ? { height: layout.height } : {}),
          };
        });
      } catch {
        return items;
      }
    },
    [layoutStorageKey],
  );
  const initialNodes = useMemo(
    () => restoreLayout(createNodes(state, onSelect, onInvestigate, false)),
    [state, onSelect, onInvestigate, restoreLayout],
  );
  const initialEdges = useMemo(
    () => createEdges(state, new Set(initialNodes.map((node) => node.id)), onSelect),
    [state, initialNodes, onSelect],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, editable: boardUnlocked },
        ...(node.ariaLabel
          ? {
              ariaLabel: node.ariaLabel.replace(
                /(?:movable and resizable|locked)/u,
                boardUnlocked ? 'movable and resizable' : 'locked',
              ),
            }
          : {}),
      })),
    );
  }, [boardUnlocked, setNodes]);

  useEffect(() => {
    if (!boardUnlocked) return;
    const saved = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          x: node.position.x,
          y: node.position.y,
          ...(node.width ? { width: node.width } : {}),
          ...(node.height ? { height: node.height } : {}),
        },
      ]),
    );
    window.localStorage.setItem(layoutStorageKey, JSON.stringify(saved));
  }, [boardUnlocked, layoutStorageKey, nodes]);

  const resetLayout = useCallback(() => {
    window.localStorage.removeItem(layoutStorageKey);
    setLayoutVersion((value) => value + 1);
    const next = createNodes(state, onSelect, onInvestigate, boardUnlocked);
    setNodes(next);
    setEdges(createEdges(state, new Set(next.map((node) => node.id)), onSelect));
  }, [boardUnlocked, layoutStorageKey, onInvestigate, onSelect, setEdges, setNodes, state]);

  return (
    <section className={`evidence-canvas-shell ${pulse > 0 ? 'board-is-changing' : ''}`}>
      <header className="canvas-floating-header">
        <div>
          <span>EVIDENCE BOARD</span>
          <h2>{state.metadata.title}</h2>
        </div>
        <div className="canvas-context">
          <span>
            <ShieldCheck size={13} aria-hidden="true" /> REV{' '}
            {String(state.metadata.revision).padStart(2, '0')}
          </span>
          <span>{state.evidence.length} artifacts</span>
          <span>{state.worldEdges.length} qualified strings</span>
        </div>
      </header>

      <div className="canvas-action-dock" aria-label="Evidence board actions">
        <button className="canvas-upload-button" onClick={onUpload}>
          <Plus size={17} aria-hidden="true" />
          Add evidence
        </button>
        <button onClick={resetLayout} aria-label="Reset board layout">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button
          className={`board-lock-control ${boardUnlocked ? 'is-unlocked' : ''}`}
          onClick={() => setBoardUnlocked((value) => !value)}
          aria-pressed={boardUnlocked}
          aria-label={boardUnlocked ? 'Lock board' : 'Unlock board'}
        >
          {boardUnlocked ? (
            <Unlock size={16} aria-hidden="true" />
          ) : (
            <Lock size={16} aria-hidden="true" />
          )}
          <span>{boardUnlocked ? 'Unlocked' : 'Locked'}</span>
        </button>
        <span aria-hidden="true" />
        <button
          aria-label="Find open investigative question"
          onClick={() => {
            const anomaly = state.anomalies.find((item) => item.status === 'open');
            if (anomaly) onInvestigate(anomaly.id);
          }}
          disabled={
            busyAction !== null || !state.anomalies.some((item) => item.status === 'open')
          }
        >
          <Search size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="board-revision-status" role="status" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.span
            key={`${state.metadata.revision}-${busyAction ?? 'ready'}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {busyAction ? (
              <>
                <Sparkles size={13} aria-hidden="true" /> Agents are updating the relevant
                evidence…
              </>
            ) : pulse > 0 ? (
              <>
                <Maximize2 size={13} aria-hidden="true" /> Board updated from persisted case
                revision {state.metadata.revision}
              </>
            ) : (
              <>
                {boardUnlocked ? (
                  <>
                    <Unlock size={13} aria-hidden="true" /> Board unlocked · move and resize
                    cards freely
                  </>
                ) : (
                  <>
                    <Lock size={13} aria-hidden="true" /> Board locked · pan and inspect
                    without moving evidence
                  </>
                )}
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </div>

      <ReactFlow<BoardNode, ThreadEdge>
        key={`${state.metadata.revision}-${layoutVersion}`}
        className="evidence-freeform"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={(_event, node) => {
          if (node.data.selection) onSelect(node.data.selection);
        }}
        onEdgeClick={(_event, edge) => {
          if (edge.data) onSelect(edge.data.selection);
        }}
        defaultViewport={
          compactViewport ? { x: -60, y: 72, zoom: 0.9 } : { x: 24, y: 112, zoom: 0.9 }
        }
        minZoom={0.38}
        maxZoom={1.65}
        panOnScroll
        selectionOnDrag={boardUnlocked}
        nodesDraggable={boardUnlocked}
        nodesFocusable
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        aria-label={`Interactive evidence bulletin board with ${boardUnlocked ? 'movable and resizable' : 'locked'} evidence cards and inspectable strings`}
      >
        <Background color="rgba(24, 11, 4, .16)" gap={32} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={0}
          maskColor="rgba(18, 13, 9, .55)"
          nodeColor={(node) =>
            node.data.kind === 'evidence'
              ? '#ead6b1'
              : node.data.kind === 'question'
                ? '#e0c75a'
                : '#202725'
          }
        />
      </ReactFlow>
      <footer className="canvas-source-rule">
        <span>
          Every string opens its sources, opposition, confidence, and invalidation path.
        </span>
        <span>
          Hover for the source summary · double-click to inspect · unlock to rearrange
        </span>
      </footer>
    </section>
  );
}
