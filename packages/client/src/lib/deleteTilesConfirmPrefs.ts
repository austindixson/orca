const STORAGE_KEY = 'orca.skipDeleteTilesConfirm'

export function getSkipDeleteTilesConfirm(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSkipDeleteTilesConfirm(skip: boolean): void {
  try {
    if (skip) {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}
