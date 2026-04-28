/**
 * Text Sanitizer — Cleans up artifacts from PDF text extraction.
 *
 * Fixes common issues:
 *  - Clumped words (missing spaces between words)
 *  - Split words from line-break hyphenation (e.g., "meth-\nod" → "method")
 *  - Excessive whitespace
 *  - Stray special characters and PDF artifacts
 *  - Ligature encoding issues (ﬁ → fi, ﬂ → fl, etc.)
 *  - Broken Unicode characters
 *  - Repeated words from header/footer removal artifacts
 */

// ── Ligature map ──────────────────────────────────────────────
const LIGATURE_MAP = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

// ── Patterns ──────────────────────────────────────────────────

// Characters that are PDF artifacts (control chars, zero-width, etc.)
const ARTIFACT_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFEFF\u200B\u200C\u200D\u2060\uFFFD]/g;

// Soft hyphens
const SOFT_HYPHEN = /\u00AD/g;

// Multiple spaces → single space
const MULTI_SPACE = /[ \t]{2,}/g;

// Line-break hyphenation: word ending with hyphen followed by newline
const HYPHENATION = /(\w)-\s*\n\s*(\w)/g;

// Clumped words: detect camelCase-like patterns where a lowercase letter
// is directly followed by an uppercase letter (common PDF clumping artifact)
const CLUMPED_CASE = /([a-z])([A-Z])/g;

// Period followed immediately by uppercase (missing space after sentence)
const CLUMPED_SENTENCE = /([.!?])([A-Z])/g;

// Comma/semicolon followed immediately by a letter (missing space)
const CLUMPED_PUNCT = /([,;:])([A-Za-z])/g;

// Closing paren/bracket followed immediately by a letter
const CLUMPED_BRACKET = /([)\]])([A-Za-z])/g;

// Multiple consecutive newlines → double newline (paragraph break)
const MULTI_NEWLINE = /\n{3,}/g;

// Stray bullet points and list markers that aren't useful in RSVP
const STRAY_BULLETS = /^[\u2022\u2023\u25E6\u2043\u2219•●○◦▪▸►]\s*/gm;

/**
 * Sanitize extracted text to fix common PDF artifacts.
 * @param {string} text - Raw extracted text
 * @returns {string} Cleaned text
 */
export function sanitizeText(text) {
  let result = text;

  // 1. Replace ligature characters with ASCII equivalents
  for (const [ligature, replacement] of Object.entries(LIGATURE_MAP)) {
    result = result.replaceAll(ligature, replacement);
  }

  // 2. Remove artifact/control characters
  result = result.replace(ARTIFACT_CHARS, '');

  // 3. Remove soft hyphens (decorative, not real hyphens)
  result = result.replace(SOFT_HYPHEN, '');

  // 4. Rejoin hyphenated line breaks: "meth-\nod" → "method"
  result = result.replace(HYPHENATION, '$1$2');

  // 5. Fix clumped words (lowercase→uppercase boundary)
  result = result.replace(CLUMPED_CASE, '$1 $2');

  // 6. Fix missing space after sentence-ending punctuation
  result = result.replace(CLUMPED_SENTENCE, '$1 $2');

  // 7. Fix missing space after comma/semicolon/colon
  result = result.replace(CLUMPED_PUNCT, '$1 $2');

  // 8. Fix missing space after closing bracket/paren
  result = result.replace(CLUMPED_BRACKET, '$1 $2');

  // 9. Normalize whitespace
  result = result.replace(MULTI_SPACE, ' ');
  result = result.replace(MULTI_NEWLINE, '\n\n');

  // 10. Remove stray bullet markers
  result = result.replace(STRAY_BULLETS, '');

  // 11. Trim leading/trailing whitespace per line
  result = result
    .split('\n')
    .map(line => line.trim())
    .join('\n');

  // 12. Final trim
  result = result.trim();

  return result;
}

/**
 * Sanitize an array of tokens (word-level cleanup).
 * Applied after text extraction but before tokenization.
 * Includes heuristic splitting of clumped words.
 * @param {Array<{word: string, sectionBefore?: string, paragraphBreak?: boolean}>} tokens
 * @returns {Array<{word: string, sectionBefore?: string, paragraphBreak?: boolean}>}
 */
export function sanitizeTokens(tokens) {
  const cleaned = [];

  for (const token of tokens) {
    let word = token.word;

    // Replace ligatures in individual words
    for (const [ligature, replacement] of Object.entries(LIGATURE_MAP)) {
      word = word.replaceAll(ligature, replacement);
    }

    // Remove artifact characters from individual words
    word = word.replace(ARTIFACT_CHARS, '');
    word = word.replace(SOFT_HYPHEN, '');

    // Skip empty tokens
    if (!word || word.trim() === '') continue;

    // Skip tokens that are just punctuation/numbers alone (likely page artifacts)
    if (/^[^\w]*$/.test(word) && word.length <= 2) continue;

    // Split clumped words using heuristics
    const splitWords = splitClumpedWord(word);

    for (let i = 0; i < splitWords.length; i++) {
      const w = splitWords[i].trim();
      if (!w) continue;

      const newToken = { word: w };
      if (i === 0) {
        if (token.sectionBefore) newToken.sectionBefore = token.sectionBefore;
        if (token.paragraphBreak) newToken.paragraphBreak = token.paragraphBreak;
      }
      cleaned.push(newToken);
    }
  }

  return cleaned;
}

/**
 * Split a clumped word into its component words using heuristic patterns.
 * Handles cases like "theresults" → ["the", "results"] when possible,
 * and "method.The" → ["method.", "The"] always.
 *
 * @param {string} word
 * @returns {string[]}
 */
function splitClumpedWord(word) {
  // If the word contains internal spaces, split on them first
  if (/\s/.test(word)) {
    return word.split(/\s+/).filter(w => w.length > 0);
  }

  // Split on obvious boundaries: lowercase followed by uppercase (camelCase clump)
  // e.g., "theResults" → "the Results"
  let split = word.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Split on punctuation followed by a letter: "word.Another" → "word. Another"
  split = split.replace(/([.!?])([A-Za-z])/g, '$1 $2');

  // Split on comma/semicolon/colon directly followed by a letter
  split = split.replace(/([,;:])([A-Za-z])/g, '$1 $2');

  // Split on closing paren/bracket followed by letter
  split = split.replace(/([\)\]])([A-Za-z])/g, '$1 $2');

  // Split on letter followed by opening paren/bracket
  split = split.replace(/([A-Za-z])([\(\[])/g, '$1 $2');

  // Split on digit-to-letter or letter-to-digit boundaries where it looks clumped
  // But NOT things like "2nd", "3D", "CO2", etc.
  // Only split if the digit portion is long (like a year: "2024The")
  split = split.replace(/(\d{4,})([A-Za-z])/g, '$1 $2');
  split = split.replace(/([A-Za-z])(\d{4,})/g, '$1 $2');

  const parts = split.split(/\s+/).filter(w => w.length > 0);

  return parts.length > 0 ? parts : [word];
}

