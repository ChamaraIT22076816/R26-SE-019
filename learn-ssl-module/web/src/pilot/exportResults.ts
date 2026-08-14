import type { AttemptLogEntry } from '../learner/attemptLog'
import { summarizeAll } from '../learner/mastery'

/**
 * Pilot data export.
 *
 * Attempts live in the participant's own browser (IndexedDB) and never leave it
 * unless they choose to export — which keeps the "no data leaves your device"
 * property that makes ethics approval straightforward. For a supervised pilot
 * that is enough: the participant exports at the end of the session and hands
 * the file over.
 *
 * A participant code, not a name: the export should not carry personal data.
 */
export interface PilotExport {
  participantCode: string
  exportedAt: string
  totals: {
    attempts: number
    distinctSigns: number
    meanScore: number | null
    firstAttemptAt: string | null
    lastAttemptAt: string | null
  }
  perSign: Array<{
    gloss: string
    attempts: number
    mastery: number
    firstScore: number | null
    lastScore: number | null
  }>
  attempts: AttemptLogEntry[]
}

export function buildExport(
  participantCode: string,
  attempts: AttemptLogEntry[],
  now: Date = new Date(),
): PilotExport {
  const ordered = [...attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const glosses = [...new Set(ordered.map((a) => a.gloss))]

  const perSign = summarizeAll(glosses, ordered).map((s) => {
    const own = ordered.filter((a) => a.gloss === s.gloss)
    return {
      gloss: s.gloss,
      attempts: s.attempts,
      mastery: Number(s.mastery.toFixed(4)),
      // First and last score per sign is what a learning-gain measure needs.
      firstScore: own[0]?.score ?? null,
      lastScore: own[own.length - 1]?.score ?? null,
    }
  })

  return {
    participantCode: participantCode.trim() || 'anonymous',
    exportedAt: now.toISOString(),
    totals: {
      attempts: ordered.length,
      distinctSigns: glosses.length,
      meanScore:
        ordered.length > 0
          ? Math.round(ordered.reduce((t, a) => t + a.score, 0) / ordered.length)
          : null,
      firstAttemptAt: ordered[0]?.createdAt ?? null,
      lastAttemptAt: ordered[ordered.length - 1]?.createdAt ?? null,
    },
    perSign,
    attempts: ordered,
  }
}

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per attempt — the shape a stats tool or spreadsheet wants. */
export function toCsv(data: PilotExport): string {
  const header = [
    'participant_code',
    'attempt_index',
    'gloss',
    'score',
    'worst_fingers',
    'reference_id',
    'created_at',
  ]
  const rows = data.attempts.map((a, i) =>
    [
      data.participantCode,
      i + 1,
      a.gloss,
      a.score,
      a.worstFingers.join(' '),
      a.referenceId,
      a.createdAt,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n') + '\n'
}

export function downloadFile(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download before it starts reading.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
