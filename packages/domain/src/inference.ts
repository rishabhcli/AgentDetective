import {
  admiraltyStrength,
  allenRelation,
  computeWeightedCoverage,
  enforceTemporalPathConsistency,
  propagateNogood,
  rankQuestionsByInformationGain,
  type CandidateQuestion,
  type CoveragePoint,
} from './reasoning.js';
import type {
  AgentName,
  Anomaly,
  Assumption,
  Belief,
  BeliefEdge,
  CaseRevision,
  CaseState,
  Claim,
  EdgeContribution,
  Entity,
  EvidenceArtifact,
  EntityKind,
  LensId,
  MutationResult,
  Observation,
  Reconstruction,
  ReconstructionStatement,
  ResolutionSignal,
  StatementStatus,
  TemporalConstraint,
  TimeInterval,
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
  'speaker' | 'lexical' | 'identifier' | 'locative' | 'coreference' | 'vague';

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

/**
 * Speaker labels that name a recording device rather than a person. Access and
 * camera logs attribute every line to one of these, and reading them as people
 * invents participants who then "meet" and "use" things.
 */
const DEVICE_SPEAKER =
  /^(camera|cam|sensor|reader|scanner|terminal|door|gate|kiosk|unit|lane|channel|detector|panel|log|system)\b/iu;

/** Tokens that may sit inside a name run without breaking it. */
const RUN_CONNECTORS = new Set([
  'of',
  'the',
  'and',
  'de',
  'da',
  'van',
  'von',
  'der',
  'del',
]);

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

/**
 * Pronouns that can stand in for a person already named.
 *
 * Resolution below is positional and never consults the pronoun's form to pick
 * between candidates. Choosing an antecedent by the gender a pronoun implies
 * would invent a fact about a person and would be wrong exactly when the
 * implication is wrong, so two candidates simply stay two candidates.
 */
const PERSON_PRONOUNS = new Set([
  'he',
  'she',
  'they',
  'him',
  'her',
  'them',
  'his',
  'hers',
  'their',
  'theirs',
  'themselves',
  'himself',
  'herself',
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
  /** Set when the surface form stands in for a name stated elsewhere. */
  resolvedTo?: string;
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
const CODE_PATTERN =
  /(?<![\p{L}\p{N}-])(?=[A-Z0-9]{5,10}(?![\p{L}\p{N}]))(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,10}/gu;

function identifierDrafts(text: string): MentionDraft[] {
  const drafts: MentionDraft[] = [];
  const push = (
    surfaceForm: string,
    start: number,
    kindWeights: Record<string, number>,
    confidence: number,
  ) => {
    drafts.push({
      surfaceForm,
      start,
      channel: 'identifier',
      kindWeights,
      confidence,
      vague: false,
    });
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

function isPersonLike(kindWeights: Record<string, number>): boolean {
  const person = kindWeights.person ?? 0;
  return (
    Object.entries(kindWeights).every(
      ([kind, weight]) => kind === 'person' || weight <= person,
    ) && person > 0
  );
}

/**
 * Pronoun references resolved to a single unambiguous antecedent.
 *
 * `priorCandidates` carries forward the person named by earlier records of the
 * same artifact, because line-level extraction usually separates a pronoun from
 * the name it refers to. Anything ambiguous is left unresolved: a wrong
 * antecedent manufactures a relationship that no source ever stated.
 */
function coreferenceDrafts(
  text: string,
  within: readonly MentionDraft[],
  priorCandidates: ReadonlySet<string>,
): MentionDraft[] {
  const drafts: MentionDraft[] = [];
  for (const match of text.matchAll(/\b[\p{L}']+\b/gu)) {
    const word = match[0];
    if (!PERSON_PRONOUNS.has(word.toLocaleLowerCase())) continue;
    const start = match.index;
    const earlier = new Set(
      within
        .filter(
          (draft) =>
            draft.start >= 0 && draft.start < start && isPersonLike(draft.kindWeights),
        )
        .map((draft) => draft.surfaceForm.toLocaleLowerCase()),
    );
    const candidates = earlier.size > 0 ? earlier : priorCandidates;
    if (candidates.size !== 1) continue;
    const antecedent = [...candidates][0];
    if (!antecedent) continue;
    drafts.push({
      surfaceForm: word,
      resolvedTo: antecedent,
      start,
      channel: 'coreference',
      kindWeights: { person: 0.9, identity: 0.1 },
      confidence: 0.45,
      vague: false,
    });
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
    // A negative offset marks a draft that is not a span in the text at all —
    // the speaker attribution. It neither loses an overlap contest nor blocks
    // the words the quotation actually opens with.
    if (draft.start < 0) {
      kept.push(draft);
      continue;
    }
    const end = draft.start + draft.surfaceForm.length;
    const overlaps = kept.some((existing) => {
      if (existing.start < 0) return false;
      const existingEnd = existing.start + existing.surfaceForm.length;
      return draft.start < existingEnd && existing.start < end;
    });
    if (!overlaps) kept.push(draft);
  }

  return kept.map((draft, index) => ({
    id: `MEN-${source.recordId}-${index + 1}`,
    surfaceForm: draft.surfaceForm,
    // A resolved pronoun keeps the word the record used but clusters under the
    // name it stands for.
    normalized: (draft.resolvedTo ?? draft.surfaceForm)
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim(),
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
  // The person most recently named by this artifact, carried forward so a
  // pronoun in a later record can find the name it stands for. Scoped per
  // artifact: reaching across sources would invent a link between them.
  const priorPersonByArtifact = new Map<string, Set<string>>();

  const collect = (
    text: string,
    source: {
      recordId: string;
      recordType: 'observation' | 'claim';
      evidenceId: string;
      locator: string;
    },
    leading: MentionDraft[] = [],
  ): void => {
    const drafts = [
      ...leading,
      ...identifierDrafts(text),
      ...lexicalDrafts(text),
      ...vagueDrafts(text),
    ];
    drafts.push(
      ...coreferenceDrafts(
        text,
        drafts,
        priorPersonByArtifact.get(source.evidenceId) ?? new Set<string>(),
      ),
    );

    const namedPeople = new Set(
      drafts
        .filter(
          (draft) =>
            draft.start >= 0 &&
            draft.channel !== 'coreference' &&
            isPersonLike(draft.kindWeights),
        )
        .map((draft) => draft.surfaceForm.toLocaleLowerCase()),
    );
    // Nearest antecedent: the latest record that named anyone replaces the
    // candidate set rather than accumulating with it.
    if (namedPeople.size > 0) priorPersonByArtifact.set(source.evidenceId, namedPeople);

    mentions.push(...draftsToMentions(drafts, { ...source, context: text.slice(0, 240) }));
  };

  for (const observation of observations) {
    collect(observation.text ?? '', {
      recordId: observation.id,
      recordType: 'observation',
      evidenceId: observation.sourceEvidenceId,
      locator: observation.locator || 'unlocated observation',
    });
  }

  for (const claim of claims) {
    const speaker = claim.speaker?.trim();
    collect(
      claim.verbatim ?? '',
      {
        recordId: claim.id,
        recordType: 'claim',
        evidenceId: claim.sourceEvidenceId,
        locator: `quoted claim ${claim.id}`,
      },
      speaker
        ? [
            {
              // Attached ahead of the quoted span so it sorts first and never
              // loses an overlap contest with text inside the quotation.
              surfaceForm: speaker,
              start: -1,
              channel: 'speaker',
              kindWeights: DEVICE_SPEAKER.test(speaker)
                ? { device: 0.75, object: 0.15, person: 0.05, organization: 0.05 }
                : { person: 0.85, organization: 0.1, identity: 0.05 },
              confidence: 0.9,
              vague: false,
            },
          ]
        : [],
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

function supportDescription(mentionCount: number, artifactCount: number): string {
  return `Derived from ${mentionCount} mention${mentionCount === 1 ? '' : 's'} across ${artifactCount} artifact${artifactCount === 1 ? '' : 's'}.`;
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
  // Corroboration lifts an entity toward its mention quality rather than being
  // the whole of its standing: a name stated plainly once is weak evidence, not
  // almost no evidence.
  return round(Math.min(0.95, mean * (0.6 + 0.4 * (1 - 0.5 ** artifacts))), 2);
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
        const mentionIds = [
          ...new Set([
            ...(record.properties.mentionIds ?? []),
            ...group.mentions.map((mention) => mention.id),
          ]),
        ];
        record.properties = { ...record.properties, mentionIds };
        // The description states how well supported the entity is, so it is
        // restated as support arrives rather than frozen at first derivation.
        record.description = supportDescription(
          mentionIds.length,
          record.sourceEvidenceIds.length,
        );
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
      description: supportDescription(
        group.mentions.length,
        distinctEvidenceIds(group.mentions).length,
      ),
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
  coreference: {
    id: 'A-LEAP-COREFERENCE',
    label: 'A pronoun was read as referring to the person named before it',
    detail:
      'The relationship depends on resolving a pronoun to an antecedent stated elsewhere in the same artifact. It fails if the pronoun refers to someone the record never named, or to a different person than the nearest one.',
    discount: 0.75,
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

/** Prefix for the per-artifact reliability warrant. */
export const SOURCE_WARRANT_PREFIX = 'A-SOURCE-';

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
  /** Only used to name each artifact's reliability warrant readably. */
  evidence?: readonly EvidenceArtifact[];
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

    // A directly named mention outranks a resolved pronoun for the same
    // participant, so an edge only carries the coreference leap when the
    // pronoun is the record's sole reference to them.
    const byEntity = new Map<string, { entity: Entity; mention: EntityMention }>();
    for (const mention of recordMentions) {
      const entity = entityByNormalized.get(mention.normalized);
      if (!entity) continue;
      const existing = byEntity.get(entity.id);
      if (existing && existing.mention.channel !== 'coreference') continue;
      if (existing && mention.channel === 'coreference') continue;
      byEntity.set(entity.id, { entity, mention });
    }
    const resolved = [...byEntity.values()];

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
        // The speaker is who the record is attributed to, not a participant in
        // what the record says. A camera that logged a line did not meet the
        // person in it, and a witness describing a scene is making a claim
        // about it rather than standing in a relationship with everyone named.
        if (a.mention.channel === 'speaker' || b.mention.channel === 'speaker') {
          continue;
        }

        const aRank = KIND_RANK[a.entity.kind];
        const bRank = KIND_RANK[b.entity.kind];
        const [subjectSide, objectSide] =
          aRank < bRank || (aRank === bRank && a.entity.id <= b.entity.id)
            ? [a, b]
            : [b, a];
        const predicate = predicateFor(subjectSide.entity.kind, objectSide.entity.kind);
        const key = `${subjectSide.entity.id}|${predicate}|${objectSide.entity.id}`;

        const pairLeaps: LeapKind[] = [leap];
        if (a.mention.channel === 'coreference' || b.mention.channel === 'coreference') {
          pairLeaps.push('coreference');
        }
        // The geometric mean of the factors, not their product. Multiplying
        // five independent 0..1 confidences drives every derived relationship
        // to a couple of percent, which reads as "worthless" rather than
        // "single-source". The mean still lets one weak link pull the whole
        // chain down; it just does not annihilate it.
        const factors = [
          base,
          a.mention.confidence,
          b.mention.confidence,
          subjectSide.entity.confidence,
          objectSide.entity.confidence,
        ].map((value) => Math.max(value, 0.01));
        const chain =
          factors.reduce((product, value) => product * value, 1) ** (1 / factors.length);
        const support = round(
          pairLeaps.reduce((value, kind) => value * LEAPS[kind].discount, chain),
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
        for (const kind of pairLeaps) accumulator.leaps.add(kind);
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
  const sourceWarrants = new Map<string, string>();
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
      assumptionIds: [
        ...leaps.map((leap) => LEAPS[leap].id),
        // Every artifact carries an implicit warrant — that it is what it
        // purports to be and reports accurately. Making it explicit is what
        // lets an investigator discredit one source and watch exactly its
        // footprint recede, using the same cascade as any other assumption.
        ...[...accumulator.evidenceIds].map((evidenceId) => {
          const id = `${SOURCE_WARRANT_PREFIX}${evidenceId}`;
          sourceWarrants.set(evidenceId, id);
          return id;
        }),
      ],
      lenses: lensesFor([accumulator.subject.kind, accumulator.object.kind]),
    });
  }

  const artifactLabel = (evidenceId: string): string => {
    const artifact = input.evidence?.find((item) => item.id === evidenceId);
    return artifact ? `${artifact.title} (${artifact.id})` : evidenceId;
  };
  const assumptions: Assumption[] = [
    ...[...assumptionUsage.entries()].map(([leap, evidenceIds]) => ({
      id: LEAPS[leap].id,
      caseId: input.caseId,
      label: LEAPS[leap].label,
      detail: LEAPS[leap].detail,
      status: 'valid' as const,
      sourceEvidenceIds: [...evidenceIds],
      invalidatedByEvidenceId: null,
    })),
    ...[...sourceWarrants.entries()].map(([evidenceId, id]) => ({
      id,
      caseId: input.caseId,
      label: `${artifactLabel(evidenceId)} is what it purports to be and reports accurately`,
      detail:
        'Everything read out of this artifact rests on it being genuine, correctly attributed, and not deliberately misleading. Discrediting it withdraws exactly its own footprint and leaves independently sourced relationships standing.',
      status: 'valid' as const,
      sourceEvidenceIds: [evidenceId],
      invalidatedByEvidenceId: null,
    })),
  ];

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
    tokens.filter((token) => !CONTENT_STOPWORDS.has(token) && !NEGATION_MARKERS.has(token)),
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
  /** Warrants the detection itself required, so they can be attacked. */
  assumptions: Assumption[];
}

/**
 * Two placements at distinct locations separated by less than this many seconds
 * are treated as being in tension. The engine cannot measure the distance
 * between two location records, so this is a stated warrant rather than a
 * proof, and it is attached to every conflict it produces.
 */
const DEFAULT_TRANSIT_WINDOW_SECONDS = 60;

const TRANSIT_ASSUMPTION_ID = 'A-LEAP-TRANSIT';

/**
 * Two kinds of conflict the record can carry on its own: a participant placed
 * in two incompatible places at one time, and one artifact denying what
 * another asserts.
 *
 * Both are read conservatively. Without a time on both sides, two placements
 * are merely two placements — saying otherwise would invent the conflict.
 */
export function detectContradictions(
  state: CaseState,
  options: { transitWindowSeconds?: number; maxComparisons?: number } = {},
): ContradictionResult {
  const transitWindowSeconds =
    options.transitWindowSeconds ?? DEFAULT_TRANSIT_WINDOW_SECONDS;
  // Both scans are pairwise. On a large case that is quadratic, so each one is
  // bounded and stops rather than doing unbounded work.
  const maxComparisons = options.maxComparisons ?? 50_000;
  const beliefs: Belief[] = [];
  const disputed = new Set<string>();
  let usedTransitWarrant = false;
  let comparisons = 0;
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  const placements = state.worldEdges.filter(
    (edge) => edge.predicate === 'OBSERVED_AT' && edge.validTime !== null,
  );
  placementScan: for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      if (comparisons >= maxComparisons) break placementScan;
      const a = placements[left];
      const b = placements[right];
      if (!a || !b) continue;
      if (a.subjectId !== b.subjectId) continue;
      if (a.objectId === b.objectId) continue;
      if (!a.validTime || !b.validTime) continue;
      comparisons += 1;

      let relation: string;
      try {
        relation = allenRelation(a.validTime, b.validTime);
      } catch {
        // An unparseable interval is not evidence of a conflict.
        continue;
      }

      const gapSeconds = (() => {
        const aStart = Date.parse(a.validTime.earliest);
        const aEnd = Date.parse(a.validTime.latest);
        const bStart = Date.parse(b.validTime.earliest);
        const bEnd = Date.parse(b.validTime.latest);
        if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN))
          return Number.POSITIVE_INFINITY;
        if (aEnd < bStart) return (bStart - aEnd) / 1_000;
        if (bEnd < aStart) return (aStart - bEnd) / 1_000;
        return 0;
      })();

      const overlapping = !DISJOINT_RELATIONS.has(relation);
      const tooCloseToTravel = !overlapping && gapSeconds <= transitWindowSeconds;
      if (!overlapping && !tooCloseToTravel) continue;
      if (tooCloseToTravel) usedTransitWarrant = true;

      const [first, second] = a.id <= b.id ? [a, b] : [b, a];
      disputed.add(first.id);
      disputed.add(second.id);
      beliefs.push({
        id: `B-CONTRA-${first.id}-${second.id}`,
        caseId: state.metadata.id,
        kind: 'contradiction',
        label: overlapping
          ? `${labelOf(a.subjectId)} is placed at both ${labelOf(first.objectId)} and ${labelOf(second.objectId)} at the same time`
          : `${labelOf(a.subjectId)} is placed at ${labelOf(first.objectId)} and ${labelOf(second.objectId)} ${Math.round(gapSeconds)}s apart`,
        detail: overlapping
          ? `${first.id} holds ${first.validTime?.earliest ?? 'unknown'}–${first.validTime?.latest ?? 'unknown'} and ${second.id} holds ${second.validTime?.earliest ?? 'unknown'}–${second.validTime?.latest ?? 'unknown'}. The intervals ${relation}, so at least one placement is wrong or one of the two locations is not what it appears to be.`
          : `${first.id} and ${second.id} place the same subject at two different locations ${Math.round(gapSeconds)} seconds apart. This is a conflict only while the transit warrant holds: the engine cannot measure the distance between these two location records, so a short walk between adjacent places would dissolve it.`,
        status: 'contested',
        confidence: round(Math.min(first.confidence, second.confidence), 2),
        sourceIds: [
          first.id,
          second.id,
          ...first.sourceObservationIds,
          ...second.sourceObservationIds,
        ],
        // The conflict holds exactly when both derivations hold, so its
        // environment is the union of what each one assumed — plus the transit
        // warrant when the conflict rests on one.
        environments: [
          [
            ...new Set([
              ...first.assumptionIds,
              ...second.assumptionIds,
              ...(tooCloseToTravel ? [TRANSIT_ASSUMPTION_ID] : []),
            ]),
          ],
        ],
        survivingEnvironments: [
          [
            ...new Set([
              ...first.assumptionIds,
              ...second.assumptionIds,
              ...(tooCloseToTravel ? [TRANSIT_ASSUMPTION_ID] : []),
            ]),
          ],
        ],
      });
    }
  }

  // Tokenizing inside a pairwise loop costs O(n^2) scans of the same text, so
  // each claim is read once. A denial can only conflict with an assertion, so
  // the two sides are compared across rather than within.
  const analyzed = state.claims.map((item) => ({
    claim: item,
    negated: hasNegation(item.verbatim),
    tokens: contentTokens(item.verbatim),
  }));
  const negated = analyzed.filter((item) => item.negated && item.tokens.size >= 2);
  const asserted = analyzed.filter((item) => !item.negated && item.tokens.size >= 2);

  claimScan: for (const denial of negated) {
    for (const assertion of asserted) {
      if (comparisons >= maxComparisons) break claimScan;
      comparisons += 1;
      const a = denial.claim;
      const b = assertion.claim;
      // One source restating itself is repetition, not conflict.
      if (a.speaker !== null && a.speaker === b.speaker) continue;
      if (a.sourceEvidenceId === b.sourceEvidenceId) continue;
      if (jaccard(denial.tokens, assertion.tokens) < 0.8) continue;

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
    assumptions: usedTransitWarrant
      ? [
          {
            id: TRANSIT_ASSUMPTION_ID,
            caseId: state.metadata.id,
            label: `Two distinct locations cannot both be occupied within ${transitWindowSeconds}s`,
            detail:
              'The engine holds no map, so it cannot prove that two location records are far enough apart to make a short gap impossible. Establishing that the two places are adjacent would dissolve every conflict resting on this warrant.',
            status: 'valid',
            sourceEvidenceIds: [],
            invalidatedByEvidenceId: null,
          },
        ]
      : [],
  };
}

export interface AbductionResult {
  beliefs: Belief[];
  beliefEdges: BeliefEdge[];
}

/**
 * The explanations that would resolve a conflict, offered together.
 *
 * Abduction here is deliberately narrow. A contradiction is a surprising fact
 * that demands an explanation, and the explanations worth naming are the ones
 * that would actually dissolve it: one side is wrong, the two descriptions are
 * of one thing, or two things are being read as one. The engine proposes the
 * set and refuses to pick a winner.
 */
export function abduceHypotheses(state: CaseState): AbductionResult {
  const beliefs: Belief[] = [];
  const beliefEdges: BeliefEdge[] = [];
  const edgeById = new Map(state.worldEdges.map((edge) => [edge.id, edge]));
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  const contradictions = state.beliefs.filter((belief) => belief.kind === 'contradiction');

  for (const contradiction of contradictions) {
    const edges = contradiction.sourceIds
      .map((id) => edgeById.get(id))
      .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined);

    let explanations: Array<{ label: string; detail: string }>;
    if (edges.length >= 2) {
      const [first, second] = edges;
      if (!first || !second) continue;
      explanations = [
        {
          label: `The ${labelOf(first.objectId)} placement is mistaken`,
          detail: `${first.id} would fail if its source artifact was misread, mistimed, or describes a different subject.`,
        },
        {
          label: `The ${labelOf(second.objectId)} placement is mistaken`,
          detail: `${second.id} would fail on the same grounds, leaving the other placement standing.`,
        },
        {
          label: `${labelOf(first.objectId)} and ${labelOf(second.objectId)} are one place under two names`,
          detail:
            'Both placements can be accurate if the two location records describe the same physical place. Resolving them would remove the conflict without discarding either artifact.',
        },
        {
          label: `Two different subjects are being read as ${labelOf(first.subjectId)}`,
          detail:
            'Both placements can be accurate if the identity behind them was merged too early. This is the failure the candidate-binding model exists to catch.',
        },
      ];
    } else {
      explanations = [
        {
          label: 'The first account is accurate and the second is not',
          detail:
            'The denial fails if its speaker was mistaken, repeating hearsay, or has a reason to deny.',
        },
        {
          label: 'The second account is accurate and the first is not',
          detail: 'The original assertion fails on the same grounds.',
        },
        {
          label: 'The two accounts describe different moments or different things',
          detail:
            'Both can be accurate if they are not actually about the same event; the conflict would be an artifact of reading them as one.',
        },
      ];
    }

    const share = round(1 / explanations.length, 3);
    const created = explanations.map((explanation, index) => {
      const belief: Belief = {
        id: `B-HYP-${contradiction.id}-${index + 1}`,
        caseId: state.metadata.id,
        kind: 'hypothesis',
        label: explanation.label,
        detail: explanation.detail,
        status: 'open',
        confidence: share,
        sourceIds: [contradiction.id, ...contradiction.sourceIds],
        environments: structuredClone(contradiction.environments),
        survivingEnvironments: structuredClone(contradiction.survivingEnvironments),
      };
      return belief;
    });
    beliefs.push(...created);

    for (const belief of created) {
      beliefEdges.push({
        id: `BE-EXPLAINS-${belief.id}`,
        caseId: state.metadata.id,
        sourceId: belief.id,
        targetId: contradiction.id,
        predicate: 'EXPLAINS',
        weight: belief.confidence,
        sourceEvidenceIds: [],
      });
    }
    // Competing explanations exclude one another; that is what makes the set a
    // question rather than a list.
    for (let left = 0; left < created.length; left += 1) {
      for (let right = left + 1; right < created.length; right += 1) {
        const a = created[left];
        const b = created[right];
        if (!a || !b) continue;
        beliefEdges.push({
          id: `BE-CONTRADICTS-${a.id}-${b.id}`,
          caseId: state.metadata.id,
          sourceId: a.id,
          targetId: b.id,
          predicate: 'CONTRADICTS',
          weight: round(Math.min(a.confidence, b.confidence), 3),
          sourceEvidenceIds: [],
        });
      }
    }
  }

  for (const reference of state.unresolvedReferences) {
    if (reference.status === 'resolved') continue;
    if (reference.candidateBindings.length < 2) continue;
    reference.candidateBindings.forEach((binding, index) => {
      beliefs.push({
        id: `B-HYP-${reference.id}-${index + 1}`,
        caseId: state.metadata.id,
        kind: 'hypothesis',
        label: `“${reference.surfaceForm}” is ${binding.label}`,
        detail: binding.entityId
          ? `Binding “${reference.surfaceForm}” to ${binding.label} carries ${Math.round(binding.probability * 100)}% of the current distribution. The alternatives are retained.`
          : `The case has not met whoever “${reference.surfaceForm}” names. This possibility is kept so the distribution stays open.`,
        status: 'open',
        confidence: binding.probability,
        sourceIds: [reference.id, ...reference.sourceEvidenceIds],
        environments: [[]],
        survivingEnvironments: [[]],
      });
    });
  }

  return {
    beliefs: beliefs.sort((first, second) => first.id.localeCompare(second.id)),
    beliefEdges: beliefEdges.sort((first, second) => first.id.localeCompare(second.id)),
  };
}

function dominantKind(distribution: Record<string, number>): string {
  let best = 'unknown';
  let bestScore = -1;
  for (const [kind, probability] of Object.entries(distribution)) {
    if (probability > bestScore) {
      best = kind;
      bestScore = probability;
    }
  }
  return best;
}

function categoryForKind(kind: string): Anomaly['category'] {
  if (kind === 'person' || kind === 'identity' || kind === 'organization') return 'who';
  if (kind === 'location') return 'where';
  if (kind === 'time-interval' || kind === 'event') return 'when';
  return 'what';
}

/** Expected information gain of a question whose answer settles it outright. */
function resolvingGain(id: string, question: string, prior: number[]): number {
  const candidate: CandidateQuestion = {
    id,
    question,
    answers: prior.map((probability, index) => ({
      label: `answer ${index + 1}`,
      probability,
      posteriorHypothesisProbabilities: prior.map((_, other) => (other === index ? 1 : 0)),
    })),
  };
  return (
    rankQuestionsByInformationGain(prior, [candidate])[0]?.expectedInformationGain ?? 0
  );
}

/**
 * The open questions, ordered by how much of the case's uncertainty an answer
 * would actually remove. This is the difference between a list of things that
 * are unknown and a plan.
 */
export function rankOpenQuestions(state: CaseState): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  for (const reference of state.unresolvedReferences) {
    if (reference.status === 'resolved') continue;
    if (reference.candidateBindings.length < 2) continue;
    const prior = reference.candidateBindings.map((binding) => binding.probability);
    const category = categoryForKind(dominantKind(reference.kindProbabilities));
    const question = `${category === 'who' ? 'Who' : category === 'where' ? 'Where' : category === 'when' ? 'When' : 'What'} is “${reference.surfaceForm}”?`;
    anomalies.push({
      id: `AN-${reference.id}`,
      caseId: state.metadata.id,
      question,
      category,
      detail: `${reference.candidateBindings.length} candidate bindings remain open and nothing has separated them. Everything derived from “${reference.surfaceForm}” inherits that spread.`,
      expectedInformationGain: resolvingGain(`Q-${reference.id}`, question, prior),
      status: 'open',
      relatedIds: [reference.id, ...reference.sourceEvidenceIds],
      lastResult: null,
    });
  }

  const edgeById = new Map(state.worldEdges.map((edge) => [edge.id, edge]));
  for (const contradiction of state.beliefs) {
    if (contradiction.kind !== 'contradiction') continue;
    const edges = contradiction.sourceIds
      .map((id) => edgeById.get(id))
      .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined);
    const branches = edges.length >= 2 ? 4 : 3;
    const question =
      edges.length >= 2
        ? `Which placement of ${labelOf(edges[0]?.subjectId ?? '')} is wrong?`
        : 'Which of the two conflicting accounts is accurate?';
    anomalies.push({
      id: `AN-${contradiction.id}`,
      caseId: state.metadata.id,
      question,
      category: edges.length >= 2 ? 'where' : 'what',
      detail: contradiction.detail,
      expectedInformationGain: resolvingGain(
        `Q-${contradiction.id}`,
        question,
        Array.from({ length: branches }, () => 1 / branches),
      ),
      status: 'open',
      relatedIds: [contradiction.id, ...contradiction.sourceIds],
      lastResult: null,
    });
  }

  for (const edge of state.worldEdges) {
    const artifacts = new Set(
      [
        ...edge.sourceObservationIds.map(
          (id) => state.observations.find((item) => item.id === id)?.sourceEvidenceId,
        ),
        ...edge.sourceClaimIds.map(
          (id) => state.claims.find((item) => item.id === id)?.sourceEvidenceId,
        ),
      ].filter((id): id is string => Boolean(id)),
    );
    if (artifacts.size !== 1) continue;
    const question = `Can ${labelOf(edge.subjectId)} → ${labelOf(edge.objectId)} be corroborated independently?`;
    anomalies.push({
      id: `AN-CORROB-${edge.id}`,
      caseId: state.metadata.id,
      question,
      category: 'what',
      detail: `This relationship rests on one artifact. A second independent source would either confirm it or expose it, and nothing else in the case can do that job.`,
      expectedInformationGain: resolvingGain(`Q-CORROB-${edge.id}`, question, [
        Math.max(0.01, edge.confidence),
        Math.max(0.01, 1 - edge.confidence),
      ]),
      status: 'open',
      relatedIds: [edge.id, ...[...artifacts]],
      lastResult: null,
    });
  }

  return anomalies.sort(
    (first, second) =>
      second.expectedInformationGain - first.expectedInformationGain ||
      first.id.localeCompare(second.id),
  );
}

export interface TemporalDerivationResult {
  constraints: TemporalConstraint[];
  consistent: boolean;
  contradictions: string[];
}

/**
 * Allen constraints between timed observations, narrowed by path consistency.
 *
 * Observations are used as the event nodes because they are the closest thing
 * the record has to something that happened at a time. An inconsistent network
 * is reported, never quietly repaired.
 */
export function deriveTemporalConstraints(
  state: CaseState,
  options: { maxPairs?: number } = {},
): TemporalDerivationResult {
  const maxPairs = options.maxPairs ?? 2_000;
  const timed = state.observations.filter(
    (observation) =>
      observation.interval !== null && observation.interval.precision !== 'unknown',
  );
  const constraints: TemporalConstraint[] = [];

  outer: for (let left = 0; left < timed.length; left += 1) {
    for (let right = left + 1; right < timed.length; right += 1) {
      if (constraints.length >= maxPairs) break outer;
      const a = timed[left];
      const b = timed[right];
      if (!a?.interval || !b?.interval) continue;
      let relation;
      try {
        relation = allenRelation(a.interval, b.interval);
      } catch {
        continue;
      }
      constraints.push({
        id: `TC-${a.id}-${b.id}`,
        caseId: state.metadata.id,
        sourceEventId: a.id,
        targetEventId: b.id,
        possibleRelations: [relation],
        sourceIds: [a.id, b.id, a.sourceEvidenceId, b.sourceEvidenceId],
        status: 'consistent',
      });
    }
  }

  if (constraints.length === 0) {
    return { constraints: [], consistent: true, contradictions: [] };
  }

  const result = enforceTemporalPathConsistency(constraints);
  return {
    constraints: result.constraints,
    consistent: result.consistent,
    contradictions: result.contradictions,
  };
}

function readablePredicate(predicate: WorldPredicate): string {
  return predicate.replaceAll('_', ' ').toLocaleLowerCase();
}

function intervalLabel(edge: WorldEdge): string {
  if (!edge.validTime) return 'Time not established';
  if (edge.validTime.earliest === edge.validTime.latest) return edge.validTime.earliest;
  return `${edge.validTime.earliest} – ${edge.validTime.latest}`;
}

function artifactsBehind(state: CaseState, edge: WorldEdge): Set<string> {
  return new Set(
    [
      ...edge.sourceObservationIds.map(
        (id) => state.observations.find((item) => item.id === id)?.sourceEvidenceId,
      ),
      ...edge.sourceClaimIds.map(
        (id) => state.claims.find((item) => item.id === id)?.sourceEvidenceId,
      ),
    ].filter((id): id is string => Boolean(id)),
  );
}

function statementStatus(
  state: CaseState,
  edge: WorldEdge,
  excluded: boolean,
  openReferenceEntityIds: ReadonlySet<string>,
): StatementStatus {
  if (excluded || edge.disputed) return 'DISPUTED';
  if (
    openReferenceEntityIds.has(edge.subjectId) ||
    openReferenceEntityIds.has(edge.objectId)
  ) {
    return 'UNKNOWN';
  }
  if (edge.sourceObservationIds.length === 0) return 'INFERRED';
  return artifactsBehind(state, edge).size >= 2 ? 'SUPPORTED' : 'PARTIALLY_SUPPORTED';
}

interface ReconstructionBranch {
  key: string;
  title: string;
  eyebrow: string;
  summary: string;
  excludedEdgeIds: Set<string>;
  hypothesisIds: string[];
}

function reconstructionBranches(state: CaseState): ReconstructionBranch[] {
  const edgeById = new Map(state.worldEdges.map((edge) => [edge.id, edge]));
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  const contradiction = state.beliefs.find((belief) => {
    if (belief.kind !== 'contradiction') return false;
    return belief.sourceIds.filter((id) => edgeById.has(id)).length >= 2;
  });

  if (!contradiction) {
    return [
      {
        key: 'AS-RECORDED',
        title: 'As recorded',
        eyebrow: 'Single surviving account',
        summary:
          'Nothing in the case is currently in tension, so one account covers every derived relationship.',
        excludedEdgeIds: new Set<string>(),
        hypothesisIds: [],
      },
    ];
  }

  const conflicting = contradiction.sourceIds
    .map((id) => edgeById.get(id))
    .filter((edge): edge is WorldEdge => edge !== undefined)
    .slice(0, 2);
  const [first, second] = conflicting;
  if (!first || !second) {
    return [
      {
        key: 'AS-RECORDED',
        title: 'As recorded',
        eyebrow: 'Single surviving account',
        summary: 'One account covers every derived relationship.',
        excludedEdgeIds: new Set<string>(),
        hypothesisIds: [],
      },
    ];
  }

  return [
    {
      key: `WITHOUT-${first.id}`,
      title: `${labelOf(first.subjectId)} was not at ${labelOf(first.objectId)}`,
      eyebrow: 'Competing account',
      summary: `Reads ${first.id} as the mistaken placement and keeps ${second.id} standing.`,
      excludedEdgeIds: new Set([first.id]),
      hypothesisIds: [contradiction.id],
    },
    {
      key: `WITHOUT-${second.id}`,
      title: `${labelOf(second.subjectId)} was not at ${labelOf(second.objectId)}`,
      eyebrow: 'Competing account',
      summary: `Reads ${second.id} as the mistaken placement and keeps ${first.id} standing.`,
      excludedEdgeIds: new Set([second.id]),
      hypothesisIds: [contradiction.id],
    },
    {
      key: 'ONE-PLACE',
      title: `${labelOf(first.objectId)} and ${labelOf(second.objectId)} are one place`,
      eyebrow: 'Reconciling account',
      summary:
        'Keeps both placements by treating the two location records as one physical place under different names.',
      excludedEdgeIds: new Set<string>(),
      hypothesisIds: [contradiction.id],
    },
  ];
}

/**
 * Competing accounts of the case, each labeling every statement with how well
 * the record actually supports it under that account.
 */
export function buildReconstructions(
  state: CaseState,
  options: { timestamp?: string } = {},
): Reconstruction[] {
  if (state.worldEdges.length === 0) return [];
  const updatedAt = options.timestamp ?? new Date().toISOString();
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  const openReferenceEntityIds = new Set<string>();
  for (const reference of state.unresolvedReferences) {
    if (reference.status === 'resolved') continue;
    for (const binding of reference.candidateBindings) {
      if (binding.entityId) openReferenceEntityIds.add(binding.entityId);
    }
  }

  const orderedEdges = [...state.worldEdges].sort(
    (left, right) =>
      (left.validTime?.earliest ?? '~').localeCompare(right.validTime?.earliest ?? '~') ||
      left.id.localeCompare(right.id),
  );

  const drafts = reconstructionBranches(state).map((branch) => {
    const statements: ReconstructionStatement[] = orderedEdges.map((edge) => {
      const status = statementStatus(
        state,
        edge,
        branch.excludedEdgeIds.has(edge.id),
        openReferenceEntityIds,
      );
      return {
        id: `RS-${branch.key}-${edge.id}`,
        timeLabel: intervalLabel(edge),
        text: `${labelOf(edge.subjectId)} ${readablePredicate(edge.predicate)} ${labelOf(edge.objectId)}.`,
        status,
        sourceIds: [edge.id, ...edge.sourceObservationIds, ...edge.sourceClaimIds],
      };
    });

    const points: CoveragePoint[] = state.observations.map((observation) => {
      const backing = state.worldEdges.filter(
        (edge) =>
          edge.sourceObservationIds.includes(observation.id) &&
          !branch.excludedEdgeIds.has(edge.id),
      );
      let support: CoveragePoint['support'];
      if (backing.length === 0) support = 'unexplained';
      else if (backing.some((edge) => artifactsBehind(state, edge).size >= 2)) {
        support = 'multi-source';
      } else support = 'direct';
      return {
        id: observation.id,
        weight: Math.max(1, observation.materialWeight),
        support,
      };
    });
    const coverage = computeWeightedCoverage(
      points.length > 0
        ? points
        : [{ id: 'no-observations', weight: 1, support: 'inferred' }],
    );

    const requiredAssumptionIds = [
      ...new Set(
        orderedEdges
          .filter((edge) => !branch.excludedEdgeIds.has(edge.id))
          .flatMap((edge) => edge.assumptionIds),
      ),
    ];

    return {
      branch,
      statements,
      coverage,
      requiredAssumptionIds,
      contradictions: statements.filter((statement) => statement.status === 'DISPUTED')
        .length,
    };
  });

  return drafts
    .sort(
      (left, right) =>
        right.coverage.coveragePercent - left.coverage.coveragePercent ||
        left.contradictions - right.contradictions ||
        left.branch.key.localeCompare(right.branch.key),
    )
    .map((draft, index) => ({
      id: `${DERIVED_RECONSTRUCTION_PREFIX}${draft.branch.key}`,
      caseId: state.metadata.id,
      title: draft.branch.title,
      eyebrow: index === 0 ? draft.branch.eyebrow : 'Alternative account',
      summary: draft.branch.summary,
      rank: index + 1,
      isLeading: index === 0,
      coveragePercent: draft.coverage.coveragePercent,
      coverageBreakdown: draft.coverage.breakdown,
      materialPoints: draft.coverage.materialPoints,
      explainedPoints: draft.coverage.explainedPoints,
      contradictions: draft.contradictions,
      assumptions: draft.requiredAssumptionIds.length,
      statements: draft.statements,
      hypothesisIds: draft.branch.hypothesisIds,
      requiredAssumptionIds: draft.requiredAssumptionIds,
      updatedAt,
    }));
}

/**
 * Reconstructions the engine owns. Anything without this prefix was authored
 * and is never overwritten by a derivation pass.
 */
export const DERIVED_RECONSTRUCTION_PREFIX = 'R-DERIVED-';

export interface InferencePassOptions {
  timestamp?: string;
  /** Upper bound on records read in one pass; a large corpus degrades to a sample. */
  maxRecords?: number;
  /**
   * Restricts which artifacts' records are read for mentions and relationships.
   * Case-wide stages (contradictions, explanations, questions) still see
   * everything, so new evidence is judged against the whole case.
   */
  evidenceScope?: readonly string[];
}

function mergeById<T extends { id: string }>(existing: T[], derived: readonly T[]): number {
  const known = new Set(existing.map((item) => item.id));
  let added = 0;
  for (const item of derived) {
    if (known.has(item.id)) continue;
    existing.push(item);
    known.add(item.id);
    added += 1;
  }
  return added;
}

/**
 * One full derivation over a case, composed from the stages above.
 *
 * Every stage is isolated: a parser fault in one costs its own output and is
 * recorded, never the whole pass. The result lands on the same
 * `MutationResult` contract the routes already consume, and a pass that finds
 * nothing new returns a null revision so the caller skips persistence.
 */
export interface DerivationStageReport {
  agent: AgentName;
  status: 'completed' | 'skipped' | 'failed';
  detail: string;
  inputIds: string[];
  outputIds: string[];
  durationMs: number;
}

export type DerivationConcernKind =
  'open-contradiction' | 'unresolved-identity' | 'uncorroborated' | 'thin-entity';

export interface DerivationConcern {
  id: string;
  kind: DerivationConcernKind;
  label: string;
  detail: string;
  subjectIds: string[];
  /** 0..1 — how much of the case's standing is exposed to this. */
  exposure: number;
}

export interface InferencePassResult extends MutationResult {
  /** One entry per agent, in chain order, describing what it actually did. */
  stageReports: DerivationStageReport[];
  concerns: DerivationConcern[];
}

/**
 * What the derivation is least entitled to.
 *
 * The engine grades its own output so the weakest parts are visible without
 * having to be hunted for. Nothing here changes the case; it only says where
 * the case would break first.
 */
export function assessDerivation(state: CaseState): DerivationConcern[] {
  const concerns: DerivationConcern[] = [];
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  for (const belief of state.beliefs) {
    if (belief.kind !== 'contradiction' || belief.status === 'rejected') continue;
    concerns.push({
      id: `CONCERN-${belief.id}`,
      kind: 'open-contradiction',
      label: belief.label,
      detail:
        'Two things the record supports cannot both be true. Until this is settled every account that uses either side inherits the conflict.',
      subjectIds: [belief.id, ...belief.sourceIds],
      exposure: 0.9,
    });
  }

  for (const reference of state.unresolvedReferences) {
    if (reference.status === 'resolved') continue;
    if (reference.candidateBindings.length < 2) continue;
    const leading = [...reference.candidateBindings].sort(
      (left, right) => right.probability - left.probability,
    )[0];
    concerns.push({
      id: `CONCERN-${reference.id}`,
      kind: 'unresolved-identity',
      label: `“${reference.surfaceForm}” is still a distribution, not a name`,
      detail: `The leading binding holds ${Math.round((leading?.probability ?? 0) * 100)}% of the mass. Everything derived through this reference carries that spread.`,
      subjectIds: [reference.id],
      exposure: round(1 - (leading?.probability ?? 0)),
    });
  }

  for (const edge of state.worldEdges) {
    const artifacts = artifactsBehind(state, edge);
    if (artifacts.size !== 1) continue;
    concerns.push({
      id: `CONCERN-${edge.id}`,
      kind: 'uncorroborated',
      label: `${labelOf(edge.subjectId)} → ${labelOf(edge.objectId)} rests on one artifact`,
      detail: `Only ${[...artifacts][0] ?? 'one source'} supports this. It inherits every failure mode of that single artifact, and nothing in the case would reveal the failure.`,
      subjectIds: [edge.id],
      exposure: round(edge.confidence),
    });
  }

  for (const entity of state.entities) {
    const mentionCount = entity.properties.mentionIds?.length ?? 0;
    const thin =
      mentionCount === 1 ||
      (entity.sourceEvidenceIds.length === 1 && entity.confidence < 0.5);
    if (!thin) continue;
    concerns.push({
      id: `CONCERN-${entity.id}`,
      kind: 'thin-entity',
      label: `${entity.label} was named once`,
      detail:
        'A participant the record mentions a single time may be central or may be noise. Nothing so far distinguishes the two.',
      subjectIds: [entity.id],
      exposure: round(1 - entity.confidence),
    });
  }

  return concerns.sort(
    (left, right) => right.exposure - left.exposure || left.id.localeCompare(right.id),
  );
}

/**
 * One full derivation over a case, composed from the stages above.
 *
 * Each stage reports what it actually did rather than having its prose written
 * for it at the call site — a ledger assembled by the caller drifts from the
 * work, and a ledger that drifts is worse than none. A stage with nothing to do
 * is recorded as skipped with its reason; a stage that throws is recorded as
 * failed and the remaining stages still run.
 */
export function runInferencePass(
  input: CaseState,
  options: InferencePassOptions = {},
): InferencePassResult {
  const state = structuredClone(input);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const maxRecords = options.maxRecords ?? 1_500;
  const auditSteps: string[] = [];
  const stageReports: DerivationStageReport[] = [];

  const snapshot = (): string =>
    JSON.stringify([
      state.observations,
      state.claims,
      state.entities,
      state.worldEdges,
      state.unresolvedReferences,
      state.assumptions,
      state.beliefs,
      state.beliefEdges,
      state.reconstructions,
      state.anomalies,
      state.temporalConstraints,
    ]);
  const before = snapshot();

  const scope = options.evidenceScope ? new Set(options.evidenceScope) : null;
  const inScope = <T extends { sourceEvidenceId: string }>(record: T): boolean =>
    scope === null || scope.has(record.sourceEvidenceId);
  const scopedObservations = state.observations.filter(inScope);
  const scopedClaims = state.claims.filter(inScope);
  const totalRecords = scopedObservations.length + scopedClaims.length;
  const observationBudget = Math.min(scopedObservations.length, maxRecords);
  const claimBudget = Math.max(0, maxRecords - observationBudget);
  const observations = scopedObservations.slice(0, observationBudget);
  const claims = scopedClaims.slice(0, claimBudget);
  if (totalRecords > maxRecords) {
    auditSteps.push(
      `INGESTOR bounded this pass to ${maxRecords} of ${totalRecords} records; the remainder is untouched, not summarized.`,
    );
  }

  interface StageOutcome {
    status: 'completed' | 'skipped';
    detail: string;
    inputIds?: string[];
    outputIds?: string[];
  }

  const runStage = (agent: AgentName, stage: () => StageOutcome): void => {
    const startedAt = performance.now();
    try {
      const outcome = stage();
      stageReports.push({
        agent,
        status: outcome.status,
        detail: outcome.detail,
        inputIds: outcome.inputIds ?? [],
        outputIds: outcome.outputIds ?? [],
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      });
      auditSteps.push(`${agent} · ${outcome.detail}`);
    } catch (error) {
      const detail = `failed and was skipped: ${error instanceof Error ? error.message : String(error)}. The remaining stages still ran.`;
      stageReports.push({
        agent,
        status: 'failed',
        detail,
        inputIds: [],
        outputIds: [],
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      });
      auditSteps.push(`${agent} · ${detail}`);
    }
  };

  let mentions: EntityMention[] = [];
  runStage('INGESTOR', () => {
    if (observations.length === 0 && claims.length === 0) {
      return { status: 'skipped', detail: 'No observations or claims are in scope.' };
    }
    mentions = extractEntityMentions(observations, claims);
    return {
      status: 'completed',
      detail: `Read ${mentions.length} surface mention${mentions.length === 1 ? '' : 's'} from ${observations.length} observation${observations.length === 1 ? '' : 's'} and ${claims.length} claim${claims.length === 1 ? '' : 's'}.`,
      inputIds: [...observations.map((item) => item.id), ...claims.map((item) => item.id)],
      outputIds: mentions.map((mention) => mention.sourceRecordId),
    };
  });

  runStage('RESOLVER', () => {
    if (mentions.length === 0) {
      return { status: 'skipped', detail: 'No mentions were available to resolve.' };
    }
    const resolution = resolveEntities(mentions, state.entities, {
      caseId: state.metadata.id,
    });
    state.entities = resolution.entities;
    const added = mergeById(state.unresolvedReferences, resolution.references);
    return {
      status: 'completed',
      detail: `Holds ${state.entities.length} entit${state.entities.length === 1 ? 'y' : 'ies'} and left ${added} new reference${added === 1 ? '' : 's'} unresolved rather than merging them.`,
      inputIds: mentions.map((mention) => mention.id),
      outputIds: state.entities.map((entity) => entity.id),
    };
  });

  runStage('CHRONOLOGIST', () => {
    let filled = 0;
    const capturedAtOf = (evidenceId: string): TimeInterval | null =>
      state.evidence.find((item) => item.id === evidenceId)?.capturedAt ?? null;
    for (const observation of observations) {
      if (observation.interval) continue;
      const interval = extractTemporalInterval(
        observation.text,
        capturedAtOf(observation.sourceEvidenceId),
      );
      if (!interval) continue;
      const record = state.observations.find((item) => item.id === observation.id);
      if (record) {
        record.interval = interval;
        observation.interval = interval;
        filled += 1;
      }
    }
    for (const claim of claims) {
      if (claim.interval) continue;
      const interval = extractTemporalInterval(
        claimSourceLine(state, claim),
        capturedAtOf(claim.sourceEvidenceId),
      );
      if (!interval) continue;
      const record = state.claims.find((item) => item.id === claim.id);
      if (record) {
        record.interval = interval;
        claim.interval = interval;
        filled += 1;
      }
    }
    const temporal = deriveTemporalConstraints(state);
    state.temporalConstraints = temporal.constraints;
    if (filled === 0 && temporal.constraints.length === 0) {
      return {
        status: 'skipped',
        detail: 'No record in scope carries a time, so there is nothing to order.',
      };
    }
    return {
      status: 'completed',
      detail: temporal.consistent
        ? `Placed ${filled} record${filled === 1 ? '' : 's'} in time from timestamps their sources already carried and found ${temporal.constraints.length} interval constraint${temporal.constraints.length === 1 ? '' : 's'} consistent.`
        : `Placed ${filled} record${filled === 1 ? '' : 's'} in time and found the interval network inconsistent: ${temporal.contradictions.slice(0, 3).join('; ')}.`,
      outputIds: temporal.constraints.map((constraint) => constraint.id),
    };
  });

  runStage('LINKER', () => {
    if (state.entities.length === 0 || mentions.length === 0) {
      return {
        status: 'skipped',
        detail: 'No resolved participants were available to relate.',
      };
    }
    const derived = deriveWorldEdges({
      caseId: state.metadata.id,
      observations,
      claims,
      entities: state.entities,
      mentions,
      evidence: state.evidence,
      timestamp,
    });
    const addedEdges = mergeById(state.worldEdges, derived.edges);
    for (const assumption of derived.assumptions) {
      const existing = state.assumptions.find((item) => item.id === assumption.id);
      if (!existing) {
        state.assumptions.push(assumption);
        continue;
      }
      existing.sourceEvidenceIds = [
        ...new Set([...existing.sourceEvidenceIds, ...assumption.sourceEvidenceIds]),
      ];
    }
    return {
      status: 'completed',
      detail: `Derived ${addedEdges} new relationship${addedEdges === 1 ? '' : 's'}, each bound to its sources and to the assumption it required.`,
      inputIds: state.entities.map((entity) => entity.id),
      outputIds: derived.edges.map((edge) => edge.id),
    };
  });

  runStage('FALSIFIER', () => {
    if (state.worldEdges.length === 0 && state.claims.length < 2) {
      return { status: 'skipped', detail: 'The case holds nothing that could conflict.' };
    }
    const contradictions = detectContradictions(state);
    const added = mergeById(state.beliefs, contradictions.beliefs);
    mergeById(state.assumptions, contradictions.assumptions);
    for (const edgeId of contradictions.disputedEdgeIds) {
      const edge = state.worldEdges.find((item) => item.id === edgeId);
      if (edge) edge.disputed = true;
    }
    return {
      status: 'completed',
      detail: `Found ${added} new contradiction${added === 1 ? '' : 's'} and marked ${contradictions.disputedEdgeIds.length} relationship${contradictions.disputedEdgeIds.length === 1 ? '' : 's'} disputed.`,
      inputIds: state.worldEdges.map((edge) => edge.id),
      outputIds: contradictions.beliefs.map((belief) => belief.id),
    };
  });

  runStage('HYPOTHESIS ENGINE', () => {
    const explainable =
      state.beliefs.some((belief) => belief.kind === 'contradiction') ||
      state.unresolvedReferences.some(
        (reference) =>
          reference.status !== 'resolved' && reference.candidateBindings.length >= 2,
      );
    if (!explainable) {
      return {
        status: 'skipped',
        detail:
          'Nothing is in tension and no identity is open, so there is nothing to explain.',
      };
    }
    const abduction = abduceHypotheses(state);
    const added = mergeById(state.beliefs, abduction.beliefs);
    mergeById(state.beliefEdges, abduction.beliefEdges);
    const authored = state.reconstructions.filter(
      (item) => !item.id.startsWith(DERIVED_RECONSTRUCTION_PREFIX),
    );
    if (authored.length === 0) {
      const rebuilt = buildReconstructions(state, { timestamp });
      // `updatedAt` means "when this account last changed", so an account whose
      // content is identical keeps its original stamp.
      const withoutStamps = (items: Reconstruction[]): string =>
        JSON.stringify(items.map(({ updatedAt: _ignored, ...rest }) => rest));
      if (withoutStamps(rebuilt) !== withoutStamps(state.reconstructions)) {
        state.reconstructions = rebuilt;
      }
    }
    return {
      status: 'completed',
      detail:
        authored.length > 0
          ? `Offered ${added} competing explanation${added === 1 ? '' : 's'} and left ${authored.length} authored account${authored.length === 1 ? '' : 's'} untouched.`
          : `Offered ${added} competing explanation${added === 1 ? '' : 's'} and rebuilt ${state.reconstructions.length} account${state.reconstructions.length === 1 ? '' : 's'} without selecting one.`,
      outputIds: abduction.beliefs.map((belief) => belief.id),
    };
  });

  runStage('INVESTIGATOR', () => {
    const ranked = rankOpenQuestions(state);
    if (ranked.length === 0 && state.anomalies.length === 0) {
      return {
        status: 'skipped',
        detail: 'The case raises no answerable question yet.',
      };
    }
    const rankedById = new Map(ranked.map((anomaly) => [anomaly.id, anomaly] as const));
    // An answered question keeps its answer, and a question the engine did not
    // derive is never dropped just because this pass did not re-derive it.
    const merged = state.anomalies.map((existing) => {
      const fresh = rankedById.get(existing.id);
      if (!fresh) return existing;
      rankedById.delete(existing.id);
      return { ...fresh, status: existing.status, lastResult: existing.lastResult };
    });
    const added = [...rankedById.values()];
    state.anomalies = [...merged, ...added].sort(
      (first, second) =>
        second.expectedInformationGain - first.expectedInformationGain ||
        first.id.localeCompare(second.id),
    );
    return {
      status: 'completed',
      detail: `Ranked ${state.anomalies.length} open question${state.anomalies.length === 1 ? '' : 's'} by expected information gain (${added.length} newly derived).`,
      outputIds: state.anomalies.map((anomaly) => anomaly.id),
    };
  });

  const concerns = assessDerivation(state);
  if (concerns.length > 0) {
    auditSteps.push(
      `CRITIC · ${concerns.length} weak point${concerns.length === 1 ? '' : 's'} in the derivation, led by: ${concerns[0]?.label ?? ''}.`,
    );
  }

  if (before === snapshot()) {
    return {
      state,
      revision: null,
      auditSteps: [...auditSteps, 'No derivation changed the case; nothing was persisted.'],
      stageReports,
      concerns,
    };
  }

  const sequence = state.metadata.revision + 1;
  const revision: CaseRevision = {
    id: `REV-${String(sequence).padStart(3, '0')}`,
    caseId: state.metadata.id,
    sequence,
    createdAt: timestamp,
    title: 'Derivation pass over the case record',
    summary: `${state.entities.length} entities, ${state.worldEdges.length} relationships, ${state.beliefs.filter((belief) => belief.kind === 'contradiction').length} contradictions, and ${state.anomalies.length} open questions now stand on the record.`,
    triggerEvidenceId: null,
    changes: [
      {
        id: `REV-${String(sequence).padStart(3, '0')}-C1`,
        kind: 'edge',
        subjectId: state.metadata.id,
        label: 'Derived world relationships',
        before: null,
        after: `${state.worldEdges.length} relationships across ${state.entities.length} entities`,
        direction: 'added',
      },
    ],
    trace: stageReports.slice(0, 6).map((report, index) => ({
      id: `REV-${String(sequence).padStart(3, '0')}-T${index + 1}`,
      kind: 'evidence' as const,
      label: `${report.agent} · ${report.detail}`,
      relation: `was recorded as ${report.status} during the derivation pass`,
    })),
  };
  state.revisions.unshift(revision);
  state.metadata.revision = sequence;
  state.metadata.updatedAt = timestamp;

  return { state, revision, auditSteps, stageReports, concerns };
}

const ISO_INSTANT =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/u;
const CALENDAR_DATE = /\d{4}-\d{2}-\d{2}/u;
const CLOCK_TIME = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\d:])/u;

/**
 * A time interval read out of free text.
 *
 * The rule that matters is the refusal: a bare clock time with nothing to
 * anchor it to a day yields `null`. Picking a date would manufacture the
 * precision the source never had.
 */
export function extractTemporalInterval(
  text: string,
  anchor: TimeInterval | null,
): TimeInterval | null {
  const instant = ISO_INSTANT.exec(text);
  if (instant) {
    const parsed = Date.parse(instant[0]);
    if (!Number.isNaN(parsed)) {
      const iso = new Date(parsed).toISOString();
      return { earliest: iso, latest: iso, precision: 'exact', confidence: 0.95 };
    }
  }

  const date = CALENDAR_DATE.exec(text);
  const clock = CLOCK_TIME.exec(text);
  const day = date?.[0] ?? anchor?.earliest.slice(0, 10) ?? null;

  if (clock && day) {
    const hours = clock[1]?.padStart(2, '0') ?? '00';
    const minutes = clock[2] ?? '00';
    const seconds = clock[3];
    if (seconds) {
      const iso = `${day}T${hours}:${minutes}:${seconds}.000Z`;
      return Number.isNaN(Date.parse(iso))
        ? null
        : { earliest: iso, latest: iso, precision: 'exact', confidence: 0.9 };
    }
    const earliest = `${day}T${hours}:${minutes}:00.000Z`;
    const latest = `${day}T${hours}:${minutes}:59.999Z`;
    return Number.isNaN(Date.parse(earliest))
      ? null
      : { earliest, latest, precision: 'minute', confidence: 0.85 };
  }

  if (date) {
    const earliest = `${date[0]}T00:00:00.000Z`;
    const latest = `${date[0]}T23:59:59.999Z`;
    return Number.isNaN(Date.parse(earliest))
      ? null
      : { earliest, latest, precision: 'day', confidence: 0.6 };
  }

  return null;
}

/**
 * The full source line a claim was quoted from. Line-level extraction drops a
 * leading timestamp out of the quotation, and that timestamp is exactly what
 * makes the claim placeable.
 */
function claimSourceLine(state: CaseState, claim: Claim): string {
  const artifact = state.evidence.find((item) => item.id === claim.sourceEvidenceId);
  if (!artifact?.content) return claim.verbatim;
  const line = artifact.content
    .split(/\r?\n/u)
    .find((candidate) => candidate.includes(claim.verbatim));
  return line ?? claim.verbatim;
}

export interface ChallengeOptions {
  /** The artifact that broke the assumption, when one did. */
  evidenceId?: string;
  timestamp?: string;
}

/**
 * Invalidates an assumption and lets the consequences fall where they fall.
 *
 * This is the general form of the scripted Evidence 143 cascade: any warrant in
 * any case can be attacked, and everything resting on it is reduced through the
 * same ATMS machinery rather than through a hand-written transition. The engine
 * does not decide the assumption is false — an investigator does — but it is
 * responsible for propagating that decision honestly.
 */
export function challengeAssumption(
  input: CaseState,
  assumptionId: string,
  options: ChallengeOptions = {},
): MutationResult {
  const state = structuredClone(input);
  const assumption = state.assumptions.find((item) => item.id === assumptionId);
  if (!assumption) {
    throw new Error(`Unknown assumption: ${assumptionId}`);
  }
  if (assumption.status === 'invalid') {
    return {
      state,
      revision: null,
      auditSteps: [`${assumptionId} was already invalid; nothing cascaded.`],
    };
  }

  const timestamp = options.timestamp ?? new Date().toISOString();
  assumption.status = 'invalid';
  assumption.invalidatedByEvidenceId = options.evidenceId ?? null;
  if (options.evidenceId && !assumption.sourceEvidenceIds.includes(options.evidenceId)) {
    assumption.sourceEvidenceIds.push(options.evidenceId);
  }

  const invalidIds = new Set(
    state.assumptions.filter((item) => item.status === 'invalid').map((item) => item.id),
  );
  const beliefsBefore = new Map(
    state.beliefs.map((belief) => [belief.id, belief.status] as const),
  );
  state.beliefs = propagateNogood(state.beliefs, invalidIds);
  const rejected = state.beliefs.filter(
    (belief) => belief.status === 'rejected' && beliefsBefore.get(belief.id) !== 'rejected',
  );
  const weakened = state.beliefs.filter(
    (belief) => belief.status === 'weakened' && beliefsBefore.get(belief.id) !== 'weakened',
  );

  const dependent = state.worldEdges.filter((edge) =>
    edge.assumptionIds.includes(assumptionId),
  );
  const edgeChanges: CaseRevision['changes'] = [];
  const labelOf = (entityId: string): string =>
    state.entities.find((entity) => entity.id === entityId)?.label ?? entityId;

  for (const edge of dependent) {
    const before = edge.confidence;
    // An edge that rested on several warrants does not fall as far as one that
    // rested only on this.
    const share = 1 / Math.max(1, edge.assumptionIds.length);
    edge.confidence = round(edge.confidence * (1 - 0.7 * share), 2);
    edge.disputed = true;
    edge.transactionTime = timestamp;
    edge.contributions.push({
      sourceId: assumptionId,
      label: `${assumption.label} no longer holds`,
      weight: round(0.7 * share, 2),
      polarity: 'oppose',
    });
    edgeChanges.push({
      id: `CHANGE-${edge.id}`,
      kind: 'edge',
      subjectId: edge.id,
      label: `${labelOf(edge.subjectId)} → ${labelOf(edge.objectId)}`,
      before: `${Math.round(before * 100)}%`,
      after: `${Math.round(edge.confidence * 100)}%`,
      direction: 'lowered',
    });
  }

  const disputedEdgeIds = new Set(dependent.map((edge) => edge.id));
  let restatedStatements = 0;
  for (const reconstruction of state.reconstructions) {
    if (reconstruction.id.startsWith(DERIVED_RECONSTRUCTION_PREFIX)) continue;
    // Authored accounts keep their prose; only the support labels move.
    reconstruction.statements = reconstruction.statements.map((statement) => {
      if (statement.status === 'DISPUTED') return statement;
      if (!statement.sourceIds.some((id) => disputedEdgeIds.has(id))) return statement;
      restatedStatements += 1;
      return { ...statement, status: 'DISPUTED' };
    });
    reconstruction.contradictions = reconstruction.statements.filter(
      (statement) => statement.status === 'DISPUTED',
    ).length;
    reconstruction.updatedAt = timestamp;
  }

  const derivedCount = state.reconstructions.filter((item) =>
    item.id.startsWith(DERIVED_RECONSTRUCTION_PREFIX),
  ).length;
  if (derivedCount > 0 || state.reconstructions.length === 0) {
    const rebuilt = buildReconstructions(state, { timestamp });
    state.reconstructions = [
      ...state.reconstructions.filter(
        (item) => !item.id.startsWith(DERIVED_RECONSTRUCTION_PREFIX),
      ),
      ...rebuilt,
    ];
  }

  const sequence = state.metadata.revision + 1;
  const revisionId = `REV-${String(sequence).padStart(3, '0')}`;
  const revision: CaseRevision = {
    id: revisionId,
    caseId: state.metadata.id,
    sequence,
    createdAt: timestamp,
    title: `Challenged: ${assumption.label}`,
    summary: `${dependent.length} relationship${dependent.length === 1 ? '' : 's'}, ${rejected.length} rejected and ${weakened.length} weakened belief${weakened.length === 1 ? '' : 's'} followed the assumption down.`,
    triggerEvidenceId: options.evidenceId ?? null,
    changes: [
      {
        id: `${revisionId}-C1`,
        kind: 'assumption',
        subjectId: assumptionId,
        label: assumption.label,
        before: 'Valid',
        after: 'Invalid',
        direction: 'invalidated',
      },
      ...edgeChanges.map((change, index) => ({
        ...change,
        id: `${revisionId}-C${index + 2}`,
      })),
    ],
    trace: [
      {
        id: `${revisionId}-T1`,
        kind: 'assumption',
        label: assumption.label,
        relation: 'was invalidated by the investigator',
      },
      {
        id: `${revisionId}-T2`,
        kind: 'evidence',
        label: `${dependent.length} relationship${dependent.length === 1 ? '' : 's'} rested on it`,
        relation: 'lost the share of their confidence it carried',
      },
      {
        id: `${revisionId}-T3`,
        kind: 'hypothesis',
        label: `${rejected.length} belief${rejected.length === 1 ? '' : 's'} lost every surviving environment`,
        relation: 'were rejected by ATMS nogood propagation',
      },
      {
        id: `${revisionId}-T4`,
        kind: 'reconstruction',
        label: `${restatedStatements} authored statement${restatedStatements === 1 ? '' : 's'} became disputed`,
        relation: 'and the derived accounts were rebuilt',
      },
    ],
  };
  state.revisions.unshift(revision);
  state.metadata.revision = sequence;
  state.metadata.updatedAt = timestamp;

  return {
    state,
    revision,
    auditSteps: [
      `FALSIFIER marked ${assumptionId} as an ATMS nogood.`,
      `${rejected.length} belief${rejected.length === 1 ? '' : 's'} lost every surviving environment; ${weakened.length} ${weakened.length === 1 ? 'was' : 'were'} weakened.`,
      `LINKER reduced ${dependent.length} dependent relationship${dependent.length === 1 ? '' : 's'} and recorded an opposing contribution on each.`,
      `HYPOTHESIS ENGINE rebuilt ${derivedCount} derived account${derivedCount === 1 ? '' : 's'} and restated ${restatedStatements} authored statement${restatedStatements === 1 ? '' : 's'}.`,
    ],
  };
}
