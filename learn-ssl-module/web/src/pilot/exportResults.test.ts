import { describe, expect, it } from 'vitest'
import { buildExport, toCsv } from './exportResults'
import type { AttemptLogEntry } from '../learner/attemptLog'

let n = 0
function attempt(gloss: string, score: number, createdAt: string): AttemptLogEntry {
  return { id: `a${n++}`, gloss, referenceId: `ref-${gloss}`, score, worstFingers: [], createdAt }
}

const ATTEMPTS = [
  attempt('KANAWA', 40, '2026-08-06T10:00:00.000Z'),
  attempt('BONAWA', 55, '2026-08-06T10:01:00.000Z'),
  attempt('KANAWA', 80, '2026-08-06T10:02:00.000Z'),
]

describe('buildExport', () => {
  it('summarises a session', () => {
    const out = buildExport('P01', ATTEMPTS)
    expect(out.participantCode).toBe('P01')
    expect(out.totals.attempts).toBe(3)
    expect(out.totals.distinctSigns).toBe(2)
    expect(out.totals.meanScore).toBe(58) // (40+55+80)/3
    expect(out.totals.firstAttemptAt).toBe('2026-08-06T10:00:00.000Z')
    expect(out.totals.lastAttemptAt).toBe('2026-08-06T10:02:00.000Z')
  })

  it('records first and last score per sign, which learning gain is measured from', () => {
    const kanawa = buildExport('P01', ATTEMPTS).perSign.find((s) => s.gloss === 'KANAWA')
    expect(kanawa?.firstScore).toBe(40)
    expect(kanawa?.lastScore).toBe(80)
    expect(kanawa?.attempts).toBe(2)
  })

  it('orders attempts chronologically regardless of input order', () => {
    const shuffled = [ATTEMPTS[2], ATTEMPTS[0], ATTEMPTS[1]]
    const out = buildExport('P01', shuffled)
    expect(out.attempts.map((a) => a.createdAt)).toEqual([
      '2026-08-06T10:00:00.000Z',
      '2026-08-06T10:01:00.000Z',
      '2026-08-06T10:02:00.000Z',
    ])
  })

  it('falls back to a placeholder rather than an empty participant code', () => {
    expect(buildExport('   ', ATTEMPTS).participantCode).toBe('anonymous')
  })

  it('handles a participant who never attempted anything', () => {
    const out = buildExport('P02', [])
    expect(out.totals.attempts).toBe(0)
    expect(out.totals.meanScore).toBeNull()
    expect(out.perSign).toEqual([])
  })
})

describe('toCsv', () => {
  it('emits a header plus one row per attempt', () => {
    const lines = toCsv(buildExport('P01', ATTEMPTS)).trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(
      'participant_code,attempt_index,gloss,score,worst_fingers,reference_id,created_at',
    )
    expect(lines[1]).toContain('P01,1,KANAWA,40')
  })

  it('escapes values that would otherwise break the CSV', () => {
    const risky = buildExport('P,01"x', [attempt('A', 10, '2026-08-06T10:00:00.000Z')])
    const line = toCsv(risky).trim().split('\n')[1]
    expect(line.startsWith('"P,01""x"')).toBe(true)
  })
})
