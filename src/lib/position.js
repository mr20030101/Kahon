// Fractional ordering: a new position always fits between two neighbours,
// so moving a task only updates that one row.
export function between(before, after) {
  if (before == null && after == null) return 1000;
  if (before == null) return after - 1000;
  if (after == null) return before + 1000;
  return (before + after) / 2;
}

export const byPosition = (a, b) => a.position - b.position;
