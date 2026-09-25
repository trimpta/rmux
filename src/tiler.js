// Priority tiling: pure layout math + CDP applier. See prd.md §5.
import { MAX_COLUMNS } from './config.js';

/**
 * Compute the layout for `count` windows inside `workArea`.
 * Returns an array indexed by window index:
 *   { index, col, row, left, top, width, height, maximized }
 *
 * Invariants:
 *  - max MAX_COLUMNS columns, all full height
 *  - column counts as even as possible, non-decreasing left->right
 *    (rightmost columns absorb overflow; window 0 stays alone longest)
 *  - windows fill column-major, top->bottom
 *  - N=1 => the single window is maximized
 */
export function computeLayout(count, workArea, maxColumns = MAX_COLUMNS) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`computeLayout: bad count ${count}`);
  const { x, y, width: W, height: H } = normalizeArea(workArea);

  if (count === 1) {
    return [{ index: 0, col: 0, row: 0, left: x, top: y, width: W, height: H, maximized: true }];
  }

  const C = Math.min(count, maxColumns);
  const base = Math.floor(count / C);
  const extra = count % C;
  const colCount = (i) => base + (i >= C - extra ? 1 : 0);

  const layout = [];
  let index = 0;
  for (let col = 0; col < C; col++) {
    const k = colCount(col);
    const left = x + Math.round((col * W) / C);
    const right = x + Math.round(((col + 1) * W) / C);
    for (let row = 0; row < k; row++) {
      const top = y + Math.round((row * H) / k);
      const bottom = row === k - 1 ? y + H : y + Math.round(((row + 1) * H) / k);
      layout.push({
        index,
        col,
        row,
        left,
        top,
        width: right - left,
        height: bottom - top,
        maximized: false,
      });
      index++;
    }
  }
  return layout;
}

function normalizeArea(area) {
  const x = Math.round(area?.x ?? 0);
  const y = Math.round(area?.y ?? 0);
  const width = Math.round(area?.width ?? 0);
  const height = Math.round(area?.height ?? 0);
  if (!(width > 0) || !(height > 0)) throw new Error('computeLayout: bad work area');
  return { x, y, width, height };
}

/** Human-readable layout, e.g. `0 | 1/2 | 3/4`. */
export function formatLayout(layout) {
  const cols = new Map();
  for (const entry of layout) {
    if (!cols.has(entry.col)) cols.set(entry.col, []);
    cols.get(entry.col).push(entry.index);
  }
  return [...cols.keys()]
    .sort((a, b) => a - b)
    .map((c) => cols.get(c).sort((a, b) => a - b).join('/'))
    .join(' | ');
}

/**
 * Apply a layout to live OS windows through the browser-level CDP session.
 * One window's failure never blocks the others.
 */
export async function applyLayout(browserSession, windows, layout, warn = () => {}) {
  for (const win of windows) {
    const slot = layout[win.index];
    if (!slot) continue;
    try {
      if (slot.maximized) {
        await browserSession.send('Browser.setWindowBounds', {
          windowId: win.windowId,
          bounds: { windowState: 'maximized' },
        });
        continue;
      }
      const { bounds } = await browserSession.send('Browser.getWindowBounds', { windowId: win.windowId });
      if (bounds.windowState !== 'normal') {
        // CDP forbids combining a windowState reset with geometry in one call.
        await browserSession.send('Browser.setWindowBounds', {
          windowId: win.windowId,
          bounds: { windowState: 'normal' },
        });
      }
      await browserSession.send('Browser.setWindowBounds', {
        windowId: win.windowId,
        bounds: { left: slot.left, top: slot.top, width: slot.width, height: slot.height },
      });
    } catch (err) {
      warn(`tile: window #${win.index} could not be placed (${err?.message || err})`);
    }
  }
}
