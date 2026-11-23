export function columnDrift(
  currentColumns: string[],
  nextColumns: string[],
  tiles: { title: string; columns: string[] }[],
): { title: string; missing: string[] }[] {
  const current = new Set(currentColumns);
  const next = new Set(nextColumns);
  return tiles.flatMap((tile) => {
    const missing = tile.columns.filter((column) => current.has(column) && !next.has(column));
    return missing.length ? [{ title: tile.title, missing }] : [];
  });
}
