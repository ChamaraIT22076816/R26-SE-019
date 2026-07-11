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

  async function handleImport(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      try {
        const rec = JSON.parse(await file.text()) as SignRecording
        if (typeof rec.gloss !== 'string' || !Array.isArray(rec.frames)) {
          throw new Error('not a recording')
        }
        rec.id ||= crypto.randomUUID()
        await saveRecording(rec)
      } catch {
        window.alert(`"${file.name}" doesn't look like a sign recording JSON.`)
      }
    }
    await refreshLocal()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function exportRecording(rec: SignRecording) {
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rec.gloss}_${rec.signer}`.replace(/[^\w-]+/g, '_') + '.json'
    a.click()
    URL.revokeObjectURL(url)
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
