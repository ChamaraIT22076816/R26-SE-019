import { useEffect, useState } from 'react'
import { PracticeView } from './components/PracticeView'
import { RecordView } from './components/RecordView'
import { LibraryView } from './components/LibraryView'
import { ProgressView } from './components/ProgressView'
import { ScenarioView } from './components/ScenarioView'
import './components/views.css'

type Tab = 'practice' | 'scenario' | 'record' | 'library' | 'progress'

/**
 * Tab glyphs. Inline paths rather than an icon package — five icons is not
 * worth a dependency, and these inherit currentColor so they follow the tab's
 * active/inactive state for free. They are decorative: every tab keeps its
 * text label, so the icon is never the only cue. Shown only in the mobile
 * bottom bar, where a label alone reads as a row of links rather than a nav.
 */
const ICONS: Record<Tab, string> = {
  // a hand, mid-sign
  practice:
    'M8 11V6.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6.5a1.5 1.5 0 0 1 3 0V13a6 6 0 0 1-6 6a5 5 0 0 1-4.3-2.4L6 14.6a1.5 1.5 0 0 1 2.5-1.6',
  // a speech bubble
  scenario: 'M20 12a7 7 0 0 1-7 7H8l-4 3v-10a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z',
  // a record dot
  record: 'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16Zm0 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z',
  // stacked cards
  library: 'M4 7h16M4 12h16M4 17h10',
  // a rising bar chart
  progress: 'M4 20V12m5 8V5m5 15v-6m5 6V9',
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'practice', label: 'Practice' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'record', label: 'Record' },
  { id: 'library', label: 'Library' },
  { id: 'progress', label: 'Progress' },
]

function App() {
  const [tab, setTab] = useState<Tab>('practice')

  // The tracking engine is a lazy chunk (see vision/handTracker.ts), which
  // keeps it off the critical path. Warm it once the page is idle so that
  // "Start camera" is still a cache hit rather than a cold 135 KB fetch.
  useEffect(() => {
    const warm = () => void import('@mediapipe/tasks-vision')
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm)
      return () => cancelIdleCallback(id)
    }
    // Safari has no requestIdleCallback; a timeout is close enough for a prefetch.
    const id = window.setTimeout(warm, 2000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <p className="app-kicker">R26-SE-019 · Component 4 — Learning &amp; Practice Module</p>
        <h1>SSL Learn</h1>
        <p className="app-sub">
          Learn and practise Sri Lankan Sign Language — record a sign, get it scored against a
          reference, and see what to fix.
        </p>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              // The active tab is otherwise signalled by colour alone, which a
              // screen reader cannot convey.
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <svg
                className="tab-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={ICONS[t.id]} />
              </svg>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'practice' && <PracticeView />}
        {tab === 'scenario' && <ScenarioView />}
        {tab === 'record' && <RecordView />}
        {tab === 'library' && <LibraryView />}
        {tab === 'progress' && <ProgressView />}
      </main>

      <footer className="app-footer">
        Hand tracking runs fully in your browser (MediaPipe HandLandmarker) — no video ever
        leaves your device.
      </footer>
    </div>
  )
}

export default App
