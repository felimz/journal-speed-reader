/**
 * RSVP Playback Engine
 *
 * Controls the word-by-word playback with variable timing,
 * section pauses, and user controls.
 */

/**
 * @typedef {import('../processing/tokenizer.js').RSVPToken} RSVPToken
 */

export class RSVPEngine {
  /**
   * @param {RSVPToken[]} tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.currentIndex = 0;
    this.wpm = 300;
    this.isPlaying = false;
    this._timeoutId = null;
    this._listeners = {};
  }

  /** Subscribe to engine events */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  /** Emit an event */
  _emit(event, data) {
    const callbacks = this._listeners[event] || [];
    for (const cb of callbacks) cb(data);
  }

  /** Get the base interval in ms for the current WPM */
  get baseInterval() {
    return (60 / this.wpm) * 1000;
  }

  /** Get the current token */
  get currentToken() {
    return this.tokens[this.currentIndex] || null;
  }

  /** Total word count */
  get totalWords() {
    return this.tokens.length;
  }

  /** Current progress as a fraction 0–1 */
  get progress() {
    if (this.tokens.length === 0) return 0;
    return this.currentIndex / (this.tokens.length - 1);
  }

  /** Set WPM */
  setWPM(wpm) {
    this.wpm = Math.max(100, Math.min(900, wpm));
    this._emit('wpm', this.wpm);
  }

  /** Start or resume playback */
  play() {
    if (this.isPlaying) return;
    if (this.currentIndex >= this.tokens.length) {
      this.currentIndex = 0;
    }
    this.isPlaying = true;
    this._emit('state', 'playing');
    this._scheduleNext();
  }

  /** Pause playback */
  pause() {
    this.isPlaying = false;
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    this._emit('state', 'paused');
  }

  /** Toggle play/pause */
  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /** Reset to beginning */
  reset() {
    this.pause();
    this.currentIndex = 0;
    this._emit('word', this.currentToken);
    this._emit('progress', this.progress);
  }

  /** Jump to a specific word index */
  seekTo(index) {
    this.currentIndex = Math.max(0, Math.min(this.tokens.length - 1, index));
    this._emit('word', this.currentToken);
    this._emit('progress', this.progress);
  }

  /** Skip forward/backward by N words */
  skip(n) {
    this.seekTo(this.currentIndex + n);
  }

  /** Schedule the next word display */
  _scheduleNext() {
    if (!this.isPlaying) return;
    if (this.currentIndex >= this.tokens.length) {
      this.pause();
      this._emit('complete');
      return;
    }

    const token = this.currentToken;

    // If this word starts a new section, announce it with a pause
    if (token.sectionBefore) {
      this._emit('section', token.sectionBefore);
    }

    this._emit('word', token);
    this._emit('progress', this.progress);

    // Calculate delay before next word.
    // Scale pauses inversely with WPM so they're less jarring at high speeds.
    // At 300 WPM (baseline), pauses are at full value.
    // At 600 WPM, pauses shrink to ~30% of their nominal value.
    const pauseScale = Math.max(0.2, 300 / this.wpm);
    const delay = this.baseInterval + (token.pauseAfter * pauseScale);

    this.currentIndex++;

    this._timeoutId = setTimeout(() => {
      this._scheduleNext();
    }, delay);
  }

  /** Clean up */
  destroy() {
    this.pause();
    this._listeners = {};
  }
}
