import { admiraltyStrength, allenRelation } from './reasoning.js';
import type {
  Assumption,
  Belief,
  CaseState,
  Claim,
  EdgeContribution,
  Entity,
  EntityKind,
  LensId,
  Observation,
  ResolutionSignal,
  UnresolvedReference,
  WorldEdge,
  WorldPredicate,
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

/**
 * How far a derived relationship sits from what a record literally says. Both
 * leaps are real, so both become assumptions an investigator can attack.
 */
const LEAPS = {
  'co-presence': {
    id: 'A-LEAP-CO-PRESENCE',
    label: 'Things named in one observation were actually together',
    detail:
      'A single observation naming two participants is read as placing them in contact. The observation may instead be listing them, comparing them, or describing them at different moments.',
    discount: 0.85,
  },
  testimony: {
    id: 'A-LEAP-TESTIMONY',
    label: 'The speaker described this relationship accurately',
    detail:
      'The relationship is carried by what someone said rather than by anything recorded. It fails if the speaker was mistaken, hedging, repeating hearsay, or lying.',
    discount: 0.6,
  },
} as const;

type LeapKind = keyof typeof LEAPS;

/** Agent-like kinds sort first so an asymmetric predicate gets a stable subject. */
const KIND_RANK: Record<EntityKind, number> = {
  person: 0,
  organization: 1,
  identity: 2,
  vehicle: 3,
  device: 4,
  account: 5,
  object: 6,
  location: 7,
  event: 8,
  'time-interval': 9,
};

const PLACE_KINDS = new Set<EntityKind>(['location']);
const THING_KINDS = new Set<EntityKind>(['object', 'vehicle', 'device', 'account']);

function predicateFor(subject: EntityKind, object: EntityKind): WorldPredicate {
  if (PLACE_KINDS.has(object) && !PLACE_KINDS.has(subject)) return 'OBSERVED_AT';
  if (subject === 'person' && object === 'person') return 'MET_WITH';
  if (subject === 'person' && THING_KINDS.has(object)) return 'USES';
  if (subject === 'person' && object === 'organization') return 'PARTICIPATED_IN';
  if (subject === 'person' && object === 'event') return 'PARTICIPATED_IN';
  return 'INVOLVES';
}

function lensesFor(kinds: readonly EntityKind[]): LensId[] {
  const lenses = new Set<LensId>(['theory']);
  for (const kind of kinds) {
    if (kind === 'person' || kind === 'organization' || kind === 'identity') {
      lenses.add('people');
    }
    if (PLACE_KINDS.has(kind)) lenses.add('place');
    if (THING_KINDS.has(kind)) lenses.add('objects');
    if (kind === 'event' || kind === 'time-interval') lenses.add('time');
  }
  return [...lenses];
}

export interface WorldEdgeDerivationInput {
  caseId: string;
  observations: readonly Observation[];
  claims: readonly Claim[];
  entities: readonly Entity[];
  mentions: readonly EntityMention[];
  timestamp?: string;
}

export interface WorldEdgeDerivationResult {
  edges: WorldEdge[];
  assumptions: Assumption[];
}

interface EdgeAccumulator {
  subject: Entity;
  object: Entity;
  predicate: WorldPredicate;
  observationIds: string[];
  claimIds: string[];
  contributions: EdgeContribution[];
  leaps: Set<LeapKind>;
  supports: number[];
  validTime: WorldEdge['validTime'];
  evidenceIds: Set<string>;
}

/**
 * Relationships implied by two entities appearing in the same record.
 *
 * Nothing here promotes a claim to a world fact silently: an edge read from
 * testimony is scored through its Admiralty rating, discounted for the leap,
 * and bound to the assumption that the speaker was accurate.
 */
export function deriveWorldEdges(
  input: WorldEdgeDerivationInput,
): WorldEdgeDerivationResult {
  const transactionTime = input.timestamp ?? new Date().toISOString();
  const entityByNormalized = new Map<string, Entity>();
  for (const entity of input.entities) {
    entityByNormalized.set(entity.label.toLocaleLowerCase(), entity);
    for (const alias of entity.aliases) {
      entityByNormalized.set(alias.toLocaleLowerCase(), entity);
    }
  }

  const observationById = new Map(input.observations.map((item) => [item.id, item]));
  const claimById = new Map(input.claims.map((item) => [item.id, item]));

  const mentionsByRecord = new Map<string, EntityMention[]>();
  for (const mention of input.mentions) {
    if (mention.vague) continue;
    const bucket = mentionsByRecord.get(mention.sourceRecordId);
    if (bucket) bucket.push(mention);
    else mentionsByRecord.set(mention.sourceRecordId, [mention]);
  }

  const accumulators = new Map<string, EdgeAccumulator>();
  const recordOrder = [
    ...input.observations.map((item) => item.id),
    ...input.claims.map((item) => item.id),
  ];

  for (const recordId of recordOrder) {
    const recordMentions = mentionsByRecord.get(recordId) ?? [];
    const observation = observationById.get(recordId);
    const claim = claimById.get(recordId);
    if (!observation && !claim) continue;

    const resolved: Array<{ entity: Entity; mention: EntityMention }> = [];
    const seen = new Set<string>();
    for (const mention of recordMentions) {
      const entity = entityByNormalized.get(mention.normalized);
      if (!entity || seen.has(entity.id)) continue;
      seen.add(entity.id);
      resolved.push({ entity, mention });
    }

    const leap: LeapKind = observation ? 'co-presence' : 'testimony';
    const base = observation
      ? observation.extractionConfidence
      : admiraltyStrength(
          claim?.sourceReliability ?? 'F',
          claim?.informationCredibility ?? 6,
        ).combinedStrength;

    for (let left = 0; left < resolved.length; left += 1) {
      for (let right = left + 1; right < resolved.length; right += 1) {
        const a = resolved[left];
        const b = resolved[right];
        if (!a || !b) continue;
        if (a.entity.id === b.entity.id) continue;

        const aRank = KIND_RANK[a.entity.kind];
        const bRank = KIND_RANK[b.entity.kind];
        const [subjectSide, objectSide] =
          aRank < bRank || (aRank === bRank && a.entity.id <= b.entity.id)
            ? [a, b]
            : [b, a];
        const predicate = predicateFor(subjectSide.entity.kind, objectSide.entity.kind);
        const key = `${subjectSide.entity.id}|${predicate}|${objectSide.entity.id}`;

        const support = round(
          base *
            a.mention.confidence *
            b.mention.confidence *
            subjectSide.entity.confidence *
            objectSide.entity.confidence *
            LEAPS[leap].discount,
          4,
        );

        const existing = accumulators.get(key);
        const accumulator: EdgeAccumulator = existing ?? {
          subject: subjectSide.entity,
          object: objectSide.entity,
          predicate,
          observationIds: [],
          claimIds: [],
          contributions: [],
          leaps: new Set<LeapKind>(),
          supports: [],
          validTime: null,
          evidenceIds: new Set<string>(),
        };

        if (observation) {
          if (!accumulator.observationIds.includes(observation.id)) {
            accumulator.observationIds.push(observation.id);
          }
          // Time is copied from the record, never synthesized for the edge.
          if (!accumulator.validTime && observation.interval) {
            accumulator.validTime = structuredClone(observation.interval);
          }
          accumulator.evidenceIds.add(observation.sourceEvidenceId);
        } else if (claim) {
          if (!accumulator.claimIds.includes(claim.id)) {
            accumulator.claimIds.push(claim.id);
          }
          if (!accumulator.validTime && claim.interval) {
            accumulator.validTime = structuredClone(claim.interval);
          }
          accumulator.evidenceIds.add(claim.sourceEvidenceId);
        }
        accumulator.leaps.add(leap);
        accumulator.supports.push(support);
        accumulator.contributions.push({
          sourceId: recordId,
          label: observation
            ? `${subjectSide.entity.label} and ${objectSide.entity.label} appear in the same observation`
            : `${claim?.speaker ?? 'The artifact'} relates ${subjectSide.entity.label} to ${objectSide.entity.label}`,
          weight: support,
          polarity: 'support',
        });
        accumulators.set(key, accumulator);
      }
    }
  }

  const assumptionUsage = new Map<LeapKind, Set<string>>();
  const edges: WorldEdge[] = [];

  for (const accumulator of accumulators.values()) {
    // Independent supports combine as a noisy-OR: two weak sources are worth
    // more than either alone, and neither ever reaches certainty.
    const combined = accumulator.supports.reduce(
      (survivingDoubt, support) => survivingDoubt * (1 - support),
      1,
    );
    const confidence = round(Math.min(0.95, 1 - combined), 2);
    const leaps = [...accumulator.leaps];
    for (const leap of leaps) {
      const bucket = assumptionUsage.get(leap) ?? new Set<string>();
      for (const evidenceId of accumulator.evidenceIds) bucket.add(evidenceId);
      assumptionUsage.set(leap, bucket);
    }

    edges.push({
      id: `WE-${slug(accumulator.subject.id.replace(/^E-/u, ''))}-${slug(accumulator.predicate)}-${slug(accumulator.object.id.replace(/^E-/u, ''))}`,
      caseId: input.caseId,
      subjectId: accumulator.subject.id,
      predicate: accumulator.predicate,
      objectId: accumulator.object.id,
      confidence,
      sourceClaimIds: accumulator.claimIds,
      sourceObservationIds: accumulator.observationIds,
      contributions: accumulator.contributions,
      validTime: accumulator.validTime,
      transactionTime,
      disputed: false,
      alternatives: [],
      createdByAgent: 'linker',
      assumptionIds: leaps.map((leap) => LEAPS[leap].id),
      lenses: lensesFor([accumulator.subject.kind, accumulator.object.kind]),
    });
  }

  const assumptions: Assumption[] = [...assumptionUsage.entries()].map(
    ([leap, evidenceIds]) => ({
      id: LEAPS[leap].id,
      caseId: input.caseId,
      label: LEAPS[leap].label,
      detail: LEAPS[leap].detail,
      status: 'valid',
      sourceEvidenceIds: [...evidenceIds],
      invalidatedByEvidenceId: null,
    }),
  );

  return { edges, assumptions };
}

export interface NewCaseInput {
  id: string;
  title: string;
  subtitle?: string;
  reference?: string;
  classification?: string;
  location?: string;
  synthetic?: boolean;
  timestamp?: string;
}

/**
 * A case with nothing in it. Everything a case knows arrives through evidence,
 * so a new investigation starts empty rather than pre-seeded with structure.
 */
export function createEmptyCase(input: NewCaseInput): CaseState {
  const createdAt = input.timestamp ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    metadata: {
      id: input.id,
      title: input.title,
      subtitle: input.subtitle ?? 'No evidence has been ingested yet.',
      reference: input.reference ?? input.id.toLocaleUpperCase(),
      classification: input.classification ?? 'Working case file',
      location: input.location ?? 'Unspecified',
      status: 'active',
      synthetic: input.synthetic ?? false,
      createdAt,
      updatedAt: createdAt,
      revision: 0,
    },
    evidence: [],
    observations: [],
    claims: [],
    entities: [],
    worldEdges: [],
    unresolvedReferences: [],
    assumptions: [],
    beliefs: [],
    beliefEdges: [],
    reconstructions: [],
    anomalies: [],
    worldMemory: [],
    evidenceMemory: [],
    beliefMemory: [],
    proceduralMemory: [],
    casePackets: [],
    researchSessions: [],
    agentRuns: [],
    missions: [],
    standingOrders: [],
    clarifications: [],
    temporalConstraints: [],
    revisions: [],
  };
}

/** Allen relations in which two intervals do not share a moment. */
const DISJOINT_RELATIONS = new Set(['before', 'after', 'meets', 'met-by']);

const NEGATION_MARKERS = new Set([
  'not',
  'never',
  'no',
  'none',
  'nobody',
  'nothing',
  'cannot',
  'denied',
  'denies',
  'deny',
  'false',
  'untrue',
  'without',
]);

const CONTENT_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'was',
  'were',
  'is',
  'are',
  'am',
  'be',
  'been',
  'being',
  'at',
  'in',
  'on',
  'of',
  'to',
  'for',
  'from',
  'with',
  'and',
  'or',
  'but',
  'had',
  'has',
  'have',
  'did',
  'do',
  'does',
  'that',
  'this',
  'it',
  'he',
  'she',
  'they',
  'i',
  'we',
  'you',
  'there',
  'then',
  'so',
  'as',
  'by',
]);

function contentTokens(text: string): Set<string> {
  const tokens = text
    .toLocaleLowerCase()
    .replace(/n['’]t\b/gu, ' not')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return new Set(
    tokens.filter(
      (token) => !CONTENT_STOPWORDS.has(token) && !NEGATION_MARKERS.has(token),
    ),
  );
}

function hasNegation(text: string): boolean {
  const tokens = text
    .toLocaleLowerCase()
    .replace(/n['’]t\b/gu, ' not')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return tokens.some((token) => NEGATION_MARKERS.has(token));
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface ContradictionResult {
  beliefs: Belief[];
  /** Edges that are now in tension and should be shown as disputed. */
  disputedEdgeIds: string[];
}

/**
 * Two kinds of conflict the record can carry on its own: a participant placed
 * in two incompatible places at one time, and one artifact denying what
 * another asserts.
 *
 * Both are read conservatively. Without a time on both sides, two placements
 * are merely two placements — saying otherwise would invent the conflict.
 */
export function detectContradictions(state: CaseState): ContradictionResult {
  const beliefs: Belief[] = [];
  const disputed = new Set<string>();
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  const placements = state.worldEdges.filter(
    (edge) => edge.predicate === 'OBSERVED_AT' && edge.validTime !== null,
  );
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      const a = placements[left];
      const b = placements[right];
      if (!a || !b) continue;
      if (a.subjectId !== b.subjectId) continue;
      if (a.objectId === b.objectId) continue;
      if (!a.validTime || !b.validTime) continue;

      let relation: string;
      try {
        relation = allenRelation(a.validTime, b.validTime);
      } catch {
        // An unparseable interval is not evidence of a conflict.
        continue;
      }
      if (DISJOINT_RELATIONS.has(relation)) continue;

      const [first, second] = a.id <= b.id ? [a, b] : [b, a];
      disputed.add(first.id);
      disputed.add(second.id);
      beliefs.push({
        id: `B-CONTRA-${first.id}-${second.id}`,
        caseId: state.metadata.id,
        kind: 'contradiction',
        label: `${labelOf(a.subjectId)} is placed at both ${labelOf(first.objectId)} and ${labelOf(second.objectId)} at the same time`,
        detail: `${first.id} holds ${first.validTime?.earliest ?? 'unknown'}–${first.validTime?.latest ?? 'unknown'} and ${second.id} holds ${second.validTime?.earliest ?? 'unknown'}–${second.validTime?.latest ?? 'unknown'}. The intervals ${relation}, so at least one placement is wrong or one of the two locations is not what it appears to be.`,
        status: 'contested',
        confidence: round(Math.min(first.confidence, second.confidence), 2),
        sourceIds: [
          first.id,
          second.id,
          ...first.sourceObservationIds,
          ...second.sourceObservationIds,
        ],
        // The conflict holds exactly when both derivations hold, so its
        // environment is the union of what each one assumed.
        environments: [[...new Set([...first.assumptionIds, ...second.assumptionIds])]],
        survivingEnvironments: [
          [...new Set([...first.assumptionIds, ...second.assumptionIds])],
        ],
      });
    }
  }

  const claims = state.claims;
  for (let left = 0; left < claims.length; left += 1) {
    for (let right = left + 1; right < claims.length; right += 1) {
      const a = claims[left];
      const b = claims[right];
      if (!a || !b) continue;
      // One source restating itself is repetition, not conflict.
      if (a.speaker !== null && a.speaker === b.speaker) continue;
      if (a.sourceEvidenceId === b.sourceEvidenceId) continue;
      if (hasNegation(a.verbatim) === hasNegation(b.verbatim)) continue;

      const tokensA = contentTokens(a.verbatim);
      const tokensB = contentTokens(b.verbatim);
      if (tokensA.size < 2 || tokensB.size < 2) continue;
      if (jaccard(tokensA, tokensB) < 0.8) continue;

      const [first, second] = a.id <= b.id ? [a, b] : [b, a];
      beliefs.push({
        id: `B-CONTRA-${first.id}-${second.id}`,
        caseId: state.metadata.id,
        kind: 'contradiction',
        label: `${second.speaker ?? second.sourceEvidenceId} denies what ${first.speaker ?? first.sourceEvidenceId} asserts`,
        detail: `“${first.verbatim}” and “${second.verbatim}” cannot both be accurate. Neither is promoted to a world fact while the conflict stands.`,
        status: 'contested',
        confidence: round(
          Math.min(
            admiraltyStrength(first.sourceReliability, first.informationCredibility)
              .combinedStrength,
            admiraltyStrength(second.sourceReliability, second.informationCredibility)
              .combinedStrength,
          ),
          2,
        ),
        sourceIds: [first.id, second.id, first.sourceEvidenceId, second.sourceEvidenceId],
        // Two artifacts saying opposite things is a fact about the record and
        // does not rest on any derivation assumption.
        environments: [[]],
        survivingEnvironments: [[]],
      });
    }
  }

  return {
    beliefs: beliefs.sort((first, second) => first.id.localeCompare(second.id)),
    disputedEdgeIds: [...disputed].sort((first, second) => first.localeCompare(second)),
  };
}
