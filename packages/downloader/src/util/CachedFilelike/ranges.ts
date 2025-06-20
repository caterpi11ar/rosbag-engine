import { complement, intersect, isBefore, isDuring } from 'intervals-fn'

export interface Range { start: number, end: number }

export function isRangeCoveredByRanges(
  queryRange: Range,
  nonOverlappingMergedAndSortedRanges: Range[],
): boolean {
  for (const range of nonOverlappingMergedAndSortedRanges) {
    if (isBefore(queryRange, range)) {
      return false
    }
    if (isDuring(queryRange, range)) {
      return true
    }
  }
  return false
}

export function missingRanges(bounds: Range, ranges: readonly Range[]): Range[] {
  // `complement` works in unexpected ways when `ranges` has a range that exceeds `bounds`,
  // so we first clip `ranges` to `bounds`.
  return complement(bounds, intersect([bounds], ranges))
}
