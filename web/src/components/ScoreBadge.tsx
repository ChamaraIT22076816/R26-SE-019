interface ScoreBadgeProps {
  score: number
}

function band(score: number): { klass: string; label: string } {
  if (score >= 85) return { klass: 'good', label: 'Great match' }
  if (score >= 60) return { klass: 'ok', label: 'Getting there' }
  return { klass: 'low', label: 'Keep practising' }
}

/** Circular progress ring showing a 0–100 sign-match score. */
export function ScoreBadge({ score }: ScoreBadgeProps) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  const { klass, label } = band(score)

  return (
    <div className={`score-badge ${klass}`}>
      <svg viewBox="0 0 120 120" width="120" height="120">
        <circle cx="60" cy="60" r={r} className="ring-track" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className="ring-value"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="60" className="ring-score" dominantBaseline="central" textAnchor="middle">
          {score}
        </text>
      </svg>
      <span className="score-label">{label}</span>
    </div>
  )
}
