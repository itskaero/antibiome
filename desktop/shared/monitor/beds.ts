/** Census bed for a monitor bed: an explicit mapping, else the same number (never for demo beds). */
export function censusBedFor(map: Record<string, string>, id: string, bed: number, demo: boolean): string | null {
  if (map[id]) return map[id];
  return demo ? null : String(bed);
}
