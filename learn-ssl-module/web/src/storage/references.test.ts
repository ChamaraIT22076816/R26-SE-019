import { describe, expect, it } from 'vitest'
import { pickReferences } from './references'
import type { SignRecording } from '../vision/types'

function rec(
  gloss: string,
  createdAt: string,
  extra: Partial<SignRecording> = {},
): SignRecording {
  return {
    id: `${gloss}-${createdAt}`,
    gloss,
    signer: 'x',
    createdAt,
    durationMs: 1000,
    fps: 25,
    videoWidth: 1280,
    videoHeight: 720,
    frames: [],
    ...extra,
  }
}

describe('pickReferences', () => {
  it('prefers an authoritative reference over a provisional one, whatever the dates', () => {
    const provisionalButNewer = rec('ME', '2026-09-01', { provisional: true })
    const authoritativeButOlder = rec('ME', '2026-01-01', { source: 'kaggle-dataset' })
    const chosen = pickReferences([provisionalButNewer, authoritativeButOlder]).get('ME')
    expect(chosen).toBe(authoritativeButOlder)
  })

  it('takes the newest when both are provisional', () => {
    const older = rec('ME', '2026-01-01', { provisional: true })
    const newer = rec('ME', '2026-02-01', { provisional: true })
    expect(pickReferences([older, newer]).get('ME')).toBe(newer)
  })

  it('takes the newest when neither is provisional and both sample alike', () => {
    const older = rec('ME', '2026-01-01')
    const newer = rec('ME', '2026-02-01')
    expect(pickReferences([older, newer]).get('ME')).toBe(newer)
  })

  it('prefers finer temporal sampling over mere recency', () => {
    // Same sign, same length: 25 fps vs 10 fps. The coarser one was converted
    // later, so "newest wins" alone would pick the worse reference.
    const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ timestampMs: i, hands: [] }))
    const detailed = rec('ME', '2026-01-01', { durationMs: 2000, frames: frames(50) })
    const coarse = rec('ME', '2026-06-01', { durationMs: 2000, frames: frames(20) })
    expect(pickReferences([coarse, detailed]).get('ME')).toBe(detailed)
  })

  it('still lets a provisional recording lose to a coarser authoritative one', () => {
    const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ timestampMs: i, hands: [] }))
    const provisionalHighRate = rec('ME', '2026-06-01', {
      provisional: true,
      durationMs: 2000,
      frames: frames(60),
    })
    const authoritativeLowRate = rec('ME', '2026-01-01', {
      durationMs: 2000,
      frames: frames(20),
    })
    expect(pickReferences([provisionalHighRate, authoritativeLowRate]).get('ME')).toBe(
      authoritativeLowRate,
    )
  })

  it('keeps one entry per gloss', () => {
    const picked = pickReferences([rec('ME', '2026-01-01'), rec('YOU', '2026-01-01')])
    expect([...picked.keys()].sort()).toEqual(['ME', 'YOU'])
  })
})
