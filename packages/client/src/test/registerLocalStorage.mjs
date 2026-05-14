/**
 * Node test runner has no browser localStorage; zustand persist needs setItem/getItem.
 */
const store = Object.create(null)
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v)
  },
  removeItem: (k) => {
    delete store[k]
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k]
  },
  key: (i) => Object.keys(store)[i] ?? null,
  get length() {
    return Object.keys(store).length
  },
}
