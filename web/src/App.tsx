import { LandmarkCamera } from './components/LandmarkCamera'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <p className="app-kicker">R26-SE-019 · Component 4 — Learning &amp; Practice Module</p>
        <h1>SSL Learn</h1>
        <p className="app-sub">
          Sri Lankan Sign Language practice · dev build — week 1: in-browser hand tracking
        </p>
      </header>

      <main>
        <LandmarkCamera />
      </main>

      <footer className="app-footer">
        Hand tracking runs fully in your browser (MediaPipe HandLandmarker) — no video ever
        leaves your device.
      </footer>
    </div>
  )
}

export default App
