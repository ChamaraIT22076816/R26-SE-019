import { useCallback, useEffect, useRef, useState } from 'react'
import type { SignRecording } from '../vision/types'
import { deleteRecording, listRecordings, saveRecording } from '../storage/recordingStore'
import { loadBundledRecordings } from '../storage/bundledReferences'
import { SkeletonPlayer } from './SkeletonPlayer'

interface Row {
  rec: SignRecording
  bundled: boolean
}

/** Reference library: local (IndexedDB) + bundled recordings, replay, JSON export/import. */
export function LibraryView() {
  const [local, setLocal] = useState<SignRecording[]>([])
  const [bundled, setBundled] = useState<SignRecording[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshLocal = useCallback(async () => {
    setLocal(await listRecordings())
  }, [])

  useEffect(() => {
    void (async () => {
      const [loc, bun] = await Promise.all([listRecordings(), loadBundledRecordings()])
      setLocal(loc)
      setBundled(bun)
      setLoading(false)
    })()
  }, [])

  function isRecording(value: unknown): value is SignRecording {
    const rec = value as SignRecording
    return !!rec && typeof rec.gloss === 'string' && Array.isArray(rec.frames)
  }

  async function handleImport(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      try {
        const parsed: unknown = JSON.parse(await file.text())
        // Accept a single recording or an array of them (an exported bundle).
        const recs = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecording)
        if (recs.length === 0) throw new Error('not a recording')
        for (const rec of recs) {
          rec.id ||= crypto.randomUUID()
          await saveRecording(rec)
        }
      } catch {
        window.alert(`"${file.name}" doesn't look like a sign recording JSON.`)
      }
    }
    await refreshLocal()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function download(filename: string, contents: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoking synchronously can cancel the download in some browsers — give it
    // a moment to start reading the blob first.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  function fileNameFor(rec: SignRecording, taken: Set<string>): string {
    const base = `${rec.gloss}_${rec.signer}`.replace(/[^\w-]+/g, '_')
    let name = `${base}.json`
    let n = 2
    while (taken.has(name)) name = `${base}_${n++}.json`
    taken.add(name)
    return name
  }

  function exportRecording(rec: SignRecording) {
    download(fileNameFor(rec, new Set()), JSON.stringify(rec))
  }

  /**
   * Export every local recording as its own file, plus the manifest.json that
   * lists them — exactly the shape public/references/ expects, so the whole
   * library can be committed to the repo instead of living in one browser.
   */
  async function exportAll() {
    if (local.length === 0) return
    const taken = new Set<string>()
    const files = local.map((rec) => ({ rec, name: fileNameFor(rec, taken) }))
    for (const { rec, name } of files) {
      download(name, JSON.stringify(rec))
      // Browsers throttle rapid-fire downloads; space them out.
      await new Promise((r) => setTimeout(r, 300))
    }
    download('manifest.json', JSON.stringify({ files: files.map((f) => f.name) }, null, 2))
    window.alert(
      `Exported ${files.length} recording(s) + manifest.json.\n\n` +
        'Move them all into learn-ssl-module/web/public/references/ and commit — ' +
        'they then ship with the app for the whole team.',
    )
  }

  async function handleDelete(rec: SignRecording) {
    if (!window.confirm(`Delete ${rec.gloss} by ${rec.signer}? This cannot be undone.`)) return
    await deleteRecording(rec.id)
    if (openId === rec.id) setOpenId(null)
    await refreshLocal()
  }

  const rows: Row[] = [
    ...local.map((rec) => ({ rec, bundled: false })),
    ...bundled.map((rec) => ({ rec, bundled: true })),
  ].sort(
    (a, b) =>
      a.rec.gloss.localeCompare(b.rec.gloss) || b.rec.createdAt.localeCompare(a.rec.createdAt),
  )

  return (
    <section className="library-card">
      <div className="library-head">
        <h2>Reference library</h2>
        <span className="library-count">
          {local.length} local · {bundled.length} bundled
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => void exportAll()}
          disabled={local.length === 0}
          title={
            local.length === 0
              ? 'No local recordings to export'
              : 'Download every recording + manifest.json for committing to public/references/'
          }
        >
          Export all for repo
        </button>
        <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => void handleImport(e.target.files)}
        />
      </div>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">
          No recordings yet. Record your first reference sign in the <strong>Record</strong> tab —
          start with the seven avatar glosses (ME, YOU, NAME, WHAT, WHERE, CAN, YOUR).
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map(({ rec, bundled: isBundled }) => (
            <li className="rec-row" key={rec.id}>
              <div className="rec-main">
                <span className="rec-gloss">
                  {rec.gloss}
                  {isBundled && <em className="badge">bundled</em>}
                </span>
                <span className="rec-meta">
                  {rec.signer} · {(rec.durationMs / 1000).toFixed(1)} s · {rec.frames.length}{' '}
                  frames · {new Date(rec.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="rec-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => setOpenId(openId === rec.id ? null : rec.id)}
                >
                  {openId === rec.id ? 'Close' : 'Play'}
                </button>
                <button className="btn btn-ghost" onClick={() => exportRecording(rec)}>
                  Export
                </button>
                {!isBundled && (
                  <button className="btn btn-ghost btn-danger" onClick={() => void handleDelete(rec)}>
                    Delete
                  </button>
                )}
              </div>
              {openId === rec.id && (
                <div className="rec-player">
                  <SkeletonPlayer
                    frames={rec.frames}
                    videoWidth={rec.videoWidth}
                    videoHeight={rec.videoHeight}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
