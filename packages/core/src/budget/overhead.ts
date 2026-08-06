import { estimateFast } from '../tokens/fastEstimator.js';

/** Base token overhead for output metadata (preamble, XML/Markdown wrapper tags).
 *  Empirically: XML preamble + metadata ~40-60 tokens; 50 is a conservative estimate. */
const METADATA_BASE_TOKENS = 50;

/** Tree tokens scale linearly: ~50 tokens per 10 candidate files. */
const TREE_TOKENS_PER_10_FILES = 50;

export function estimateOverhead(
  candidateCount: number,
  headerText: string,
  instructionContent: string,
): number {
  const metadataTokens    = METADATA_BASE_TOKENS;
  const headerTokens      = estimateFast(headerText);
  const treeTokens        = Math.ceil((candidateCount / 10) * TREE_TOKENS_PER_10_FILES);
  const instructionTokens = estimateFast(instructionContent);
  return metadataTokens + headerTokens + treeTokens + instructionTokens;
}
