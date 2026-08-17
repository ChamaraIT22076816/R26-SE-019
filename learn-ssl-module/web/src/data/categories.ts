export const MY_RECORDINGS = 'My recordings'
const UNCATEGORISED = 'Other'

/** The two fields grouping depends on — so this works on the frameless
 *  bundled index as well as on a fully-loaded recording. */
interface Categorisable {
  source?: string
  sourceCategory?: string
}

/**
 * Which group a reference belongs to in the practice picker. Dataset
 * conversions carry the folder they came from; anything recorded in the browser
 * is the learner's own, which is the grouping that matters to them.
 */
export function categoryOf(rec: Categorisable): string {
  if (rec.source === 'team-recording') return MY_RECORDINGS
  return rec.sourceCategory ?? UNCATEGORISED
}

/** Category names present in a set of references, ordered for display. */
export function categoriesIn(recs: Categorisable[]): string[] {
  const names = [...new Set(recs.map(categoryOf))]
  // The learner's own recordings sort last; everything else alphabetically.
  return names.sort((a, b) => {
    if (a === MY_RECORDINGS) return 1
    if (b === MY_RECORDINGS) return -1
    return a.localeCompare(b)
  })
}
