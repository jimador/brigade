// Turns how full the session's context window is into a weather reading for the board.
// Clear skies mean plenty of room; a storm means compaction is coming.

const NO_READING = { level: 0, label: 'NO READING', glyph: '·', percent: null }

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Works out the fill percent from what the engine reported, or null when it can't.
// A reported percent wins; otherwise we divide tokens by the window size.
function percentFrom(context) {
  if (!context || typeof context !== 'object') return null
  if (isNumber(context.percent)) return context.percent
  if (isNumber(context.tokens) && isNumber(context.window) && context.window > 0) {
    return (context.tokens / context.window) * 100
  }
  return null
}

/**
 * Reads the context figures and says what the weather is like.
 * @param context what the engine reports: { tokens?, window, percent? }
 * @return { level, label, glyph, percent }, with percent a whole number from 0 to 100 or null
 */
export function forecast(context) {
  const raw = percentFrom(context)
  if (raw === null) return { ...NO_READING }
  const percent = Math.round(Math.min(100, Math.max(0, raw)))
  if (percent < 25) return { level: 0, label: 'CLEAR', glyph: '☀', percent }
  if (percent < 50) return { level: 1, label: 'CLOUDY', glyph: '☁', percent }
  if (percent < 75) return { level: 2, label: 'SHOWERS', glyph: '☂', percent }
  if (percent < 90) return { level: 3, label: 'STORM', glyph: '☇', percent }
  return { level: 4, label: 'COMPACT SOON', glyph: '↯', percent }
}

/**
 * Draws a little fill bar: solid cells for the used share, hollow ones for the rest.
 * @param percent how full, 0 to 100, or null for no reading (an empty bar)
 * @param width how many cells wide; anything below 1 gives an empty string
 * @return the bar as a string
 */
export function gauge(percent, width) {
  const cells = isNumber(width) ? Math.floor(width) : 0
  if (cells < 1) return ''
  const share = isNumber(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const filled = Math.round((share / 100) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}
