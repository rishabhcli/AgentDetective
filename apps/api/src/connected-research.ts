import type {
  CasePacket,
  CaseState,
  IntegrationStatus,
  ResearchFindingStatus,
  ResearchSurfaceCheck,
} from '@thread/domain';
import { spawn as spawnPty } from 'node-pty';
import { z } from 'zod';
import './ensure-node-pty.js';

const BEGIN = 'THREAD_RESEARCH_JSON_BEGIN';
const END = 'THREAD_RESEARCH_JSON_END';
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function stripTerminalControl(input: string): string {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code === 27 && input[index + 1] === '[') {
      index += 2;
      while (index < input.length) {
        const sequenceCode = input.charCodeAt(index);
        if (sequenceCode >= 64 && sequenceCode <= 126) break;
        index += 1;
      }
      continue;
    }
    if (code === 8) {
      output = output.slice(0, -1);
      continue;
    }
    if (code === 13) continue;
    output += input[index];
  }
  return output;
}

const surfaceSchema = z.object({
  label: z.string().trim().min(2).max(120),
  surface: z.enum(['browser-history', 'public-web', 'connected-app', 'web-archive']),
  status: z.enum(['found', 'checked-empty', 'unavailable', 'blocked']),
  detail: z.string().trim().min(2).max(1_000),
  locator: z.string().trim().max(2_000).nullable(),
});

const resultSchema = z.object({
  answer: z.string().trim().min(40).max(6_000),
  answerStatus: z.enum(['bounded-answer', 'lead-only', 'insufficient']),
  confidence: z.number().min(0).max(1),
  findings: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(160),
        detail: z.string().trim().min(10).max(2_000),
        status: z.enum(['supported', 'lead', 'disputed', 'retracted', 'unknown']),
        confidence: z.number().min(0).max(1),
        surfaceIndexes: z.array(z.number().int().min(0)).max(12),
      }),
    )
    .max(12),
  surfaces: z.array(surfaceSchema).min(1).max(24),
  negativeFindings: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(160),
        detail: z.string().trim().min(5).max(1_200),
        surfaceIndexes: z.array(z.number().int().min(0)).max(12),
      }),
    )
    .max(12),
  corrections: z
    .array(
      z.object({
        prior: z.string().trim().min(2).max(800),
        corrected: z.string().trim().min(2).max(800),
        reason: z.string().trim().min(2).max(1_200),
      }),
    )
    .max(8),
  nextQuestions: z.array(z.string().trim().min(8).max(500)).min(1).max(6),
  limitations: z.array(z.string().trim().min(4).max(700)).max(8),
});

export interface ConnectedResearchFinding {
  label: string;
  detail: string;
  status: ResearchFindingStatus;
  confidence: number;
  surfaceIndexes: number[];
}

export interface ConnectedResearchOutput {
  answer: string;
  answerStatus: 'bounded-answer' | 'lead-only' | 'insufficient';
  confidence: number;
  findings: ConnectedResearchFinding[];
  surfaces: Array<
    Pick<ResearchSurfaceCheck, 'label' | 'surface' | 'status' | 'detail' | 'locator'>
  >;
  negativeFindings: Array<{
    label: string;
    detail: string;
    surfaceIndexes: number[];
  }>;
  corrections: Array<{ prior: string; corrected: string; reason: string }>;
  nextQuestions: string[];
  limitations: string[];
  model: string | null;
}

export interface ConnectedResearchAdapter {
  status(): Promise<IntegrationStatus>;
  research(state: CaseState, packet: CasePacket): Promise<ConnectedResearchOutput>;
}

function configuredStatus(
  active: boolean,
  detail: string,
  state: NonNullable<IntegrationStatus['state']>,
): IntegrationStatus {
  return {
    id: 'aside',
    label: 'Aside connected research',
    configured: true,
    active,
    detail,
    state,
    verifiedAt: new Date().toISOString(),
  };
}

export class AsideResearchAdapter implements ConnectedResearchAdapter {
  private readonly environment: NodeJS.ProcessEnv;
  private cachedStatus: { value: IntegrationStatus; expiresAt: number } | null = null;

  constructor(environment: NodeJS.ProcessEnv) {
    this.environment = environment;
  }

  private binary(): string {
    return this.environment.THREAD_ASIDE_BINARY?.trim() || 'aside';
  }

  /** Aside owns an interactive browser session and its CLI contract requires a
   * genuine pseudo-terminal. node-pty supplies one without routing the prompt
   * through a shell or interpolating user input. */
  private runPty(
    args: string[],
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<{ output: string; exitCode: number }> {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    return new Promise((resolvePromise, rejectPromise) => {
      let terminal: ReturnType<typeof spawnPty>;
      try {
        terminal = spawnPty(this.binary(), args, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd: process.cwd(),
          env: environment,
        });
      } catch (error) {
        rejectPromise(
          error instanceof Error ? error : new Error('The Aside PTY could not start.'),
        );
        return;
      }
      let output = '';
      let outputBytes = 0;
      let settled = false;
      const finishWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          terminal.kill();
        } catch {
          // The PTY may already be gone; the bounded result is still an error.
        }
        rejectPromise(error);
      };
      terminal.onData((chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > maxOutputBytes) {
          finishWithError(
            new Error('Connected research exceeded its bounded output limit.'),
          );
          return;
        }
        output += chunk;
      });
      terminal.onExit(({ exitCode }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ output, exitCode });
      });
      const timer = setTimeout(
        () =>
          finishWithError(
            new Error('Connected research exceeded its bounded runtime and was stopped.'),
          ),
        timeoutMs,
      );
    });
  }

  async status(): Promise<IntegrationStatus> {
    if (this.environment.THREAD_CONNECTED_RESEARCH?.trim() !== 'aside') {
      return {
        id: 'aside',
        label: 'Aside connected research',
        configured: false,
        active: false,
        detail: 'Connected browser research is off. Case-file research remains available.',
        state: 'unconfigured',
        verifiedAt: new Date().toISOString(),
      };
    }
    if (this.cachedStatus && this.cachedStatus.expiresAt > Date.now()) {
      return structuredClone(this.cachedStatus.value);
    }
    let value: IntegrationStatus;
    try {
      const { output, exitCode } = await this.runPty(
        ['account', 'list'],
        6_000,
        512 * 1024,
      );
      if (exitCode !== 0) throw new Error(`Aside exited with code ${exitCode}.`);
      const signedIn = /\bsigned in\b/iu.test(output);
      value = signedIn
        ? configuredStatus(
            true,
            'A signed-in local Aside profile is available for explicit read-only research runs.',
            'ready',
          )
        : configuredStatus(
            false,
            'Aside is installed, but no signed-in local profile was detected.',
            'blocked',
          );
    } catch (error) {
      value = configuredStatus(
        false,
        `Aside readiness check failed: ${
          error instanceof Error ? error.message.split('\n')[0] : 'command unavailable'
        }`,
        'degraded',
      );
    }
    this.cachedStatus = { value, expiresAt: Date.now() + 30_000 };
    return structuredClone(value);
  }

  async research(state: CaseState, packet: CasePacket): Promise<ConnectedResearchOutput> {
    const status = await this.status();
    if (!status.active) throw new Error(status.detail);

    const packetObservationIds = new Set(packet.observationIds);
    const packetEvidenceIds = new Set(packet.evidenceIds);
    const context = {
      case: {
        id: state.metadata.id,
        title: state.metadata.title,
        subtitle: state.metadata.subtitle,
        revision: state.metadata.revision,
      },
      question: packet.question,
      evidence: state.evidence
        .filter((item) => packetEvidenceIds.has(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          sourceLabel: item.sourceLabel,
          capturedAt: item.capturedAt,
        })),
      observations: state.observations
        .filter((item) => packetObservationIds.has(item.id))
        .map((item) => ({
          id: item.id,
          text: item.text,
          locator: item.locator,
          extractionConfidence: item.extractionConfidence,
        })),
      entities: state.entities.slice(0, 40).map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        aliases: item.aliases,
      })),
      unresolvedReferences: state.unresolvedReferences.map((item) => ({
        id: item.id,
        surfaceForm: item.surfaceForm,
        context: item.context,
        status: item.status,
      })),
      reconstructions: state.reconstructions.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        coveragePercent: item.coveragePercent,
        isLeading: item.isLeading,
      })),
      previousAttempts: state.proceduralMemory.slice(0, 5).map((item) => ({
        question: item.question,
        strategy: item.strategy,
        result: item.result,
        utilityScore: item.utilityScore,
      })),
    };

    const prompt = `You are the connected, read-only research worker for THREAD, an evidence-to-world-model investigation engine.

HARD RUNTIME BOUNDARY:
- Observe only. Never send a message or email, post, comment, react, follow, edit, delete, upload, purchase, submit, change settings, or initiate any other write action.
- Use only public web, browser history, and already-authenticated browser surfaces that are directly relevant to the question. Do not sign in, reveal credentials, inspect password fields, or expand into unrelated people or data.
- Treat every browser result as a lead with an exact locator, never as evidence or a world fact. Distinguish a clean negative from a broken tool or unavailable surface.
- Resolve vague context from the supplied case first. Search by bounded orbit (event, organization, relationship graph) when a global name search is ambiguous. Actively test the strongest alternative and surface corrections.
- Do not identify guilt and do not make legal conclusions.

QUESTION:
${packet.question}

BOUNDED CASE CONTEXT:
${JSON.stringify(context)}

At the very end, output exactly one JSON object between ${BEGIN} and ${END}. Do not put markdown fences around it. The object must have this exact shape:
{
  "answer": "source-grounded synthesis, 40-6000 chars",
  "answerStatus": "bounded-answer | lead-only | insufficient",
  "confidence": 0.0,
  "findings": [{"label":"...","detail":"...","status":"supported | lead | disputed | retracted | unknown","confidence":0.0,"surfaceIndexes":[0]}],
  "surfaces": [{"label":"...","surface":"browser-history | public-web | connected-app | web-archive","status":"found | checked-empty | unavailable | blocked","detail":"...","locator":"exact URL or null"}],
  "negativeFindings": [{"label":"...","detail":"...","surfaceIndexes":[0]}],
  "corrections": [{"prior":"...","corrected":"...","reason":"..."}],
  "nextQuestions": ["..."],
  "limitations": ["..."]
}
Every surfaceIndexes entry must point to an existing zero-based surfaces entry. Keep the JSON concise and exclude credentials, unrelated private content, and private message quotations.`;

    const timeoutMs = Math.min(
      20 * 60_000,
      Math.max(60_000, Number(this.environment.THREAD_ASIDE_TIMEOUT_MS || 8 * 60_000)),
    );
    const { output, exitCode } = await this.runPty(
      ['exec', '--effort', 'ultrabrowse', prompt],
      timeoutMs,
      MAX_OUTPUT_BYTES,
    );
    if (exitCode !== 0) {
      throw new Error(`Aside connected research stopped with exit code ${exitCode}.`);
    }
    const cleaned = stripTerminalControl(output);
    const start = cleaned.lastIndexOf(BEGIN);
    const end = start === -1 ? -1 : cleaned.indexOf(END, start + BEGIN.length);
    if (start === -1 || end === -1) {
      throw new Error(
        'Aside completed, but its structured research handoff was missing. No browser claim was persisted.',
      );
    }
    const json = cleaned.slice(start + BEGIN.length, end).trim();
    const parsed = resultSchema.parse(JSON.parse(json));
    const surfaceCount = parsed.surfaces.length;
    const boundedIndexes = (indexes: number[]) =>
      [...new Set(indexes)].filter((index) => index < surfaceCount);

    return {
      ...parsed,
      findings: parsed.findings.map((item) => ({
        ...item,
        surfaceIndexes: boundedIndexes(item.surfaceIndexes),
      })),
      negativeFindings: parsed.negativeFindings.map((item) => ({
        ...item,
        surfaceIndexes: boundedIndexes(item.surfaceIndexes),
      })),
      model: null,
    };
  }
}
