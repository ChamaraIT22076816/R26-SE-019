import { practiceNeed } from './mastery'
import type { GlossMastery } from './mastery'

/**
 * A practice session: a small, finite set of signs with a completion state.
 *
 * Why this exists at all. PracticeView was an infinite chip picker — nothing
 * ever completed, so nothing was ever "enough". `suggestNext` already knew
 * which sign deserves attention; it was rendered as one line of body text
 * competing with a search box and 351 chips.
 *
 * There is also a measurement argument. The proposal target is "≥20% learning
 * gain after 10 sessions", and *session* was undefined inside the product a
 * participant actually uses. This gives that construct a referent.
 *
 * Built entirely on the existing learner model — no new scoring, no invented
 * data. The set is `suggestNext` generalised from one sign to N, so the same
 * policy that picked the suggestion picks the session.
 *
 * DESIGN BOUNDS, deliberately enforced here rather than left to the UI. This is
 * a research instrument used with human participants, so the motivation has to
 * be honest — competence and progress, never manufactured pressure:
 *
 *  - A session is ALWAYS finishable. A sign is done after one scored attempt,
 *    whatever the score. Gating completion on reaching 85 would trap a beginner
 *    in an unfinishable loop, which is the opposite of self-efficacy, and would
 *    bias the study toward participants who happen to score well early.
 *  - Nothing is ever withheld. The full vocabulary stays reachable at all times.
 *  - Nothing is time-gated, and there is no streak to lose.
 */
export interface PracticeSession {
  glosses: string[]
  /** Glosses with at least one scored attempt this session. */
  done: string[]
  startedAt: string
  /**
   * Mastery per gloss at the moment the session began, so the completion card
   * can report a real before→after change rather than re-deriving history.
   */
  startMastery: Record<string, number>
}

export const SESSION_SIZE = 5
const KEY = 'ssl-learn-session'

/**
 * The N signs most in need of practice, by the same ranking `suggestNext` uses:
 * highest need first, ties alphabetical. `buildSession(...)[0]` is therefore
 * always `suggestNext(...)`, which session.test.ts pins.
 */
export function buildSession(
  summaries: GlossMastery[],
  size: number = SESSION_SIZE,
  now: Date = new Date(),
): string[] {
  return [...summaries]
    .sort((a, b) => practiceNeed(b, now) - practiceNeed(a, now) || a.gloss.localeCompare(b.gloss))
    .slice(0, size)
    .map((s) => s.gloss)
}

export function startSession(
  summaries: GlossMastery[],
  size: number = SESSION_SIZE,
  now: Date = new Date(),
): PracticeSession {
  const glosses = buildSession(summaries, size, now)
  const startMastery: Record<string, number> = {}
  for (const s of summaries) {
    if (glosses.includes(s.gloss)) startMastery[s.gloss] = s.mastery
  }
  return { glosses, done: [], startedAt: now.toISOString(), startMastery }
}

/** The sign being worked on: the first one without a scored attempt yet. */
export function currentGloss(session: PracticeSession): string | null {
  return session.glosses.find((g) => !session.done.includes(g)) ?? null
}

export function isComplete(session: PracticeSession): boolean {
  return session.glosses.every((g) => session.done.includes(g))
}

/**
 * Record a scored attempt against the session.
 *
 * Any session gloss counts, not just the current one — practising ahead, or
 * wandering into a session sign from the picker, should never fail to register.
 * Returns the same object when nothing changed, so callers can skip a re-render.
 */
export function markAttempted(session: PracticeSession, gloss: string): PracticeSession {
  if (!session.glosses.includes(gloss) || session.done.includes(gloss)) return session
  return { ...session, done: [...session.done, gloss] }
}

// ---- persistence -----------------------------------------------------------
// sessionStorage, not localStorage: a session is meant to span a sitting, not
// to greet someone days later half-finished. It survives a reload — which
// matters mid-pilot — but never becomes a second source of truth. The IndexedDB
// attempt log stays canonical for everything that counts as progress.

export function loadSession(): PracticeSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveSession(session: PracticeSession): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* storage unavailable — the session simply does not survive a reload */
  }
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

function isSession(value: unknown): value is PracticeSession {
  const s = value as PracticeSession
  return (
    !!s &&
    Array.isArray(s.glosses) &&
    Array.isArray(s.done) &&
    typeof s.startedAt === 'string' &&
    !!s.startMastery &&
    typeof s.startMastery === 'object'
  )
}
