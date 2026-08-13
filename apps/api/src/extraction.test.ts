import { createSampleCase } from '@thread/domain';
import { describe, expect, it } from 'vitest';
import { extractUpload } from './extraction.js';
import type { ProviderHub, VisualExtraction } from './providers.js';

// 1x1 PNG. Small enough that EXIF parsing finds nothing, which is exactly the
// path that must still reach the visual extractor.
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function imageUpload(buffer: Buffer): Express.Multer.File {
  return {
    originalname: 'frame.png',
    mimetype: 'image/png',
    buffer,
    size: buffer.byteLength,
  } as Express.Multer.File;
}

function providerStub(overrides: {
  fireworksActive: boolean;
  extractVisual?: () => Promise<VisualExtraction>;
}): ProviderHub {
  return {
    isActive: (id: string) => id === 'fireworks' && overrides.fireworksActive,
    extractVisual:
      overrides.extractVisual ??
      (() =>
        Promise.resolve({
          observations: [
            {
              kind: 'visual' as const,
              text: 'Timestamp overlay reads 21:06:14.',
              locator: 'upper-left region',
              extractionConfidence: 0.9,
              mentionedEntities: [],
              uncertainty: 'Overlay text is legible; the clock source is unverified.',
            },
          ],
          warnings: ['No scene detail is visible outside the overlays.'],
        })),
  } as unknown as ProviderHub;
}

describe('image extraction', () => {
  it('reaches the visual extractor when Fireworks is active', async () => {
    const result = await extractUpload({
      file: imageUpload(tinyPng),
      rawLocator: '/tmp/thread-test-frame.png',
      state: createSampleCase(),
      providers: providerStub({ fireworksActive: true }),
    });

    expect(result.extractor).toBe('fireworks');
    expect(result.extractionStatus).toBe('complete');
    expect(result.externalObservations).toHaveLength(1);
    expect(result.externalObservations[0]?.text).toContain('21:06:14');
    expect(result.externalObservations[0]?.text).toContain('Uncertainty:');
  });

  // A metadata decoder fault once aborted the whole image branch before any
  // Fireworks call. Note that vite synthesizes named exports for CommonJS, so
  // this suite cannot reproduce the original import-interop fault itself — only
  // the isolation that keeps any such fault from suppressing extraction.
  it('keeps a metadata fault from suppressing the visual extractor', async () => {
    const corrupt = Buffer.concat([tinyPng.subarray(0, 8), Buffer.from('not-an-image')]);
    const result = await extractUpload({
      file: imageUpload(corrupt),
      rawLocator: '/tmp/thread-test-corrupt.png',
      state: createSampleCase(),
      providers: providerStub({ fireworksActive: true }),
    });

    expect(result.extractor).toBe('fireworks');
    expect(result.externalObservations).toHaveLength(1);
  });

  it('records an honest unprocessed marker when Fireworks is inactive', async () => {
    const result = await extractUpload({
      file: imageUpload(tinyPng),
      rawLocator: '/tmp/thread-test-inactive.png',
      state: createSampleCase(),
      providers: providerStub({ fireworksActive: false }),
    });

    expect(result.extractor).toBe('local-deterministic');
    expect(result.externalObservations).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('not active');
  });

  it('never promotes a failed visual extraction into a fabricated observation', async () => {
    const result = await extractUpload({
      file: imageUpload(tinyPng),
      rawLocator: '/tmp/thread-test-failure.png',
      state: createSampleCase(),
      providers: providerStub({
        fireworksActive: true,
        extractVisual: () => Promise.reject(new Error('provider exploded')),
      }),
    });

    expect(result.extractor).toBe('local-deterministic');
    expect(result.extractionStatus).not.toBe('complete');
    expect(result.externalObservations).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('provider exploded');
  });
});
