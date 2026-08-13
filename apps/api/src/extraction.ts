import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { type CaseState, type EvidenceArtifact, type Observation } from '@thread/domain';
// exifr ships CommonJS: the ESM namespace exposes only `default`, so a star
// import leaves `parse` undefined and throws synchronously past any `.catch`.
import exifr from 'exifr';
import JSZip from 'jszip';
import { simpleParser } from 'mailparser';
import mammoth from 'mammoth';
import { parseBuffer } from 'music-metadata';
import { PDFParse } from 'pdf-parse';
import { type ProviderHub } from './providers.js';

const runFile = promisify(execFile);
const maximumDecodedCharacters = 200_000;

export interface ExtractedUpload {
  content: string | null;
  extractionStatus: EvidenceArtifact['extractionStatus'];
  extractor: EvidenceArtifact['extractor'];
  providerModel: string | null;
  externalObservations: Array<{
    kind: Observation['kind'];
    text: string;
    locator: string;
    extractionConfidence: number;
    entityIds?: string[];
    materialWeight?: number;
  }>;
  warnings: string[];
}

function bounded(value: string): string | null {
  const cleaned = value.replaceAll('\u0000', '').trim();
  return cleaned ? cleaned.slice(0, maximumDecodedCharacters) : null;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown extraction error';
}

function metadataValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function entityIdsFor(mentions: string[], state: CaseState): string[] {
  const normalizedMentions = mentions.map((mention) => mention.toLocaleLowerCase());
  return state.entities
    .filter((entity) => {
      const labels = [entity.label, entity.shortLabel, ...entity.aliases].map((label) =>
        label.toLocaleLowerCase(),
      );
      return labels.some((label) =>
        normalizedMentions.some(
          (mention) =>
            mention === label || mention.includes(label) || label.includes(mention),
        ),
      );
    })
    .map((entity) => entity.id);
}

async function parsePdf(buffer: Buffer): Promise<string | null> {
  const parser = new PDFParse({ data: Uint8Array.from(buffer) });
  try {
    const result = await parser.getText();
    return bounded(result.text);
  } finally {
    await parser.destroy();
  }
}

async function parseEmail(buffer: Buffer): Promise<string | null> {
  const message = await simpleParser(buffer);
  const to = Array.isArray(message.to)
    ? message.to.map((address) => address.text).join(', ')
    : message.to?.text;
  const header = [
    message.subject ? `Subject: ${message.subject}` : null,
    message.from?.text ? `From: ${message.from.text}` : null,
    to ? `To: ${to}` : null,
    message.date ? `Date: ${message.date.toISOString()}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return bounded(`${header}\n\n${message.text ?? ''}`);
}

async function parseArchive(buffer: Buffer): Promise<string | null> {
  const archive = await JSZip.loadAsync(buffer);
  const records: string[] = [];
  for (const entry of Object.values(archive.files).slice(0, 100)) {
    if (entry.dir) continue;
    records.push(`[archive member] ${entry.name}`);
    if (!/\.(?:txt|md|csv|json|log|xml|ya?ml|ics|eml)$/iu.test(entry.name)) continue;
    const text = await entry.async('string');
    records.push(text.slice(0, 20_000));
    if (records.join('\n').length >= maximumDecodedCharacters) break;
  }
  return bounded(records.join('\n'));
}

async function localOcr(rawLocator: string): Promise<string | null> {
  const result = await runFile('tesseract', [rawLocator, 'stdout', '--psm', '6'], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
  return bounded(result.stdout);
}

function isPlainText(file: Express.Multer.File): boolean {
  const extension = extname(file.originalname).toLocaleLowerCase();
  return (
    file.mimetype.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/rtf', 'text/calendar'].includes(
      file.mimetype,
    ) ||
    /\.(?:txt|md|csv|json|log|mbox|ics|xml|ya?ml|rtf)$/u.test(extension)
  );
}

export async function extractUpload(input: {
  file: Express.Multer.File;
  rawLocator: string;
  state: CaseState;
  providers: ProviderHub;
}): Promise<ExtractedUpload> {
  const { file, providers, rawLocator, state } = input;
  const extension = extname(file.originalname).toLocaleLowerCase();
  const result: ExtractedUpload = {
    content: null,
    extractionStatus: 'requires-adapter',
    extractor: 'local-deterministic',
    providerModel: null,
    externalObservations: [],
    warnings: [],
  };

  try {
    if (isPlainText(file)) {
      result.content = bounded(file.buffer.toString('utf8'));
      result.extractionStatus = 'bounded-local';
      return result;
    }
    if (file.mimetype === 'application/pdf' || extension === '.pdf') {
      result.content = await parsePdf(file.buffer);
      result.extractionStatus = result.content ? 'bounded-local' : 'requires-adapter';
      return result;
    }
    if (
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      extension === '.docx'
    ) {
      const document = await mammoth.extractRawText({ buffer: file.buffer });
      result.content = bounded(document.value);
      result.warnings.push(...document.messages.map((message) => message.message));
      result.extractionStatus = result.content ? 'bounded-local' : 'requires-adapter';
      return result;
    }
    if (file.mimetype === 'message/rfc822' || extension === '.eml') {
      result.content = await parseEmail(file.buffer);
      result.extractionStatus = result.content ? 'bounded-local' : 'requires-adapter';
      return result;
    }
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      extension === '.zip'
    ) {
      result.content = await parseArchive(file.buffer);
      result.extractionStatus = result.content ? 'bounded-local' : 'requires-adapter';
      return result;
    }
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      const metadata = await parseBuffer(file.buffer, {
        mimeType: file.mimetype,
        size: file.size,
      }).catch(() => null);
      const transcript = await providers.transcribe(
        file.buffer,
        file.mimetype,
        file.originalname,
        state,
      );
      result.content = bounded(transcript.text);
      result.extractor = 'elevenlabs';
      result.providerModel = 'scribe_v2';
      result.extractionStatus = 'complete';
      result.externalObservations.push({
        kind: 'temporal',
        text: `Verbatim transcript decoded by Scribe v2${transcript.languageCode ? ` (${transcript.languageCode})` : ''}; speaker hedges remain in the source-bound claims.`,
        locator: metadata?.format.duration
          ? `audio stream / 00:00–${metadata.format.duration.toFixed(2)}s`
          : 'audio stream / transcript',
        extractionConfidence: 0.9,
        materialWeight: 1,
      });
      return result;
    }
    if (file.mimetype.startsWith('image/')) {
      // Metadata is a bonus signal. Isolate it so a decoder fault can never
      // suppress the visual extraction path behind it.
      let metadata: Record<string, unknown> | null = null;
      try {
        metadata = (await exifr.parse(file.buffer)) as Record<string, unknown> | null;
      } catch (error) {
        result.warnings.push(`EXIF metadata was unreadable: ${readableError(error)}`);
      }
      if (metadata) {
        const captured = metadata.DateTimeOriginal ?? metadata.CreateDate;
        const latitude = metadata.latitude;
        const longitude = metadata.longitude;
        if (captured) {
          result.externalObservations.push({
            kind: 'temporal',
            text: `Embedded image timestamp: ${metadataValue(captured)}. Metadata is preserved as a source signal, not accepted as ground truth.`,
            locator: 'EXIF / DateTimeOriginal or CreateDate',
            extractionConfidence: 1,
            materialWeight: 1,
          });
        }
        if (typeof latitude === 'number' && typeof longitude === 'number') {
          result.externalObservations.push({
            kind: 'location',
            text: `Embedded GPS coordinate: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}.`,
            locator: 'EXIF / GPSLatitude and GPSLongitude',
            extractionConfidence: 1,
            materialWeight: 1,
          });
        }
      }
      if (providers.isActive('fireworks')) {
        try {
          const extraction = await providers.extractVisual(
            file.buffer,
            file.mimetype,
            file.originalname,
          );
          result.externalObservations.push(
            ...extraction.observations.map((observation) => ({
              kind: observation.kind,
              text: `${observation.text} Uncertainty: ${observation.uncertainty}`,
              locator: observation.locator,
              extractionConfidence: observation.extractionConfidence,
              entityIds: entityIdsFor(observation.mentionedEntities, state),
              materialWeight: 1,
            })),
          );
          result.warnings.push(...extraction.warnings);
          result.extractor = 'fireworks';
          result.providerModel = extraction.model;
          result.extractionStatus = 'complete';
          return result;
        } catch (error) {
          result.warnings.push(
            `Fireworks visual extraction failed: ${readableError(error)}`,
          );
        }
      } else {
        result.warnings.push(
          'Fireworks visual extraction is not active; only deterministic EXIF/OCR extraction was attempted.',
        );
      }
      try {
        result.content = await localOcr(rawLocator);
        result.extractionStatus = result.content ? 'bounded-local' : 'requires-adapter';
      } catch (error) {
        result.warnings.push(`Local OCR produced no usable text: ${readableError(error)}`);
      }
      return result;
    }
  } catch (error) {
    result.warnings.push(`Bounded extractor failed: ${readableError(error)}`);
  }

  return result;
}
