import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import type { RunnableConfig } from '@langchain/core/runnables';
import { type AgentName, type AgentRun, type AgentRunStep } from '@thread/domain';
import { MongoClient } from 'mongodb';

const agentOrder: AgentName[] = [
  'INGESTOR',
  'RESOLVER',
  'CHRONOLOGIST',
  'LINKER',
  'HYPOTHESIS ENGINE',
  'FALSIFIER',
  'INVESTIGATOR',
];

const WorkflowState = Annotation.Root({
  caseId: Annotation<string>(),
  trigger: Annotation<string>(),
  affectedIds: Annotation<string[]>(),
  selectedAgents: Annotation<AgentName[]>(),
  providerDetails: Annotation<
    Record<
      string,
      {
        provider: AgentRunStep['provider'];
        model: string | null;
        detail?: string;
        inputIds?: string[];
        outputIds?: string[];
      }
    >
  >(),
  steps: Annotation<AgentRunStep[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

function agentSlug(agent: AgentName): string {
  return agent.toLocaleLowerCase().replaceAll(' ', '-');
}

function deterministicDetail(agent: AgentName, affectedCount: number): string {
  const noun = `${affectedCount} affected case object${affectedCount === 1 ? '' : 's'}`;
  switch (agent) {
    case 'INGESTOR':
      return `Separated raw artifacts, observations, and quoted claims across ${noun}.`;
    case 'RESOLVER':
      return `Updated candidate bindings without hard-merging uncertain references across ${noun}.`;
    case 'CHRONOLOGIST':
      return `Rechecked fuzzy intervals and Allen constraints for ${noun}.`;
    case 'LINKER':
      return `Expanded provenance-bound world relationships for ${noun}.`;
    case 'HYPOTHESIS ENGINE':
      return `Recomputed competing explanatory accounts for ${noun}.`;
    case 'FALSIFIER':
      return `Searched for the strongest contradiction and ATMS nogoods affecting ${noun}.`;
    case 'INVESTIGATOR':
      return `Ranked open questions by expected information gain after ${noun}.`;
  }
}

export class AgentOrchestrator {
  private readonly client: MongoClient | null;
  private readonly checkpointer: MongoDBSaver | null;
  private graphInvoke:
    | ((
        input: typeof WorkflowState.State,
        configuration: RunnableConfig,
      ) => Promise<typeof WorkflowState.State>)
    | null = null;

  constructor(environment: NodeJS.ProcessEnv) {
    const uri = environment.MONGODB_URI?.trim();
    if (!uri) {
      this.client = null;
      this.checkpointer = null;
      return;
    }
    this.client = new MongoClient(uri, { appName: 'THREAD LangGraph Checkpointer' });
    this.checkpointer = new MongoDBSaver({
      client: this.client,
      dbName: environment.MONGODB_DATABASE?.trim() || 'thread',
      checkpointCollectionName: 'langgraph_checkpoints',
      checkpointWritesCollectionName: 'langgraph_checkpoint_writes',
      enableTimestamps: true,
    });
  }

  async initialize(): Promise<void> {
    if (!this.client || !this.checkpointer) return;
    await this.client.connect();
    const setupErrors = await this.checkpointer.setup();
    if (setupErrors.length > 0) {
      const setupError = setupErrors[0];
      throw setupError instanceof Error
        ? setupError
        : new Error(`LangGraph checkpoint setup failed: ${String(setupError)}`);
    }
    const makeNode = (agent: AgentName) => {
      return (state: typeof WorkflowState.State) => {
        const startedAt = performance.now();
        const selected = state.selectedAgents.includes(agent);
        const execution = state.providerDetails[agent];
        const step: AgentRunStep = {
          id: `STEP-${agentSlug(agent)}-${Date.now().toString(36).toUpperCase()}`,
          agent,
          status: selected ? 'completed' : 'skipped',
          detail: selected
            ? execution?.detail || deterministicDetail(agent, state.affectedIds.length)
            : 'No dependency path from this trigger required the transformation.',
          inputIds: execution?.inputIds ?? state.affectedIds,
          outputIds: selected ? (execution?.outputIds ?? []) : [],
          provider: execution?.provider ?? 'deterministic',
          model: execution?.model ?? null,
          durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
        return { steps: [step] };
      };
    };
    // Keep this chain explicit: LangGraph's fluent type carries the legal node
    // names forward, so a dynamic loop would erase the compile-time edge audit.
    const builder = new StateGraph(WorkflowState)
      .addNode('INGESTOR', makeNode('INGESTOR'))
      .addNode('RESOLVER', makeNode('RESOLVER'))
      .addNode('CHRONOLOGIST', makeNode('CHRONOLOGIST'))
      .addNode('LINKER', makeNode('LINKER'))
      .addNode('HYPOTHESIS ENGINE', makeNode('HYPOTHESIS ENGINE'))
      .addNode('FALSIFIER', makeNode('FALSIFIER'))
      .addNode('INVESTIGATOR', makeNode('INVESTIGATOR'))
      .addEdge(START, 'INGESTOR')
      .addEdge('INGESTOR', 'RESOLVER')
      .addEdge('RESOLVER', 'CHRONOLOGIST')
      .addEdge('CHRONOLOGIST', 'LINKER')
      .addEdge('LINKER', 'HYPOTHESIS ENGINE')
      .addEdge('HYPOTHESIS ENGINE', 'FALSIFIER')
      .addEdge('FALSIFIER', 'INVESTIGATOR')
      .addEdge('INVESTIGATOR', END);
    const compiled = builder.compile({ checkpointer: this.checkpointer });
    this.graphInvoke = (input, configuration) => compiled.invoke(input, configuration);
  }

  async run(input: {
    caseId: string;
    trigger: string;
    affectedIds: string[];
    selectedAgents?: AgentName[];
    packetId?: string | null;
    providerDetails?: Record<
      string,
      {
        provider: AgentRunStep['provider'];
        model: string | null;
        detail?: string;
        inputIds?: string[];
        outputIds?: string[];
      }
    >;
  }): Promise<AgentRun> {
    const startedAt = new Date().toISOString();
    const runId = `RUN-${Date.now().toString(36).toUpperCase()}`;
    const threadId = `${input.caseId}:${runId}`;
    if (!this.graphInvoke || !this.checkpointer) {
      const selected = input.selectedAgents ?? agentOrder;
      return {
        id: runId,
        caseId: input.caseId,
        trigger: input.trigger,
        status: 'completed',
        affectedIds: input.affectedIds,
        packetId: input.packetId ?? null,
        checkpointThreadId: null,
        checkpointId: null,
        steps: agentOrder.map((agent) => ({
          id: `${runId}-${agentSlug(agent)}`,
          agent,
          status: selected.includes(agent) ? 'completed' : 'skipped',
          detail: selected.includes(agent)
            ? (input.providerDetails?.[agent]?.detail ??
              deterministicDetail(agent, input.affectedIds.length))
            : 'No dependency path from this trigger required the transformation.',
          inputIds: input.providerDetails?.[agent]?.inputIds ?? input.affectedIds,
          outputIds: selected.includes(agent)
            ? (input.providerDetails?.[agent]?.outputIds ?? [])
            : [],
          provider: input.providerDetails?.[agent]?.provider ?? 'deterministic',
          model: input.providerDetails?.[agent]?.model ?? null,
          durationMs: 1,
        })),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    // The saver records the root graph in the empty checkpoint namespace; the
    // unique thread ID is the durable case/run boundary.
    const configuration = { configurable: { thread_id: threadId } };
    const result = await this.graphInvoke(
      {
        caseId: input.caseId,
        trigger: input.trigger,
        affectedIds: input.affectedIds,
        selectedAgents: input.selectedAgents ?? agentOrder,
        providerDetails: input.providerDetails ?? {},
        steps: [],
      },
      configuration,
    );
    const checkpoint = await this.checkpointer.getTuple(configuration);
    return {
      id: runId,
      caseId: input.caseId,
      trigger: input.trigger,
      status: 'completed',
      affectedIds: input.affectedIds,
      packetId: input.packetId ?? null,
      checkpointThreadId: threadId,
      checkpointId: checkpoint?.checkpoint.id ?? null,
      steps: result.steps,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.client?.close();
  }
}
