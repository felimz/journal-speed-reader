/**
 * Tokenizer — Converts extracted text tokens into RSVP-ready word tokens
 * with ORP (Optimal Recognition Point) calculation and timing metadata.
 *
 * ORP positions based on Spritz/OpenSpritz research:
 *   Word length 1:     position 1
 *   Word length 2–5:   position 2
 *   Word length 6–9:   position 3
 *   Word length 10–13: position 4
 *   Word length 14+:   position 5
 */

// ── ORP Calculation ───────────────────────────────────────────

/**
 * Calculate the Optimal Recognition Point index for a word.
 * @param {string} word
 * @returns {number} 0-based index of the pivot letter
 */
export function calculateORP(word) {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

// ── Timing ────────────────────────────────────────────────────

// Extra delay (in ms) added to base interval for natural reading rhythm.
// Only section breaks get a meaningful pause; punctuation is barely noticeable.
const PAUSE_COMMA = 0;          // , ; : — no extra pause
const PAUSE_PERIOD = 60;        // . ? ! — tiny pause, almost imperceptible
const PAUSE_PARAGRAPH = 200;    // paragraph break — brief breath
const PAUSE_SECTION = 800;      // section heading — real pause to orient reader

/**
 * Determine extra pause time (ms) after this word.
 * @param {string} word
 * @param {boolean} [paragraphBreak]
 * @param {string} [sectionBefore]
 * @returns {number}
 */
export function calculatePause(word, paragraphBreak, sectionBefore) {
  let pause = 0;

  if (sectionBefore) {
    pause = Math.max(pause, PAUSE_SECTION);
  } else if (paragraphBreak) {
    pause = Math.max(pause, PAUSE_PARAGRAPH);
  }

  // Punctuation at end of word
  const lastChar = word[word.length - 1];
  if ('.?!'.includes(lastChar)) {
    pause = Math.max(pause, PAUSE_PERIOD);
  } else if (',;:'.includes(lastChar)) {
    pause = Math.max(pause, PAUSE_COMMA);
  }
  // Em-dash or long dash
  if (word.endsWith('—') || word.endsWith('–')) {
    pause = Math.max(pause, PAUSE_COMMA);
  }

  return pause;
}

// ── Token Building ────────────────────────────────────────────

/**
 * @typedef {Object} RSVPToken
 * @property {string} word - The full word
 * @property {number} pivotIndex - 0-based index of the ORP letter
 * @property {string} before - Characters before the pivot
 * @property {string} pivot - The pivot character
 * @property {string} after - Characters after the pivot
 * @property {number} pauseAfter - Extra ms to wait after this word
 * @property {string|null} sectionBefore - Section name to announce, or null
 * @property {boolean} paragraphBreak - Whether this word starts a new paragraph
 */

/**
 * Convert extraction tokens into RSVP-ready tokens.
 * @param {Array<{word: string, sectionBefore?: string, paragraphBreak?: boolean}>} rawTokens
 * @returns {RSVPToken[]}
 */
export function buildRSVPTokens(rawTokens) {
  return rawTokens.map(raw => {
    const word = raw.word;
    const pivotIndex = calculateORP(word);

    return {
      word,
      pivotIndex,
      before: word.substring(0, pivotIndex),
      pivot: word[pivotIndex] || '',
      after: word.substring(pivotIndex + 1),
      pauseAfter: calculatePause(word, raw.paragraphBreak, raw.sectionBefore),
      sectionBefore: raw.sectionBefore || null,
      paragraphBreak: !!raw.paragraphBreak,
    };
  });
}
