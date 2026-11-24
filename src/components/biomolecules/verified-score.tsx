interface VerifiedScoreProps {
  claimed: { correctCount: number | null; totalCount: number | null }
  /** Re-graded result; null when the attempt cannot be verified. */
  regraded: { correct: number; total: number } | null
  strings: { scoreUnverified: string; scoreClaimed: string }
}

/** The re-graded score, flagged when it is unverifiable or differs from the claim. */
export function VerifiedScore({ claimed, regraded, strings }: VerifiedScoreProps) {
  const correct = claimed.correctCount ?? 0
  const total = claimed.totalCount ?? 0
  const differs = regraded !== null && (regraded.correct !== correct || regraded.total !== total)
  return (
    <>
      {regraded === null ? `${correct} / ${total}` : `${regraded.correct} / ${regraded.total}`}
      {(regraded === null || differs) && (
        <span className="block text-xs text-destructive">
          {regraded === null
            ? strings.scoreUnverified
            : strings.scoreClaimed
                .replace("{correct}", String(correct))
                .replace("{total}", String(total))}
        </span>
      )}
    </>
  )
}
