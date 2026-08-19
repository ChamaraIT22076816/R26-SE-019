import { describe, expect, it } from 'vitest'
import { summarizeAll, suggestNext } from './mastery'
import type { AttemptLogEntry } from './attemptLog'
import {
  buildSession,
  currentGloss,
  isComplete,
  markAttempted,
  startSession,
} from './session'

const NOW = new Date('2026-08-18T10:00:00.000Z')

function attempt(gloss: string, score: number, daysAgo = 0): AttemptLogEntry {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000)
  return {
    id: `${gloss}-${score}-${daysAgo}`,
    gloss,
    referenceId: 'ref',
    score,
    worstFingers: [],
    createdAt: at.toISOString(),
  }
}

const VOCAB = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF']

describe('buildSession', () => {
  it('agrees with suggestNext on the first sign', () => {
    // The whole point of the generalisation: a session is the same policy that
    // produced the single suggestion, extended to N. If these ever diverge, the
    // learner is told one thing and given another.
    const log = [attempt('ALPHA', 90, 0), attempt('BRAVO', 20, 3), attempt('CHARLIE', 55, 1)]
    const summaries = summarizeAll(VOCAB, log)
    expect(buildSession(summaries, 5, NOW)[0]).toBe(suggestNext(summaries, NOW))
  })

  it('returns the requested number of signs, without repeats', () => {
    const summaries = summarizeAll(VOCAB, [])
    const built = buildSession(summaries, 5, NOW)
    expect(built).toHaveLength(5)
    expect(new Set(built).size).toBe(5)
  })

  it('never asks for more signs than the vocabulary holds', () => {
    const summaries = summarizeAll(['ONE', 'TWO'], [])
    expect(buildSession(summaries, 5, NOW)).toHaveLength(2)
  })

  it('puts the weakest signs first and leaves mastered ones out', () => {
    const log = [
      // Mastered: three strong attempts, practised today.
      attempt('ALPHA', 95, 0),
      attempt('ALPHA', 92, 0),
      attempt('ALPHA', 96, 0),
      // Struggling.
      attempt('BRAVO', 15, 0),
    ]
    // Only these two have history; the rest are new and take priority anyway.
    const summaries = summarizeAll(['ALPHA', 'BRAVO'], log)
    expect(buildSession(summaries, 1, NOW)).toEqual(['BRAVO'])
  })
})

describe('session progress', () => {
  const summaries = summarizeAll(VOCAB, [])

  it('starts with nothing done and the first sign current', () => {
    const s = startSession(summaries, 3, NOW)
    expect(s.done).toEqual([])
    expect(currentGloss(s)).toBe(s.glosses[0])
    expect(isComplete(s)).toBe(false)
  })

  it('captures the mastery each sign started at, for the completion delta', () => {
    const log = [attempt('ALPHA', 80, 0)]
    const withHistory = summarizeAll(VOCAB, log)
    const s = startSession(withHistory, 7, NOW)
    expect(Object.keys(s.startMastery).sort()).toEqual([...s.glosses].sort())
    expect(s.startMastery.ALPHA).toBeCloseTo(0.8, 5)
  })

  it('completes after one attempt per sign, whatever the score', () => {
    // The bound that matters: a beginner scoring 3 must still be able to finish.
    let s = startSession(summaries, 3, NOW)
    for (const g of s.glosses) s = markAttempted(s, g)
    expect(isComplete(s)).toBe(true)
    expect(currentGloss(s)).toBeNull()
  })

  it('counts a session sign practised out of order', () => {
    const s = startSession(summaries, 3, NOW)
    const last = s.glosses[2]
    const after = markAttempted(s, last)
    expect(after.done).toContain(last)
    expect(currentGloss(after)).toBe(s.glosses[0])
  })

  it('ignores signs outside the session and never double-counts', () => {
    const s = startSession(summaries, 3, NOW)
    expect(markAttempted(s, 'NOT_IN_SESSION')).toBe(s)
    const once = markAttempted(s, s.glosses[0])
    expect(markAttempted(once, s.glosses[0])).toBe(once)
  })
})
