// Negative values distinguish missing configuration from a genuine zero capacity.
export const UNKNOWN_LOAD = -2;

export function calculateLoadPercent(hours: number, capacity: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(capacity)) return UNKNOWN_LOAD;
  if (capacity <= 0) return hours > 0 ? -1 : 0;
  return Math.round(hours / capacity * 100);
}

export function formatWorkHours(hours: number | null | undefined): number | string {
  return typeof hours === 'number' && Number.isFinite(hours) ? hours : '—';
}
