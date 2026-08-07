import { useState } from 'react'
import { PracticeView } from './components/PracticeView'
import { RecordView } from './components/RecordView'
import { LibraryView } from './components/LibraryView'
import { ProgressView } from './components/ProgressView'
import { ScenarioView } from './components/ScenarioView'
import './components/views.css'

type Tab = 'practice' | 'scenario' | 'record' | 'library' | 'progress'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'practice', label: 'Practice' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'record', label: 'Record' },
  { id: 'library', label: 'Library' },
  { id: 'progress', label: 'Progress' },
]

function App() {
  const [tab, setTab] = useState<Tab>('practice')

  return (
    <div className="app">
      <header className="app-header">
        <p className="app-kicker">R26-SE-019 · Component 4 — Learning &amp; Practice Module</p>
        <h1>SSL Learn</h1>
        <p className="app-sub">
          Sri Lankan Sign Language practice · dev build — weeks 1–5: capture → scoring →
          learner model
        </p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
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
