import type { EvidenceKind } from './types.js';

const mediaKindByPrefix: ReadonlyArray<readonly [string, EvidenceKind]> = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
];

const extensionGroups: ReadonlyArray<readonly [RegExp, EvidenceKind]> = [
  [/\.(?:eml|msg)$/iu, 'email'],
  [/\.(?:ics)$/iu, 'calendar'],
  [/\.(?:gpx|kml|kmz|geojson)$/iu, 'location'],
  [/\.(?:mbox|chat|sms)$/iu, 'message'],
  [/\.(?:jpg|jpeg|png|gif|webp|heic|heif|tif|tiff|bmp|avif)$/iu, 'image'],
  [/\.(?:mp4|mov|m4v|avi|mkv|webm|mpeg|mpg)$/iu, 'video'],
  [/\.(?:mp3|m4a|wav|aac|flac|ogg|opus|aiff|wma)$/iu, 'audio'],
  [
    /\.(?:txt|md|csv|tsv|json|jsonl|xml|ya?ml|log|pdf|docx?|odt|rtf|xlsx?|ods|pptx?|odp|zip|7z|rar|tar|gz)$/iu,
    'document',
  ],
];

/**
 * Classifies only the artifact container. It does not infer what happened in
 * the world and deliberately returns `other` when the container is unknown.
 */
export function inferEvidenceKind(fileName: string, mimeType = ''): EvidenceKind {
  const normalizedMime = mimeType.toLocaleLowerCase().trim();
  for (const [prefix, kind] of mediaKindByPrefix) {
    if (normalizedMime.startsWith(prefix)) return kind;
  }
  if (normalizedMime === 'message/rfc822') return 'email';
  if (normalizedMime === 'text/calendar') return 'calendar';
  for (const [pattern, kind] of extensionGroups) {
    if (pattern.test(fileName)) return kind;
  }
  if (
    normalizedMime.startsWith('text/') ||
    [
      'application/json',
      'application/pdf',
      'application/rtf',
      'application/xml',
      'application/zip',
    ].includes(normalizedMime)
  ) {
    return 'document';
  }
  return 'other';
}

/**
 * Escalates only hard container mismatches. Semantic categories such as a log
 * or message may share a text container and should not interrupt ingestion.
 */
export function isMaterialEvidenceKindConflict(
  submittedKind: EvidenceKind,
  detectedKind: EvidenceKind,
): boolean {
  if (
    submittedKind === detectedKind ||
    submittedKind === 'other' ||
    detectedKind === 'other'
  ) {
    return false;
  }
  const hardKinds = new Set<EvidenceKind>(['image', 'video', 'audio']);
  return hardKinds.has(submittedKind) || hardKinds.has(detectedKind);
}
