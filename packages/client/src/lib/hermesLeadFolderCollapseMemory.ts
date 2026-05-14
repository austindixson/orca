export function pruneCollapsedFolderIds(
  current: Set<string>,
  visibleFolderIds: Set<string>
): { ids: Set<string>; changed: boolean } {
  let changed = false
  const next = new Set<string>()
  for (const id of current) {
    if (visibleFolderIds.has(id)) next.add(id)
    else changed = true
  }
  return { ids: next, changed }
}
