import type {
  Claim,
  Entity,
  EntityKind,
  Observation,
  ResolutionSignal,
  UnresolvedReference,
} from './types.js';

/**
 * Derivation layer.
 *
 * `reasoning.ts` mutates case state and `deduction.ts` only reads it. This
 * module sits between them: it takes records that already carry provenance and
 * proposes the structures a case needs — mentions, entities, relationships,
 * contradictions, explanations — without persisting or mutating anything.
 *
 * The discipline that matters here is restraint. An empty case must derive an
 * empty graph and a thin case must derive a visibly thin one. Producing a
 * confident-looking structure the evidence does not carry is a worse failure
 * than producing nothing.
 */

export type MentionChannel =
  | 'speaker'
  | 'lexical'
  | 'identifier'
  | 'locative'
  | 'vague';

/**
 * A thing a record *said*, before anything decides whether it names a
 * participant. Several mentions may turn out to be one entity, or none.
 */
export interface EntityMention {
  id: string;
  surfaceForm: string;
  /** Case-folded form used for clustering; never shown in place of the original. */
  normalized: string;
  /** Distribution over `EntityKind` values plus `unknown`; sums to 1. */
  kindProbabilities: Record<string, number>;
  sourceEvidenceId: string;
  sourceRecordId: string;
  recordType: 'observation' | 'claim';
  locator: string;
  channel: MentionChannel;
  confidence: number;
  /** True when the surface form is a hole in the record rather than a name. */
  vague: boolean;
  context: string;
}

function round(value: number, places = 3): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeDistribution(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return { unknown: 1 };
  return Object.fromEntries(
    Object.entries(weights).map(([kind, weight]) => [kind, round(weight / total)]),
  );
}

/**
 * Surface forms that stand in for something the record never identifies. They
 * are extracted so the gap is visible, and are never promoted to entities.
 */
const VAGUE_SURFACE_FORMS = [
  'someone',
  'somebody',
  'unknown person',
  'the thing',
  'the package',
  'the item',
  'there',
  'that place',
  'the other one',
] as const;

/** Capitalized words that open sentences without naming anything. */
const LEXICAL_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'i',
  'we',
  'he',
  'she',
  'they',
  'it',
  'this',
  'that',
  'these',
  'those',
  'later',
  'earlier',
  'then',
  'after',
  'before',
  'during',
  'when',
  'while',
  'because',
  'however',
  'meanwhile',
  'afterwards',
  'yesterday',
  'today',
  'tomorrow',
  'tonight',
  'my',
  'his',
  'her',
  'their',
  'our',
  'its',
  'no',
  'yes',
  'not',
  'and',
  'but',
  'so',
  'if',
  'as',
  'at',
  'in',
  'on',
  'by',
  'to',
  'from',
]);

/** Tokens that may sit inside a name run without breaking it. */
const RUN_CONNECTORS = new Set(['of', 'the', 'and', 'de', 'da', 'van', 'von', 'der', 'del']);

const ORGANIZATION_SUFFIXES = new Set([
  'ltd',
  'llc',
  'inc',
  'corp',
  'corporation',
  'company',
  'co',
  'gmbh',
  'plc',
  'group',
  'holdings',
  'partners',
  'associates',
  'department',
  'bureau',
  'agency',
  'authority',
  'university',
  'college',
  'hospital',
  'bank',
  'logistics',
  'freight',
  'shipping',
  'security',
  'services',
]);

const LOCATIVE_PREPOSITIONS = new Set([
  'at',
  'in',
  'near',
  'outside',
  'inside',
  'toward',
  'towards',
  'past',
  'behind',
]);

const PLACE_HEAD_WORDS = new Set([
  'pier',
  'warehouse',
  'dock',
  'gate',
  'terminal',
  'street',
  'avenue',
  'road',
  'lane',
  'building',
  'lot',
  'yard',
  'bay',
  'harbor',
  'harbour',
  'port',
  'station',
  'airport',
  'bridge',
  'tunnel',
  'park',
  'plaza',
  'unit',
  'suite',
  'room',
  'floor',
]);

interface ExtractedToken {
  raw: string;
  word: string;
  start: number;
  endsSentence: boolean;
  startsSentence: boolean;
}

function tokenize(text: string): ExtractedToken[] {
  const tokens: ExtractedToken[] = [];
  let startsSentence = true;
  for (const match of text.matchAll(/\S+/gu)) {
    const raw = match[0];
    const start = match.index;
    const word = raw.replace(/^[^\p{L}\p{N}@]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '');
    // A trailing period is sentence punctuation unless it is an initial or an
    // abbreviation the run builder will strip anyway.
    const endsSentence = /[.!?]["')\]]?$/u.test(raw);
    tokens.push({
      raw,
      word: word.replace(/\.$/u, ''),
      start,
      endsSentence,
      startsSentence,
    });
    startsSentence = endsSentence;
  }
  return tokens;
}

function isCapitalized(word: string): boolean {
  return /^\p{Lu}[\p{L}'’-]*$/u.test(word) || /^\p{Lu}{2,}$/u.test(word);
}

function isNumericToken(word: string): boolean {
  return /^\d+$/u.test(word);
}

interface MentionDraft {
  surfaceForm: string;
  start: number;
  channel: MentionChannel;
  kindWeights: Record<string, number>;
  confidence: number;
  vague: boolean;
}

const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gu;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,16}\d/gu;
const HANDLE_PATTERN = /(?<![\p{L}\p{N}])@[\p{L}\p{N}_]{2,30}/gu;
/** Mixed letters and digits, all caps, of plate/badge/serial length. */
const CODE_PATTERN = /(?<![\p{L}\p{N}-])(?=[A-Z0-9]{5,10}(?![\p{L}\p{N}]))(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,10}/gu;

function identifierDrafts(text: string): MentionDraft[] {
  const drafts: MentionDraft[] = [];
  const push = (
    surfaceForm: string,
    start: number,
    kindWeights: Record<string, number>,
    confidence: number,
  ) => {
    drafts.push({ surfaceForm, start, channel: 'identifier', kindWeights, confidence, vague: false });
  };

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    push(match[0], match.index, { account: 0.7, identity: 0.2, person: 0.1 }, 0.9);
  }
  for (const match of text.matchAll(URL_PATTERN)) {
    push(match[0], match.index, { account: 0.4, object: 0.4, organization: 0.2 }, 0.85);
  }
  for (const match of text.matchAll(HANDLE_PATTERN)) {
    push(match[0], match.index, { account: 0.65, identity: 0.25, person: 0.1 }, 0.85);
  }
  for (const match of text.matchAll(PHONE_PATTERN)) {
    const digits = match[0].replace(/\D/gu, '');
    if (digits.length < 9 || digits.length > 15) continue;
    push(match[0].trim(), match.index, { account: 0.5, device: 0.3, identity: 0.2 }, 0.8);
  }
  for (const match of text.matchAll(CODE_PATTERN)) {
    push(match[0], match.index, { vehicle: 0.5, object: 0.3, device: 0.2 }, 0.75);
  }
  return drafts;
}

function vagueDrafts(text: string): MentionDraft[] {
  const drafts: MentionDraft[] = [];
  const lowered = text.toLocaleLowerCase();
  for (const surface of VAGUE_SURFACE_FORMS) {
    const pattern = new RegExp(`\\b${surface.replaceAll(' ', '\\s+')}\\b`, 'gu');
    for (const match of lowered.matchAll(pattern)) {
      drafts.push({
        surfaceForm: surface,
        start: match.index,
        channel: 'vague',
        kindWeights: { unknown: 1 },
        confidence: 0.3,
        vague: true,
      });
    }
  }
  return drafts;
}

function lexicalDrafts(text: string): MentionDraft[] {
  const tokens = tokenize(text);
  const drafts: MentionDraft[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || !isCapitalized(token.word)) {
      index += 1;
      continue;
    }

    const runTokens: ExtractedToken[] = [token];
    let cursor = index + 1;
    let brokeAtSentenceEnd = token.endsSentence;
    while (!brokeAtSentenceEnd && cursor < tokens.length) {
      const next = tokens[cursor];
      if (!next) break;
      const following = tokens[cursor + 1];
      const isConnector =
        RUN_CONNECTORS.has(next.word.toLocaleLowerCase()) &&
        following !== undefined &&
        isCapitalized(following.word);
      if (isCapitalized(next.word) || isNumericToken(next.word) || isConnector) {
        runTokens.push(next);
        brokeAtSentenceEnd = next.endsSentence;
        cursor += 1;
        continue;
      }
      break;
    }
    // A run that ends on a connector or bare number is trimmed back to its name.
    while (runTokens.length > 1) {
      const last = runTokens.at(-1);
      if (!last) break;
      if (RUN_CONNECTORS.has(last.word.toLocaleLowerCase())) {
        runTokens.pop();
        continue;
      }
      break;
    }

    const surfaceForm = runTokens.map((item) => item.word).join(' ');
    const lowered = surfaceForm.toLocaleLowerCase();
    const singleToken = runTokens.length === 1;
    const rejected =
      surfaceForm.length === 0 ||
      (VAGUE_SURFACE_FORMS as readonly string[]).includes(lowered) ||
      (singleToken && (token.startsSentence || LEXICAL_STOPWORDS.has(lowered)));

    if (!rejected) {
      const previous = index > 0 ? tokens[index - 1] : undefined;
      const locative =
        previous !== undefined &&
        LOCATIVE_PREPOSITIONS.has(previous.word.toLocaleLowerCase());
      const words = lowered.split(' ');
      const hasOrganizationSuffix = words.some((word) => ORGANIZATION_SUFFIXES.has(word));
      const hasPlaceHead = words.some((word) => PLACE_HEAD_WORDS.has(word));
      const trailingNumber = runTokens.some((item) => isNumericToken(item.word));

      let kindWeights: Record<string, number>;
      if (hasOrganizationSuffix) {
        kindWeights = { organization: 0.7, location: 0.15, person: 0.1, unknown: 0.05 };
      } else if (hasPlaceHead || (locative && trailingNumber)) {
        // Every considered kind stays in the distribution. Dropping one would
        // read downstream as "never evaluated" rather than "evaluated as low".
        kindWeights = {
          location: 0.62,
          organization: 0.15,
          object: 0.08,
          person: 0.1,
          unknown: 0.05,
        };
      } else if (locative) {
        kindWeights = { location: 0.5, organization: 0.25, person: 0.15, unknown: 0.1 };
      } else if (trailingNumber) {
        kindWeights = {
          object: 0.38,
          location: 0.28,
          vehicle: 0.14,
          person: 0.08,
          unknown: 0.12,
        };
      } else {
        kindWeights = { person: 0.6, organization: 0.2, location: 0.15, unknown: 0.05 };
      }

      drafts.push({
        surfaceForm,
        start: token.start,
        channel: locative ? 'locative' : 'lexical',
        kindWeights,
        confidence: singleToken ? 0.5 : 0.7,
        vague: false,
      });
    }

    index = Math.max(cursor, index + 1);
  }

  return drafts;
}

function draftsToMentions(
  drafts: MentionDraft[],
  source: {
    recordId: string;
    recordType: 'observation' | 'claim';
    evidenceId: string;
    locator: string;
    context: string;
  },
): EntityMention[] {
  // Longer surface forms win an overlapping span, so "Harbor Freight Ltd" is not
  // shadowed by a bare "Harbor".
  const ordered = [...drafts].sort(
    (left, right) =>
      left.start - right.start || right.surfaceForm.length - left.surfaceForm.length,
  );
  const kept: MentionDraft[] = [];
  for (const draft of ordered) {
    const end = draft.start + draft.surfaceForm.length;
    const overlaps = kept.some((existing) => {
      const existingEnd = existing.start + existing.surfaceForm.length;
      return draft.start < existingEnd && existing.start < end;
    });
    if (!overlaps) kept.push(draft);
  }

  return kept.map((draft, index) => ({
    id: `MEN-${source.recordId}-${index + 1}`,
    surfaceForm: draft.surfaceForm,
    normalized: draft.surfaceForm.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
    kindProbabilities: normalizeDistribution(draft.kindWeights),
    sourceEvidenceId: source.evidenceId,
    sourceRecordId: source.recordId,
    recordType: source.recordType,
    locator: source.locator,
    channel: draft.channel,
    confidence: draft.confidence,
    vague: draft.vague,
    context: source.context,
  }));
}

/**
 * Surface forms mentioned by observations and claims, each bound to the exact
 * record and locator that produced it.
 */
export function extractEntityMentions(
  observations: readonly Observation[],
  claims: readonly Claim[],
): EntityMention[] {
  const mentions: EntityMention[] = [];

  for (const observation of observations) {
    const text = observation.text ?? '';
    mentions.push(
      ...draftsToMentions(
        [...identifierDrafts(text), ...lexicalDrafts(text), ...vagueDrafts(text)],
        {
          recordId: observation.id,
          recordType: 'observation',
          evidenceId: observation.sourceEvidenceId,
          locator: observation.locator || 'unlocated observation',
          context: text.slice(0, 240),
        },
      ),
    );
  }

  for (const claim of claims) {
    const text = claim.verbatim ?? '';
    const drafts = [
      ...identifierDrafts(text),
      ...lexicalDrafts(text),
      ...vagueDrafts(text),
    ];
    const speaker = claim.speaker?.trim();
    if (speaker) {
      // The speaker is attached ahead of the quoted span so it sorts first and
      // never loses an overlap contest with text inside the quotation.
      drafts.unshift({
        surfaceForm: speaker,
        start: -1,
        channel: 'speaker',
        kindWeights: { person: 0.85, organization: 0.1, identity: 0.05 },
        confidence: 0.9,
        vague: false,
      });
    }
    mentions.push(
      ...draftsToMentions(drafts, {
        recordId: claim.id,
        recordType: 'claim',
        evidenceId: claim.sourceEvidenceId,
        locator: `quoted claim ${claim.id}`,
        context: text.slice(0, 240),
      }),
    );
  }

  return mentions;
}

export interface ResolutionOptions {
  caseId: string;
  /** Open-world mass reserved for a person the case has not met yet. */
  openWorldWeight?: number;
}

export interface ResolutionResult {
  entities: Entity[];
  references: UnresolvedReference[];
}

const KNOWN_ENTITY_KINDS: EntityKind[] = [
  'person',
  'organization',
  'identity',
  'account',
  'device',
  'vehicle',
  'location',
  'object',
  'event',
  'time-interval',
];

function slug(value: string): string {
  return (
    value
      .toLocaleUpperCase()
      .replace(/[^A-Z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40) || 'UNNAMED'
  );
}

function uniqueId(prefix: string, base: string, used: Set<string>): string {
  const candidate = `${prefix}-${base}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  const resolved = `${candidate}-${suffix}`;
  used.add(resolved);
  return resolved;
}

function tokensOf(normalized: string): string[] {
  return normalized.split(/\s+/u).filter(Boolean);
}

/** A proper-subset name is a partial reference, not a smaller copy of a person. */
function isPartialOf(shorter: string, longer: string): boolean {
  const shortTokens = tokensOf(shorter);
  const longTokens = new Set(tokensOf(longer));
  if (shortTokens.length === 0 || shortTokens.length >= tokensOf(longer).length) {
    return false;
  }
  return shortTokens.every((token) => longTokens.has(token));
}

function aggregateKind(mentions: readonly EntityMention[]): EntityKind {
  const totals = new Map<string, number>();
  for (const mention of mentions) {
    for (const [kind, probability] of Object.entries(mention.kindProbabilities)) {
      totals.set(kind, (totals.get(kind) ?? 0) + probability * mention.confidence);
    }
  }
  let best: EntityKind = 'object';
  let bestScore = -1;
  for (const kind of KNOWN_ENTITY_KINDS) {
    const score = totals.get(kind) ?? 0;
    if (score > bestScore) {
      best = kind;
      bestScore = score;
    }
  }
  return best;
}

function aggregateKindProbabilities(
  mentions: readonly EntityMention[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const mention of mentions) {
    for (const [kind, probability] of Object.entries(mention.kindProbabilities)) {
      totals[kind] = (totals[kind] ?? 0) + probability;
    }
  }
  return normalizeDistribution(totals);
}

/** Preferred display form: the most attested surface form, longest breaking ties. */
function preferredLabel(mentions: readonly EntityMention[]): string {
  const counts = new Map<string, number>();
  for (const mention of mentions) {
    counts.set(mention.surfaceForm, (counts.get(mention.surfaceForm) ?? 0) + 1);
  }
  let label = mentions[0]?.surfaceForm ?? '';
  let bestCount = -1;
  for (const [surfaceForm, count] of counts) {
    if (count > bestCount || (count === bestCount && surfaceForm.length > label.length)) {
      label = surfaceForm;
      bestCount = count;
    }
  }
  return label;
}

interface MentionGroup {
  normalized: string;
  mentions: EntityMention[];
}

function groupMentions(mentions: readonly EntityMention[]): MentionGroup[] {
  const groups = new Map<string, MentionGroup>();
  for (const mention of mentions) {
    const existing = groups.get(mention.normalized);
    if (existing) {
      existing.mentions.push(mention);
      continue;
    }
    groups.set(mention.normalized, { normalized: mention.normalized, mentions: [mention] });
  }
  return [...groups.values()];
}

function distinctEvidenceIds(mentions: readonly EntityMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.sourceEvidenceId))];
}

/**
 * Corroboration across independent artifacts is the only thing that raises an
 * entity's standing. Repeating a name inside one artifact does not.
 */
function entityConfidence(mentions: readonly EntityMention[]): number {
  const mean =
    mentions.reduce((sum, mention) => sum + mention.confidence, 0) / mentions.length;
  const artifacts = distinctEvidenceIds(mentions).length;
  return round(Math.min(0.95, mean * (1 - 0.5 ** artifacts)), 2);
}

/**
 * Turns mentions into entities and unresolved references.
 *
 * Two rules are load-bearing. A vague surface form never becomes an entity, and
 * a partial name that could fit an existing fuller name stays an
 * `UnresolvedReference` with scored candidate bindings rather than being merged
 * into it.
 */
export function resolveEntities(
  mentions: readonly EntityMention[],
  existing: readonly Entity[],
  options: ResolutionOptions,
): ResolutionResult {
  const openWorldWeight = options.openWorldWeight ?? 0.25;
  const usedEntityIds = new Set(existing.map((item) => item.id));
  const usedReferenceIds = new Set<string>();

  const vagueGroups = groupMentions(mentions.filter((mention) => mention.vague));
  const namedGroups = groupMentions(mentions.filter((mention) => !mention.vague));

  const existingByNormalized = new Map<string, Entity>();
  for (const item of existing) {
    existingByNormalized.set(item.label.toLocaleLowerCase(), item);
    for (const alias of item.aliases) {
      existingByNormalized.set(alias.toLocaleLowerCase(), item);
    }
  }

  // Fuller names are the resolution targets a partial can bind to.
  const fullerNormalizedForms = [
    ...new Set([
      ...namedGroups.map((group) => group.normalized),
      ...existingByNormalized.keys(),
    ]),
  ];

  const entities: Entity[] = existing.map((item) => structuredClone(item));
  const entityById = new Map(entities.map((item) => [item.id, item]));
  const derivedByNormalized = new Map<string, Entity>();
  const references: UnresolvedReference[] = [];
  const partialGroups: Array<{ group: MentionGroup; targets: string[] }> = [];

  for (const group of namedGroups) {
    const targets = fullerNormalizedForms.filter((candidate) =>
      isPartialOf(group.normalized, candidate),
    );
    if (targets.length > 0) {
      partialGroups.push({ group, targets });
      continue;
    }

    const attached = existingByNormalized.get(group.normalized);
    if (attached) {
      const record = entityById.get(attached.id);
      if (record) {
        record.sourceEvidenceIds = [
          ...new Set([...record.sourceEvidenceIds, ...distinctEvidenceIds(group.mentions)]),
        ];
        record.properties = {
          ...record.properties,
          mentionIds: [
            ...new Set([
              ...(record.properties.mentionIds ?? []),
              ...group.mentions.map((mention) => mention.id),
            ]),
          ],
        };
        derivedByNormalized.set(group.normalized, record);
      }
      continue;
    }

    const label = preferredLabel(group.mentions);
    const entity: Entity = {
      id: uniqueId('E', slug(group.normalized), usedEntityIds),
      caseId: options.caseId,
      kind: aggregateKind(group.mentions),
      label,
      shortLabel: tokensOf(label).length > 1 ? (label.split(' ')[0] ?? label) : label,
      description: `Derived from ${group.mentions.length} mention${group.mentions.length === 1 ? '' : 's'} across ${distinctEvidenceIds(group.mentions).length} artifact${distinctEvidenceIds(group.mentions).length === 1 ? '' : 's'}.`,
      aliases: [
        ...new Set(
          group.mentions
            .map((mention) => mention.surfaceForm)
            .filter((surfaceForm) => surfaceForm !== label),
        ),
      ],
      properties: {
        mentionIds: group.mentions.map((mention) => mention.id),
        channels: [...new Set(group.mentions.map((mention) => mention.channel))],
      },
      confidence: entityConfidence(group.mentions),
      sourceEvidenceIds: distinctEvidenceIds(group.mentions),
      interval: null,
    };
    entities.push(entity);
    entityById.set(entity.id, entity);
    derivedByNormalized.set(group.normalized, entity);
  }

  const resolveTargetEntity = (normalized: string): Entity | undefined =>
    derivedByNormalized.get(normalized) ?? existingByNormalized.get(normalized);

  for (const { group, targets } of partialGroups) {
    const candidates = targets
      .map((normalized) => resolveTargetEntity(normalized))
      .filter((item): item is Entity => item !== undefined);
    const weights = candidates.map((candidate) => Math.max(candidate.confidence, 0.05));
    const total = weights.reduce((sum, weight) => sum + weight, 0) + openWorldWeight;
    const signals: ResolutionSignal[] = candidates.map((candidate, index) => ({
      id: `RS-${group.normalized.replace(/\s+/gu, '-')}-${index + 1}`,
      candidateEntityId: candidate.id,
      evidenceId: group.mentions[0]?.sourceEvidenceId ?? '',
      channel: 'lexical',
      label: `“${group.mentions[0]?.surfaceForm ?? group.normalized}” is a name fragment of ${candidate.label}`,
      weight: round(Math.max(candidate.confidence, 0.05), 2),
    }));

    references.push({
      id: uniqueId('U', slug(group.normalized), usedReferenceIds),
      caseId: options.caseId,
      surfaceForm: group.mentions[0]?.surfaceForm ?? group.normalized,
      context: group.mentions[0]?.context ?? '',
      kindProbabilities: aggregateKindProbabilities(group.mentions),
      candidateBindings: [
        ...candidates.map((candidate, index) => ({
          entityId: candidate.id,
          label: candidate.label,
          probability: round((weights[index] ?? 0) / total, 2),
          prior: round((weights[index] ?? 0) / total, 2),
          signalIds: signals[index] ? [signals[index].id] : [],
        })),
        {
          entityId: null,
          // The case is open: the fragment may name someone never mentioned.
          label: 'Someone not yet named in this case',
          probability: round(openWorldWeight / total, 2),
          prior: round(openWorldWeight / total, 2),
          signalIds: [],
        },
      ],
      resolutionSignals: signals,
      status: candidates.length > 0 ? 'candidate' : 'open',
      resolvedBy: null,
      sourceEvidenceIds: distinctEvidenceIds(group.mentions),
    });
  }

  for (const group of vagueGroups) {
    references.push({
      id: uniqueId('U', slug(group.normalized), usedReferenceIds),
      caseId: options.caseId,
      surfaceForm: group.mentions[0]?.surfaceForm ?? group.normalized,
      context: group.mentions[0]?.context ?? '',
      kindProbabilities: aggregateKindProbabilities(group.mentions),
      candidateBindings: [
        {
          entityId: null,
          label: 'Never identified by any artifact',
          probability: 1,
          prior: 1,
          signalIds: [],
        },
      ],
      resolutionSignals: [],
      status: 'open',
      resolvedBy: null,
      sourceEvidenceIds: distinctEvidenceIds(group.mentions),
    });
  }

  return { entities, references };
}
