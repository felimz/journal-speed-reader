/**
 * RSVP Word Display
 *
 * Renders a word with ORP-based alignment. The pivot letter is
 * FIXED at the exact center of the display (aligned to the guide ticks).
 *
 * Layout strategy:
 *  - The pivot character is absolutely positioned at left:50%, centered.
 *  - The "before" text is absolutely positioned with its right edge
 *    butting up against the pivot's left edge.
 *  - The "after" text is absolutely positioned with its left edge
 *    starting right after the pivot's right edge.
 *
 * This ensures the red pivot letter NEVER moves on screen regardless
 * of word length — only the surrounding characters shift.
 */

const $ = (id) => document.getElementById(id);

export class RSVPDisplay {
  constructor() {
    this.wordBefore = $('word-before');
    this.wordPivot = $('word-pivot');
    this.wordAfter = $('word-after');
    this.sectionAnnounce = $('section-announce');
    this.sectionLabel = $('section-label');
    this._sectionTimeout = null;

    // Measure a single character width for offset calculations
    // We'll recalculate on each word since the font is proportional
  }

  /**
   * Display a word token with ORP alignment.
   * The pivot stays at the fixed center point; before/after text
   * is positioned relative to it.
   *
   * @param {import('../processing/tokenizer.js').RSVPToken} token
   */
  showWord(token) {
    if (!token) {
      this.clear();
      return;
    }

    // Set the text content
    this.wordBefore.textContent = token.before;
    this.wordPivot.textContent = token.pivot;
    this.wordAfter.textContent = token.after;

    // After rendering, measure the pivot width and offset the neighbors.
    // Use requestAnimationFrame to ensure layout is calculated.
    requestAnimationFrame(() => {
      const pivotWidth = this.wordPivot.offsetWidth;
      const halfPivot = pivotWidth / 2;

      // "before" text: its right edge should be at (50% - halfPivot)
      // CSS already has right:50%, so we add a margin-right to push it
      // further left by halfPivot (so it doesn't overlap the pivot)
      this.wordBefore.style.marginRight = `${halfPivot}px`;

      // "after" text: its left edge should start at (50% + halfPivot)
      // CSS already has left:50%, so we add a margin-left of halfPivot
      this.wordAfter.style.marginLeft = `${halfPivot}px`;
    });
  }

  /** Clear the display */
  clear() {
    this.wordBefore.textContent = '';
    this.wordPivot.textContent = '';
    this.wordAfter.textContent = '';
  }

  /**
   * Show a section announcement briefly.
   * @param {string} sectionName
   */
  showSection(sectionName) {
    if (this._sectionTimeout) clearTimeout(this._sectionTimeout);

    // Clean up the section name for display
    let display = sectionName;
    // Remove leading numbers like "1. " or "2.1 "
    display = display.replace(/^\d+[\.\)]\s*/, '');

    this.sectionLabel.textContent = display;
    this.sectionAnnounce.classList.remove('hidden');

    this._sectionTimeout = setTimeout(() => {
      this.sectionAnnounce.classList.add('hidden');
    }, 1200);
  }

  /** Hide section announcement */
  hideSection() {
    this.sectionAnnounce.classList.add('hidden');
  }
}
