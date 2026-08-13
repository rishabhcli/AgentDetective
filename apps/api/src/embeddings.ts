import { env as transformersEnvironment, pipeline } from '@huggingface/transformers';

export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

type FeatureExtractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

let extractorPromise: Promise<FeatureExtractor> | null = null;
let activeCacheDirectory = '';

function getExtractor(cacheDirectory: string): Promise<FeatureExtractor> {
  if (extractorPromise && activeCacheDirectory === cacheDirectory) return extractorPromise;
  activeCacheDirectory = cacheDirectory;
  transformersEnvironment.cacheDir = cacheDirectory;
  transformersEnvironment.allowLocalModels = true;
  transformersEnvironment.allowRemoteModels = true;
  extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL);
  return extractorPromise;
}

export async function embedTexts(
  texts: readonly string[],
  cacheDirectory: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor(cacheDirectory);
  const tensor = await extractor([...texts], { pooling: 'mean', normalize: true });
  const rows = tensor.tolist() as number[][];
  if (
    rows.length !== texts.length ||
    rows.some((row) => row.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new Error(
      `Local embedding model returned an unexpected shape; expected ${texts.length} × ${EMBEDDING_DIMENSIONS}.`,
    );
  }
  return rows;
}

export async function prewarmEmbeddingModel(cacheDirectory: string): Promise<void> {
  await embedTexts(['THREAD local semantic retrieval model preflight'], cacheDirectory);
}

export function embeddingRuntimeStatus() {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    loaded: extractorPromise !== null,
    cacheDirectory: activeCacheDirectory || null,
  };
}
