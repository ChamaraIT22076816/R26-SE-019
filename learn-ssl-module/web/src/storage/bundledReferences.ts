import type { SignRecording } from '../vision/types'

/**
 * Bundled reference recordings ship with the app in public/references/.
 * Team workflow: record in the Record tab → Export JSON → commit the file to
 * public/references/ and list it in manifest.json. Everyone then gets the
 * same reference set without touching IndexedDB.
 */
export async function loadBundledRecordings(): Promise<SignRecording[]> {
  try {
    const res = await fetch('/references/manifest.json')
    if (!res.ok) return []
    const manifest = (await res.json()) as { files?: string[] }
    const files = manifest.files ?? []
    const recordings = await Promise.all(
      files.map(async (file) => {
        try {
          const r = await fetch(`/references/${file}`)
          return r.ok ? ((await r.json()) as SignRecording) : null
        } catch {
          return null
        }
      }),
    )
    return recordings.filter((r): r is SignRecording => r !== null)
  } catch {
    return []
  }
}
