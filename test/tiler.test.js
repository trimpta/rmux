// Layout algorithm tests — the spec table from prd.md §5 is the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, formatLayout } from '../src/tiler.js';

// A realistic work area: maximized-window bounds on a 150%-scaled screen.
const AREA = { x: -7, y: -7, width: 1722, height: 1082 };

const SPEC_TABLE = [
  [1, '0'],
  [2, '0 | 1'],
  [3, '0 | 1 | 2'],
  [4, '0 | 1 | 2/3'],
  [5, '0 | 1/2 | 3/4'],
  [6, '0/1 | 2/3 | 4/5'],
  [7, '0/1 | 2/3 | 4/5/6'],
  [8, '0/1 | 2/3/4 | 5/6/7'],
];

for (const [n, expected] of SPEC_TABLE) {
  test(`N=${n} → ${expected}`, () => {
    const layout = computeLayout(n, AREA);
    assert.equal(formatLayout(layout), expected);
    assert.equal(layout.length, n);
    assert.deepEqual(
      layout.map((e) => e.index),
      [...Array(n).keys()],
    );
    if (n === 1) {
      assert.equal(layout[0].maximized, true);
    } else {
      assert.ok(layout.every((e) => !e.maximized));
    }
  });
}

test('geometry is sane for N=1..12 (full coverage, no overlaps)', () => {
  for (let n = 1; n <= 12; n++) {
    const layout = computeLayout(n, AREA);
    if (n === 1) {
      assert.equal(layout[0].maximized, true);
      continue;
    }

    const colCount = Math.max(...layout.map((e) => e.col)) + 1;
    assert.ok(colCount >= 1 && colCount <= 3, `N=${n}: column cap`);

    for (let c = 0; c < colCount; c++) {
      const cells = layout.filter((e) => e.col === c).sort((a, b) => a.row - b.row);
      const { left, width } = cells[0];
      for (const cell of cells) {
        assert.equal(cell.left, left, `N=${n}: column ${c} aligned left`);
        assert.equal(cell.width, width, `N=${n}: column ${c} aligned width`);
        assert.ok(cell.width > 0 && cell.height > 0, `N=${n}: positive size`);
        assert.ok(cell.top >= AREA.y && cell.top + cell.height <= AREA.y + AREA.height, `N=${n}: vertical in bounds`);
      }
      assert.equal(
        cells.reduce((sum, e) => sum + e.height, 0),
        AREA.height,
        `N=${n}: column ${c} stack fills height`,
      );
      for (let i = 1; i < cells.length; i++) {
        assert.equal(cells[i].top, cells[i - 1].top + cells[i - 1].height, `N=${n}: rows contiguous`);
      }
    }

    const firstCol = layout.filter((e) => e.col === 0);
    assert.equal(firstCol[0].left, AREA.x, `N=${n}: window 0 at left edge`);
    const lastCol = layout.filter((e) => e.col === colCount - 1);
    assert.equal(lastCol[0].left + lastCol[0].width, AREA.x + AREA.width, `N=${n}: right edge covered`);

    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        assert.ok(!overlap(layout[i], layout[j]), `N=${n}: windows ${i},${j} must not overlap`);
      }
    }
  }
});

test('priority: index order maps to left→right columns, then top→bottom, left-biased', () => {
  for (let n = 2; n <= 12; n++) {
    const layout = computeLayout(n, AREA);
    for (let i = 1; i < n; i++) {
      assert.ok(layout[i].col >= layout[i - 1].col, `N=${n}: column order for #${i}`);
      if (layout[i].col === layout[i - 1].col) {
        assert.equal(layout[i].row, layout[i - 1].row + 1, `N=${n}: row order in column`);
      }
    }

    const colCount = Math.max(...layout.map((e) => e.col)) + 1;
    const counts = [...Array(colCount).keys()].map((c) => layout.filter((e) => e.col === c).length);
    for (let c = 1; c < counts.length; c++) {
      assert.ok(counts[c] >= counts[c - 1], `N=${n}: left columns never hold more (${counts.join(',')})`);
    }
  }
});

test('rejects bad input', () => {
  assert.throws(() => computeLayout(0, AREA));
  assert.throws(() => computeLayout(-1, AREA));
  assert.throws(() => computeLayout(1.5, AREA));
  assert.throws(() => computeLayout(2, { x: 0, y: 0, width: 0, height: 100 }));
});

function overlap(a, b) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}
