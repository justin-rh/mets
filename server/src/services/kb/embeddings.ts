// Local sentence embeddings via transformers.js (all-MiniLM-L6-v2, 384 dims).
// No external API: Anthropic doesn't offer embeddings, and a 23MB local model
// is plenty for ~10^2 KB articles. Model downloads to the HF cache on first use.
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  extractor ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });
  return extractor;
}

/** Embed texts into unit-normalized 384-dim vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  const model = await getExtractor();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const n = output.dims[0] ?? 0;
  const dim = output.dims[1] ?? 0;
  const data = output.data as Float32Array;
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) rows.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  return rows;
}
