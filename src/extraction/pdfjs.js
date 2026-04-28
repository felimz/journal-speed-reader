/**
 * Deterministic PDF text extraction using PDF.js with spatial analysis.
 *
 * Handles multi-column layouts, filters non-body content, and detects
 * section headings and paragraph breaks — all client-side, in milliseconds.
 */
import * as pdfjsLib from 'pdfjs-dist';

// Configure the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ── Constants ──────────────────────────────────────────────────
const HEADER_FOOTER_MARGIN = 0.08; // top/bottom 8% of page
const COLUMN_GAP_THRESHOLD = 0.04; // 4% of page width = significant gap
const LINE_Y_TOLERANCE_FACTOR = 0.35; // fraction of font-size for same-line grouping
const PARAGRAPH_GAP_FACTOR = 1.4; // Y-gap > 1.4× line-height = paragraph break
const FOOTNOTE_FONT_RATIO = 0.78; // items < 78% of body font = footnote
const MIN_GAP_SCAN_RANGE = 0.2; // only scan for column gaps in middle 60% (20%–80%)
const MAX_GAP_SCAN_RANGE = 0.8;
const SPACE_GAP_FACTOR = 0.3; // X-gap > 30% of font-size → insert space between items

// Section heading patterns
const SECTION_HEADING_PATTERNS = [
  /^abstract$/i,
  /^introduction$/i,
  /^background$/i,
  /^(related\s+work|literature\s+review)$/i,
  /^methods?(?:ology)?$/i,
  /^(materials?\s+and\s+methods?|experimental\s+(?:setup|design|methods?))$/i,
  /^(?:data|study)\s+(?:collection|design|analysis)$/i,
  /^results?$/i,
  /^results?\s+and\s+discussion$/i,
  /^discussion$/i,
  /^conclusion[s]?$/i,
  /^(?:summary|findings|implications)$/i,
  /^limitations?$/i,
  /^future\s+(?:work|research|directions?)$/i,
  /^\d+\.?\s+\w/i, // numbered sections like "1. Introduction"
];

// End-of-body patterns — everything after these is excluded
const END_OF_BODY_PATTERNS = [
  /^references$/i,
  /^bibliography$/i,
  /^works?\s+cited$/i,
  /^acknowledge?ments?$/i,
  /^appendix/i,
  /^supplementary/i,
  /^funding$/i,
  /^conflicts?\s+of\s+interest$/i,
  /^author\s+contributions?$/i,
  /^data\s+availability$/i,
];

// Figure/table caption patterns
const CAPTION_PATTERNS = [
  /^(?:figure|fig\.?)\s+\d/i,
  /^(?:table|tbl\.?)\s+\d/i,
  /^(?:scheme|chart|graph|plate)\s+\d/i,
];

/**
 * @typedef {Object} ExtractedText
 * @property {string} text - The full body text
 * @property {Array<{word: string, sectionBefore?: string, paragraphBreak?: boolean}>} tokens
 */

/**
 * Extract body text from a PDF ArrayBuffer.
 * @param {ArrayBuffer} pdfData
 * @param {function(string): void} [onStatus] - Progress callback
 * @returns {Promise<ExtractedText>}
 */
export async function extractTextFromPDF(pdfData, onStatus) {
  const statusFn = onStatus || (() => {});

  statusFn('Loading PDF...');
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const numPages = pdf.numPages;

  statusFn(`Extracting text from ${numPages} pages...`);

  // ── Step 1: Collect all text items with coordinates from every page ──
  const allPageItems = [];
  for (let i = 1; i <= numPages; i++) {
    statusFn(`Analyzing page ${i} of ${numPages}...`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const pageItems = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]);
      const x = item.transform[4];
      // Convert from bottom-left origin to top-left origin
      const y = viewport.height - item.transform[5];

      pageItems.push({
        str: item.str,
        x,
        y,
        width: item.width,
        height: item.height,
        fontSize,
        fontName: item.fontName || '',
        pageNum: i,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
    allPageItems.push(pageItems);
  }

  statusFn('Detecting layout structure...');

  // ── Step 2: Determine dominant body font size ──
  const allItems = allPageItems.flat();
  const bodyFontSize = findDominantFontSize(allItems);

  // ── Step 3: Process each page with column detection ──
  const bodyLines = [];
  let reachedEndOfBody = false;

  for (let pageIdx = 0; pageIdx < allPageItems.length; pageIdx++) {
    if (reachedEndOfBody) break;

    const pageItems = allPageItems[pageIdx];
    if (pageItems.length === 0) continue;

    const pageWidth = pageItems[0].pageWidth;
    const pageHeight = pageItems[0].pageHeight;

    // ── Step 3a: Filter out headers, footers, page numbers ──
    const contentItems = filterNonBodyItems(pageItems, pageWidth, pageHeight, bodyFontSize);

    // ── Step 3b: Detect columns ──
    const columns = detectColumns(contentItems, pageWidth);

    // ── Step 3c: Process columns in reading order ──
    for (const colItems of columns) {
      // Group into lines
      const lines = groupIntoLines(colItems);

      for (const line of lines) {
        const lineText = joinLineItems(line.items);
        const trimmed = lineText.trim();

        if (!trimmed) continue;

        // Check for end-of-body markers
        if (END_OF_BODY_PATTERNS.some(p => p.test(trimmed))) {
          reachedEndOfBody = true;
          break;
        }

        // Check for captions — skip them
        if (CAPTION_PATTERNS.some(p => p.test(trimmed))) continue;

        // Detect section headings
        const isHeading = detectHeading(line, bodyFontSize);
        const headingText = isHeading ? trimmed : null;

        bodyLines.push({
          text: trimmed,
          y: line.y,
          fontSize: line.avgFontSize,
          isHeading,
          headingText,
          pageNum: pageIdx + 1,
          gapAbove: line.gapAbove || 0,
          lineHeight: line.avgFontSize,
        });
      }
    }
  }

  statusFn('Building tokens...');

  // ── Step 4: Build token array with section/paragraph markers ──
  const tokens = buildTokens(bodyLines, bodyFontSize);

  const fullText = bodyLines.map(l => l.text).join(' ');

  statusFn('Ready!');
  return { text: fullText, tokens };
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Find the most common font size (the body text font).
 */
function findDominantFontSize(items) {
  const sizeCounts = {};
  for (const item of items) {
    const rounded = Math.round(item.fontSize * 2) / 2; // round to 0.5
    sizeCounts[rounded] = (sizeCounts[rounded] || 0) + item.str.length;
  }
  let maxCount = 0;
  let dominant = 10;
  for (const [size, count] of Object.entries(sizeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = parseFloat(size);
    }
  }
  return dominant;
}

/**
 * Filter items that are likely headers, footers, page numbers, or footnotes.
 */
function filterNonBodyItems(items, pageWidth, pageHeight, bodyFontSize) {
  const topMargin = pageHeight * HEADER_FOOTER_MARGIN;
  const bottomThreshold = pageHeight * (1 - HEADER_FOOTER_MARGIN);
  const footnoteSizeLimit = bodyFontSize * FOOTNOTE_FONT_RATIO;

  return items.filter(item => {
    // Filter headers (top margin)
    if (item.y < topMargin) return false;

    // Filter footers / page numbers (bottom margin)
    if (item.y > bottomThreshold) return false;

    // Filter page numbers (short numeric strings near edges)
    if (/^\s*\d{1,4}\s*$/.test(item.str) && (item.y < topMargin * 1.5 || item.y > bottomThreshold * 0.95)) {
      return false;
    }

    // Filter footnotes (significantly smaller font)
    if (item.fontSize < footnoteSizeLimit && item.fontSize > 0) return false;

    return true;
  });
}

/**
 * Detect column layout using X-coordinate gap analysis.
 * Returns arrays of items grouped by column, ordered left-to-right.
 */
function detectColumns(items, pageWidth) {
  if (items.length === 0) return [[]];

  // Build a histogram of X-ranges covered by text items
  const resolution = 2; // 2-unit buckets
  const buckets = new Array(Math.ceil(pageWidth / resolution)).fill(0);

  for (const item of items) {
    const startBucket = Math.floor(item.x / resolution);
    const endBucket = Math.floor((item.x + item.width) / resolution);
    for (let b = startBucket; b <= endBucket && b < buckets.length; b++) {
      buckets[b]++;
    }
  }

  // Scan for gaps in the middle portion of the page
  const scanStart = Math.floor((pageWidth * MIN_GAP_SCAN_RANGE) / resolution);
  const scanEnd = Math.floor((pageWidth * MAX_GAP_SCAN_RANGE) / resolution);

  let bestGapStart = -1;
  let bestGapEnd = -1;
  let bestGapWidth = 0;
  let currentGapStart = -1;

  for (let b = scanStart; b <= scanEnd; b++) {
    if (buckets[b] === 0) {
      if (currentGapStart === -1) currentGapStart = b;
    } else {
      if (currentGapStart !== -1) {
        const gapWidth = b - currentGapStart;
        if (gapWidth > bestGapWidth) {
          bestGapWidth = gapWidth;
          bestGapStart = currentGapStart;
          bestGapEnd = b;
        }
        currentGapStart = -1;
      }
    }
  }
  // Handle gap that extends to the end of scan range
  if (currentGapStart !== -1) {
    const gapWidth = scanEnd - currentGapStart;
    if (gapWidth > bestGapWidth) {
      bestGapWidth = gapWidth;
      bestGapStart = currentGapStart;
      bestGapEnd = scanEnd;
    }
  }

  const gapWidthPx = bestGapWidth * resolution;
  const minGapPx = pageWidth * COLUMN_GAP_THRESHOLD;

  // If we found a significant gap, split into two columns
  if (gapWidthPx >= minGapPx && bestGapStart !== -1) {
    const splitX = ((bestGapStart + bestGapEnd) / 2) * resolution;

    const leftCol = items.filter(it => it.x + it.width / 2 < splitX);
    const rightCol = items.filter(it => it.x + it.width / 2 >= splitX);

    return [leftCol, rightCol].filter(col => col.length > 0);
  }

  // Single column
  return [items];
}

/**
 * Group text items into lines by Y-coordinate clustering.
 * Returns lines sorted top-to-bottom, with items sorted left-to-right within each line.
 */
function groupIntoLines(items) {
  if (items.length === 0) return [];

  // Sort by Y first
  const sorted = [...items].sort((a, b) => a.y - b.y);

  const lines = [];
  let currentLine = { items: [sorted[0]], y: sorted[0].y };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const tolerance = item.fontSize * LINE_Y_TOLERANCE_FACTOR;

    if (Math.abs(item.y - currentLine.y) <= tolerance) {
      currentLine.items.push(item);
    } else {
      lines.push(currentLine);
      currentLine = { items: [item], y: item.y };
    }
  }
  lines.push(currentLine);

  // Sort items within each line left-to-right, compute metadata
  let prevLineBottom = 0;
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.avgFontSize = line.items.reduce((s, it) => s + it.fontSize, 0) / line.items.length;
    line.gapAbove = line.y - prevLineBottom;
    prevLineBottom = line.y + line.avgFontSize;
  }

  return lines;
}

/**
 * Join text items on a line, inserting spaces based on X-coordinate gaps.
 * This fixes the word-clumping problem from PDF.js extraction.
 */
function joinLineItems(items) {
  if (items.length === 0) return '';

  let result = items[0].str;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];

    // Calculate the gap between the end of the previous item and the start of this one
    const prevEnd = prev.x + prev.width;
    const gap = curr.x - prevEnd;

    // Use the average font size to determine the space threshold
    const avgFontSize = (prev.fontSize + curr.fontSize) / 2;
    const spaceThreshold = avgFontSize * SPACE_GAP_FACTOR;

    // If there's a significant gap, or prev ends with a letter and curr starts with one
    // (and there's any positive gap), insert a space
    if (gap > spaceThreshold) {
      result += ' ';
    } else if (gap > 0.5) {
      // Even small gaps likely indicate a space between words in most PDFs
      // Check if prev ends with a letter/digit and curr starts with one
      const prevChar = prev.str[prev.str.length - 1];
      const currChar = curr.str[0];
      if (prevChar && currChar &&
          /[a-zA-Z0-9,.;:!?\)\]"']/.test(prevChar) &&
          /[a-zA-Z0-9\(\["']/.test(currChar)) {
        result += ' ';
      }
    }

    result += curr.str;
  }

  return result;
}

/**
 * Detect if a line is a section heading.
 * Headings tend to have larger/bolder fonts or match heading patterns.
 */
function detectHeading(line, bodyFontSize) {
  const text = joinLineItems(line.items).trim();

  // Check font-size based detection (>10% larger than body)
  const isLarger = line.avgFontSize > bodyFontSize * 1.08;

  // Check bold font name
  const hasBoldFont = line.items.some(it =>
    /bold|heavy|black/i.test(it.fontName)
  );

  // Check text pattern
  const matchesPattern = SECTION_HEADING_PATTERNS.some(p => p.test(text));

  // It's a heading if it matches a pattern AND is larger or bold,
  // or if it very strongly matches a known heading pattern
  if (matchesPattern && (isLarger || hasBoldFont)) return true;
  if (matchesPattern && text.split(/\s+/).length <= 6) return true;

  return false;
}

/**
 * Build final token array from body lines.
 * Each token is a word with optional section/paragraph markers.
 */
function buildTokens(bodyLines, bodyFontSize) {
  const tokens = [];
  let lastLineY = 0;
  let lastLineHeight = bodyFontSize;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const words = line.text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) continue;

    // Detect paragraph break (significant Y-gap)
    const isParagraphBreak = i > 0 && line.gapAbove > lastLineHeight * PARAGRAPH_GAP_FACTOR;

    for (let j = 0; j < words.length; j++) {
      const token = { word: words[j] };

      if (j === 0) {
        if (line.isHeading && line.headingText) {
          token.sectionBefore = line.headingText;
        } else if (isParagraphBreak) {
          token.paragraphBreak = true;
        }
      }

      tokens.push(token);
    }

    lastLineY = line.y;
    lastLineHeight = line.avgFontSize;
  }

  return tokens;
}

/**
 * Parse pasted text into tokens with paragraph/section detection.
 * @param {string} text
 * @returns {ExtractedText}
 */
export function parseTextInput(text) {
  const lines = text.split(/\n/);
  const tokens = [];

  let prevWasBlank = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      prevWasBlank = true;
      continue;
    }

    // Check for end-of-body
    if (END_OF_BODY_PATTERNS.some(p => p.test(trimmed))) break;

    // Check for section heading (short line after blank, possibly numbered)
    const isHeading = prevWasBlank && trimmed.split(/\s+/).length <= 8 &&
      SECTION_HEADING_PATTERNS.some(p => p.test(trimmed));

    const words = trimmed.split(/\s+/).filter(w => w.length > 0);

    for (let j = 0; j < words.length; j++) {
      const token = { word: words[j] };

      if (j === 0) {
        if (isHeading) {
          token.sectionBefore = trimmed;
        } else if (prevWasBlank && tokens.length > 0) {
          token.paragraphBreak = true;
        }
      }

      tokens.push(token);
    }

    prevWasBlank = false;
  }

  return { text, tokens };
}
