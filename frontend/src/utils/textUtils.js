/**
 * textUtils.js — Hebrew text segmentation
 *
 * Strategy:
 *   1. Split on paragraph breaks (blank lines)
 *   2. Within each paragraph, split on Hebrew/Latin sentence-ending punctuation
 *   3. Long lines without punctuation are split on commas, then on word boundaries
 */

/** Sentence-ending punctuation: . ! ? and ׃ (Unicode sof pasuk U+05C3) */
const SENTENCE_END_RE = /(?<=[.!?׃])\s+/;

/** Comma-like pauses */
const CLAUSE_BREAK_RE = /(?<=[,،؛;])\s+/;

/** Max chars before forcing a word-boundary split */
const MAX_CHUNK = 100;

/**
 * Split raw Hebrew text into an array of readable segments.
 * Each segment is a non-empty trimmed string.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function segmentText(text) {
  if (!text || !text.trim()) return [];

  // Normalise line endings
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into paragraphs at two or more blank lines
  const paragraphs = normalised.split(/\n{2,}/).filter((p) => p.trim());

  const segments = [];

  for (const para of paragraphs) {
    // Treat each non-empty line within a paragraph independently
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      // Try sentence-ending split first
      const sentences = line
        .split(SENTENCE_END_RE)
        .map((s) => s.trim())
        .filter(Boolean);

      if (sentences.length > 1) {
        segments.push(...sentences);
        continue;
      }

      // Short enough to stay as one segment
      if (line.length <= MAX_CHUNK) {
        segments.push(line);
        continue;
      }

      // Try comma/clause split
      const clauses = line
        .split(CLAUSE_BREAK_RE)
        .map((s) => s.trim())
        .filter(Boolean);

      if (clauses.length > 1) {
        segments.push(...clauses);
        continue;
      }

      // Last resort: split at word boundaries every MAX_CHUNK chars
      const words = line.split(/\s+/);
      let chunk = '';
      for (const word of words) {
        const candidate = chunk ? `${chunk} ${word}` : word;
        if (chunk && candidate.length > MAX_CHUNK) {
          segments.push(chunk);
          chunk = word;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) segments.push(chunk);
    }
  }

  return segments.filter((s) => s.trim().length > 0);
}
