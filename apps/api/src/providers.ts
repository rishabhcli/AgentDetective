import { type CasePacket, type CaseState, type IntegrationStatus } from '@thread/domain';
import { z } from 'zod';

const visualExtractionSchema = z.object({
  observations: z.array(
    z.object({
      kind: z.enum(['visual', 'temporal', 'location', 'identity-signal']),
      text: z.string().min(1),
      locator: z.string().min(1),
      extractionConfidence: z.number().min(0).max(1),
      mentionedEntities: z.array(z.string()),
      uncertainty: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

const hypothesisReviewSchema = z.object({
  summary: z.string().min(40),
  leading_reconstruction_id: z.string().regex(/^R-/u),
  diagnostic_evidence_ids: z.array(z.string().regex(/^(?:EV|O|C)-/u)),
  unresolved_assumptions: z.array(z.string()),
  next_question: z.string().min(15),
});

const falsifierReviewSchema = z.object({
  strongest_counterargument: z.string().min(40),
  contradicting_ids: z.array(z.string().regex(/^(?:EV|O|C|A|B|H|R)-/u)),
  alternative_reconstruction_id: z.string().regex(/^R-/u),
  stop_believing_if: z.string().min(25),
});

export type VisualExtraction = z.infer<typeof visualExtractionSchema> & { model: string };
export type HypothesisReview = z.infer<typeof hypothesisReviewSchema>;
export type FalsifierReview = z.infer<typeof falsifierReviewSchema>;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  model?: string;
}

function withTimeout(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

async function responseMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error
  ) {
    return String(body.error.message);
  }
  if (
    body &&
    typeof body === 'object' &&
    'detail' in body &&
    body.detail &&
    typeof body.detail === 'object' &&
    'message' in body.detail
  ) {
    return String(body.detail.message);
  }
  return `${response.status} ${response.statusText}`;
}

function jsonFromContent(content: string): unknown {
  return JSON.parse(
    content
      .trim()
      .replace(/^```(?:json)?\s*/u, '')
      .replace(/\s*```$/u, ''),
  );
}

function repairHint(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'response'} — ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : 'unknown validation failure';
}

function status(
  id: IntegrationStatus['id'],
  label: string,
  configured: boolean,
  active: boolean,
  detail: string,
  state: NonNullable<IntegrationStatus['state']>,
): IntegrationStatus {
  return {
    id,
    label,
    configured,
    active,
    detail,
    state,
    verifiedAt: new Date().toISOString(),
  };
}

function caseKeyterms(state: CaseState, limit: number, maxLength: number): string[] {
  const candidates = state.entities.flatMap((entity) => [
    entity.label,
    ...entity.aliases,
    ...Object.values(entity.properties).flat(),
  ]);
  return [
    ...new Set(
      candidates
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length > 1 &&
            term.length <= maxLength &&
            term.split(/\s+/u).length <= 5 &&
            !/[<>{}[\]\\]/u.test(term),
        ),
    ),
  ].slice(0, limit);
}

export class ProviderHub {
  private readonly environment: NodeJS.ProcessEnv;
  private statuses: IntegrationStatus[] = [];

  constructor(environment: NodeJS.ProcessEnv) {
    this.environment = environment;
  }

  async initialize(): Promise<void> {
    await this.verify();
  }

  getStatuses(): IntegrationStatus[] {
    return structuredClone(this.statuses);
  }

  isActive(id: IntegrationStatus['id']): boolean {
    return this.statuses.some((item) => item.id === id && item.active);
  }

  async verify(): Promise<IntegrationStatus[]> {
    const [fireworks, openrouter, elevenlabs] = await Promise.all([
      this.verifyFireworks(),
      this.verifyOpenRouter(),
      this.verifyElevenLabs(),
    ]);
    this.statuses = [fireworks, openrouter, elevenlabs];
    return this.getStatuses();
  }

  private async verifyFireworks(): Promise<IntegrationStatus> {
    const key = this.environment.FIREWORKS_API_KEY?.trim();
    if (!key)
      return status(
        'fireworks',
        'Fireworks extraction',
        false,
        false,
        'No credential is configured.',
        'unconfigured',
      );
    const model = this.fireworksModel();
    try {
      const response = await fetch(
        'https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200',
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: withTimeout(10_000),
        },
      );
      if (!response.ok) {
        const message = await responseMessage(response);
        return status(
          'fireworks',
          'Fireworks extraction',
          true,
          false,
          `Credential accepted by the console, but inference is blocked: ${message}`,
          'blocked',
        );
      }
      // A live credential is not enough. A model that is absent from the
      // serverless catalog only fails at inference time with a 404, long after
      // a credential-only probe would have reported "connected".
      const body = (await response.json()) as {
        models?: Array<{ name?: string; supportsImageInput?: boolean }>;
      };
      const catalog = body.models ?? [];
      const entry = catalog.find((item) => item.name === model);
      if (!entry) {
        return status(
          'fireworks',
          'Fireworks extraction',
          true,
          false,
          `Credential is live, but ${model} is not in the serverless catalog of ${catalog.length} models. Set FIREWORKS_VISION_MODEL to a deployed model.`,
          'degraded',
        );
      }
      if (entry.supportsImageInput !== true) {
        return status(
          'fireworks',
          'Fireworks extraction',
          true,
          false,
          `${model} is deployed but does not accept image input, so visual extraction cannot run.`,
          'degraded',
        );
      }
      await this.extractVisual(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAACQklEQVR42u3doVKbURCG4cDgO70IroAbiEAXhavEIXMdkbjKuqpWI9DM9AoqsDiGO8Bl2pCmNPnDnt19PsVkEvO+e77N+SM4eny4n0lcjiEggAAhgAAhgAAhgAAhgAAhgAAhgAAhgAA5bE52+9h8/gm717m7++EEqCAhoP4OqJ3l9enrFxc3v8YVsMPyGTM/vy22Wzm7XE77ZUQFvYn+f71HBR0E/dqb146CE+BbUI/xn7yLjtEP+SwBKij5+G+5MRDgBAgBBAgBBAgB27L/85z9n1E7AU5A2kMwyQNRJ2BHjh5HF0n3H2RuP1+t/v548eE9Z98J+IP+bDZ7+v78zvRbC1ijv3LwN8Rnl8vJ6fetoI30z79+OdCYE/AP9L/Tdw9oRL+XgAHpNxIwJv0uO2D7yiWg4+C3qKDx6VcWkIJ+WQFZ6NfcASOv3OICEg1+wQrKSL+OgKT0i1RQrtIvJSDv4FeooAL0EwuoQT+rgDL0U+6A1Cs3t4BKg5+vgkrSTyOgKv0cAgrTT7ADiq3cTAJqD/7oFdSE/qAC+tAfsYLKl/64AloN/nAV1JP+KALa0h9CQGf68Tug28odSEDzwQ+uIPQjBaAfKQD9yB1g5YYJMPiRFYR+pAD0IytI6YcJMPiRFYR+pAD0gwVsBI1+2D0A+oAdsIKOfuQ9AP1IAeiPchMWAggQAggQAggQAggQAobKNE9D9//P3k6AEECAENAuR48P9yg4AQQIAQQIAQQIAQQIAQQIAQQIAQQIAQTIAfMCkYfUIjtkCKMAAAAASUVORK5CYII=',
          'base64',
        ),
        'image/png',
        'thread-readiness-probe.png',
      );
      return status(
        'fireworks',
        'Fireworks extraction',
        true,
        true,
        `Live schema-validated vision inference passed on ${model}.`,
        'ready',
      );
    } catch (error) {
      return status(
        'fireworks',
        'Fireworks extraction',
        true,
        false,
        `Verification failed: ${error instanceof Error ? error.message : 'network error'}`,
        'degraded',
      );
    }
  }

  private async verifyOpenRouter(): Promise<IntegrationStatus> {
    const key = this.environment.OPENROUTER_API_KEY?.trim();
    if (!key)
      return status(
        'openrouter',
        'OpenRouter reasoning',
        false,
        false,
        'No credential is configured.',
        'unconfigured',
      );
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${key}` },
        signal: withTimeout(10_000),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const models = [this.hypothesisModel(), this.falsifierModel()];
      const probes = await Promise.all(
        models.map(async (model) => {
          const completion = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'http://127.0.0.1:5173',
              'X-Title': 'THREAD readiness',
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: 'user',
                  content: 'Return the readiness object.',
                },
              ],
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'ThreadReadiness',
                  strict: true,
                  schema: {
                    type: 'object',
                    properties: { ready: { type: 'boolean' } },
                    required: ['ready'],
                    additionalProperties: false,
                  },
                },
              },
              provider: { require_parameters: true, allow_fallbacks: true },
              temperature: 0,
              max_tokens: 40,
            }),
            signal: withTimeout(60_000),
          });
          if (!completion.ok) throw new Error(await responseMessage(completion));
          const body = (await completion.json()) as ChatCompletionResponse;
          const content = body.choices?.[0]?.message?.content;
          if (!content) throw new Error(`${model} returned no readiness content.`);
          const parsed = z.object({ ready: z.boolean() }).parse(jsonFromContent(content));
          if (!parsed.ready) throw new Error(`${model} did not affirm readiness.`);
          return body.model ?? model;
        }),
      );
      return status(
        'openrouter',
        'OpenRouter reasoning',
        true,
        true,
        `Live structured inference passed on two model families: ${probes.join(' and ')}.`,
        'ready',
      );
    } catch (error) {
      return status(
        'openrouter',
        'OpenRouter reasoning',
        true,
        false,
        `Verification failed: ${error instanceof Error ? error.message : 'network error'}`,
        'degraded',
      );
    }
  }

  private async verifyElevenLabs(): Promise<IntegrationStatus> {
    const key = this.environment.ELEVENLABS_API_KEY?.trim();
    const agentId = this.environment.ELEVENLABS_AGENT_ID?.trim();
    if (!key || !agentId)
      return status(
        'elevenlabs',
        'ElevenLabs interview',
        Boolean(key),
        false,
        'An API key and agent ID are both required.',
        key ? 'degraded' : 'unconfigured',
      );
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`,
        {
          headers: { 'xi-api-key': key },
          signal: withTimeout(10_000),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as { name?: string };
      const signedUrl = new URL(
        'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url',
      );
      signedUrl.searchParams.set('agent_id', agentId);
      const signedResponse = await fetch(signedUrl, {
        headers: { 'xi-api-key': key },
        signal: withTimeout(10_000),
      });
      if (!signedResponse.ok) throw new Error(await responseMessage(signedResponse));
      const signedBody = (await signedResponse.json()) as { signed_url?: string };
      if (!signedBody.signed_url)
        throw new Error('Signed interview probe returned no URL.');
      return status(
        'elevenlabs',
        'ElevenLabs interview',
        true,
        true,
        `Live agent and signed-session issuance verified: ${body.name ?? agentId}; Scribe v2 remains the ingestion model.`,
        'ready',
      );
    } catch (error) {
      return status(
        'elevenlabs',
        'ElevenLabs interview',
        true,
        false,
        `Verification failed: ${error instanceof Error ? error.message : 'network error'}`,
        'degraded',
      );
    }
  }

  private fireworksModel(): string {
    return (
      this.environment.FIREWORKS_VISION_MODEL?.trim() || 'accounts/fireworks/models/inkling'
    );
  }

  private hypothesisModel(): string {
    return (
      this.environment.OPENROUTER_HYPOTHESIS_MODEL?.trim() ||
      'google/gemma-4-26b-a4b-it:free'
    );
  }

  private falsifierModel(): string {
    return (
      this.environment.OPENROUTER_FALSIFIER_MODEL?.trim() ||
      'nvidia/nemotron-3-super-120b-a12b:free'
    );
  }

  async extractVisual(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<VisualExtraction> {
    const key = this.environment.FIREWORKS_API_KEY?.trim();
    if (!key) throw new Error('Fireworks is not configured.');
    const schema = {
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['visual', 'temporal', 'location', 'identity-signal'],
              },
              text: { type: 'string' },
              locator: { type: 'string' },
              extractionConfidence: { type: 'number' },
              mentionedEntities: { type: 'array', items: { type: 'string' } },
              uncertainty: { type: 'string' },
            },
            required: [
              'kind',
              'text',
              'locator',
              'extractionConfidence',
              'mentionedEntities',
              'uncertainty',
            ],
            additionalProperties: false,
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      required: ['observations', 'warnings'],
      additionalProperties: false,
    };
    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.fireworksModel(),
        temperature: 0,
        // Verbose vision models truncate mid-object at a lower cap, which
        // surfaces as an unhelpful JSON parse failure rather than a refusal.
        max_tokens: 2_400,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'ThreadVisualExtraction', schema },
        },
        messages: [
          {
            role: 'system',
            content:
              'Return JSON only. Produce atomic observations, never a story, identity claim, guilt conclusion, or world fact. Preserve uncertainty and use visible regions as locators.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract typed observations from ${fileName}. Explicitly separate what is visible from any inference.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${buffer.toString('base64')}`,
                },
              },
            ],
          },
        ],
      }),
      signal: withTimeout(90_000),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const body = (await response.json()) as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(body.error?.message || 'Fireworks returned no content.');
    return {
      ...visualExtractionSchema.parse(jsonFromContent(content)),
      model: body.model ?? this.fireworksModel(),
    };
  }

  async transcribe(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    state: CaseState,
  ): Promise<{ text: string; languageCode: string | null; words: unknown[] }> {
    const key = this.environment.ELEVENLABS_API_KEY?.trim();
    if (!key) throw new Error('ElevenLabs is not configured.');
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), fileName);
    form.append('model_id', 'scribe_v2');
    form.append('diarize', 'true');
    form.append('tag_audio_events', 'true');
    form.append('no_verbatim', 'false');
    for (const term of caseKeyterms(state, 1_000, 49)) form.append('keyterms', term);
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
      signal: withTimeout(180_000),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const body = (await response.json()) as {
      text?: string;
      language_code?: string;
      words?: unknown[];
    };
    if (!body.text) throw new Error('ElevenLabs returned no transcript.');
    return {
      text: body.text,
      languageCode: body.language_code ?? null,
      words: body.words ?? [],
    };
  }

  async signedInterviewSession(state: CaseState): Promise<{
    signedUrl: string;
    agentId: string;
    keyterms: string[];
  }> {
    const key = this.environment.ELEVENLABS_API_KEY?.trim();
    const agentId = this.environment.ELEVENLABS_AGENT_ID?.trim();
    if (!key || !agentId) throw new Error('ElevenLabs interview is not configured.');
    const keyterms = caseKeyterms(state, 50, 20);
    const update = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`,
      {
        method: 'PATCH',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_config: { asr: { keywords: keyterms } } }),
        signal: withTimeout(15_000),
      },
    );
    if (!update.ok) throw new Error(await responseMessage(update));
    const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url');
    url.searchParams.set('agent_id', agentId);
    url.searchParams.set('include_conversation_id', 'true');
    const response = await fetch(url, {
      headers: { 'xi-api-key': key },
      signal: withTimeout(15_000),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const body = (await response.json()) as { signed_url?: string };
    if (!body.signed_url) throw new Error('ElevenLabs returned no signed URL.');
    return { signedUrl: body.signed_url, agentId, keyterms };
  }

  private async openRouterJson<T>(
    model: string,
    prompt: string,
    schemaName: string,
    schema: object,
    validator: z.ZodType<T>,
  ): Promise<{ value: T; model: string }> {
    const key = this.environment.OPENROUTER_API_KEY?.trim();
    if (!key) throw new Error('OpenRouter is not configured.');
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://127.0.0.1:5173',
            'X-Title': 'THREAD',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'You are an evidence-audit component. Use only supplied IDs and facts. Never assign guilt, invent evidence, or collapse uncertainty. Obey the response schema exactly and return JSON only.',
              },
              {
                role: 'user',
                content:
                  attempt === 1
                    ? prompt
                    : `${prompt}\n\nYour prior response was rejected by schema validation. Correct exactly these problems and return every required field, without renaming any of them: ${repairHint(lastError)}`,
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: schemaName, strict: true, schema },
            },
            provider: { require_parameters: true, allow_fallbacks: true },
            reasoning: { effort: 'low' },
            temperature: 0,
            max_tokens: 1_200,
          }),
          signal: withTimeout(120_000),
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        const body = (await response.json()) as ChatCompletionResponse;
        const content = body.choices?.[0]?.message?.content;
        if (!content)
          throw new Error(body.error?.message || `${model} returned no content.`);
        return {
          value: validator.parse(jsonFromContent(content)),
          model: body.model ?? model,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `${model} failed structured review: ${lastError instanceof Error ? lastError.message : 'unknown response error'}`,
    );
  }

  async adversarialReview(
    state: CaseState,
    packet: CasePacket,
  ): Promise<{
    hypothesis: HypothesisReview;
    falsifier: FalsifierReview;
    hypothesisModel: string;
    falsifierModel: string;
  }> {
    const packetObservations = state.observations
      .filter((observation) => packet.observationIds.includes(observation.id))
      .map((observation) => ({
        id: observation.id,
        text: observation.text,
        extractionConfidence: observation.extractionConfidence,
        materialWeight: observation.materialWeight,
      }));
    const compact = {
      question: packet.question,
      retrievalMethod: packet.retrievalMethod,
      observations: packetObservations,
      reconstructions: state.reconstructions.map((reconstruction) => ({
        id: reconstruction.id,
        summary: reconstruction.summary,
        // Without this the model has to infer the leading account from coverage
        // numbers, and it reliably mislabels which one it is attacking.
        isLeading: reconstruction.isLeading,
        coveragePercent: reconstruction.coveragePercent,
        contradictions: reconstruction.contradictions,
        requiredAssumptionIds: reconstruction.requiredAssumptionIds,
      })),
      assumptions: state.assumptions.map((assumption) => ({
        id: assumption.id,
        detail: assumption.detail,
        status: assumption.status,
      })),
    };
    const hypothesisModel = this.hypothesisModel();
    const falsifierModel = this.falsifierModel();
    // Bind the model to the reconstructions that actually exist. A prompt-only
    // instruction lets a model invent the plausible-looking gap in R-A / R-C.
    const reconstructionIds = state.reconstructions.map((item) => item.id);
    // Every constraint Zod enforces is declared here too. A schema that omits
    // them invites a short answer the provider accepts and validation rejects.
    const hypothesisSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string', minLength: 40 },
        leading_reconstruction_id: { type: 'string', enum: reconstructionIds },
        diagnostic_evidence_ids: { type: 'array', items: { type: 'string' } },
        unresolved_assumptions: { type: 'array', items: { type: 'string' } },
        next_question: { type: 'string', minLength: 15 },
      },
      required: [
        'summary',
        'leading_reconstruction_id',
        'diagnostic_evidence_ids',
        'unresolved_assumptions',
        'next_question',
      ],
      additionalProperties: false,
    };
    const falsifierSchema = {
      type: 'object',
      properties: {
        strongest_counterargument: { type: 'string', minLength: 40 },
        contradicting_ids: { type: 'array', items: { type: 'string' } },
        alternative_reconstruction_id: { type: 'string', enum: reconstructionIds },
        stop_believing_if: { type: 'string', minLength: 25 },
      },
      required: [
        'strongest_counterargument',
        'contradicting_ids',
        'alternative_reconstruction_id',
        'stop_believing_if',
      ],
      additionalProperties: false,
    };
    const allowedReconstructions = reconstructionIds.join(', ');
    const [hypothesisResult, falsifierResult] = await Promise.all([
      this.openRouterJson(
        hypothesisModel,
        `Evaluate explanatory coverage without adding facts. Select reconstruction IDs only from: ${allowedReconstructions}. Case packet:\n${JSON.stringify(compact)}`,
        'ThreadHypothesisReview',
        hypothesisSchema,
        hypothesisReviewSchema,
      ),
      this.openRouterJson(
        falsifierModel,
        `Attack the leading account and identify its most diagnostic weakness. Select reconstruction IDs only from: ${allowedReconstructions}. Case packet:\n${JSON.stringify(compact)}`,
        'ThreadFalsifierReview',
        falsifierSchema,
        falsifierReviewSchema,
      ),
    ]);
    return {
      hypothesis: hypothesisResult.value,
      falsifier: falsifierResult.value,
      hypothesisModel: hypothesisResult.model,
      falsifierModel: falsifierResult.model,
    };
  }
}
