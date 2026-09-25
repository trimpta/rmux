// Ordered window registry. Index === priority: 0 is leftmost / best space.
// On removal the survivors are re-indexed compactly (see prd.md §4.4).
export class WindowRegistry {
  #windows = [];

  get count() {
    return this.#windows.length;
  }

  /** Snapshot of the windows in priority order. */
  get all() {
    return [...this.#windows];
  }

  add(entry) {
    const win = { ...entry, index: this.#windows.length };
    this.#windows.push(win);
    return win;
  }

  find(predicate) {
    return this.#windows.find(predicate);
  }

  removeByTargetId(targetId) {
    const i = this.#windows.findIndex((w) => w.targetId === targetId);
    if (i === -1) return null;
    const [removed] = this.#windows.splice(i, 1);
    this.#reindex();
    return removed;
  }

  #reindex() {
    this.#windows.forEach((w, i) => {
      w.index = i;
    });
  }
}
