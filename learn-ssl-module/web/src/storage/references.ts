import type { SignRecording } from '../vision/types'

/**
 * Choose one reference per gloss from every recording available.
 *
 * Ordering rule: an authoritative reference always beats a provisional one for
 * the same gloss, so dropping a real dataset (or School-for-the-Deaf) recording
 * in place of a team stand-in takes effect immediately, without anyone having
 * to delete the stand-in. Among equals, the newest wins.
 */
export function pickReferences(recordings: SignRecording[]): Map<string, SignRecording> {
  const byGloss = new Map<string, SignRecording>()
  for (const rec of recordings) {
    const incumbent = byGloss.get(rec.gloss)
    if (!incumbent || beats(rec, incumbent)) byGloss.set(rec.gloss, rec)
  }
  return byGloss
}

function beats(candidate: SignRecording, incumbent: SignRecording): boolean {
  const candidateProvisional = candidate.provisional === true
  const incumbentProvisional = incumbent.provisional === true
  if (candidateProvisional !== incumbentProvisional) return incumbentProvisional
  return candidate.createdAt > incumbent.createdAt
}

/** Same selection, as a list sorted by gloss — for chip lists and pickers. */
export function pickReferenceList(recordings: SignRecording[]): SignRecording[] {
  return [...pickReferences(recordings).values()].sort((a, b) => a.gloss.localeCompare(b.gloss))
}
