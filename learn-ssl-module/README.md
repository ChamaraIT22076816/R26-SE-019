# Interactive Sign Language Learning Module – PP1 Proof of Concept

## Overview

This project demonstrates a real‑time, interactive sign language learning system built with Python, MediaPipe, and OpenCV.  
It was developed as the first‑phase prototype for the **“Interactive Sign Language Learning and Practice Module”** described in the research proposal (R26‑SE‑019).

The system allows a hearing learner to:

- Record reference signs (e.g., thumbs‑up, “hello”) using their webcam.
- Practise signs and receive **immediate, colour‑coded feedback** (green/yellow/red).
- See **detailed corrective hints** showing which fingers need adjustment.
- Track progress with a **streak counter, progress bar, and average score**.
- Save and load multiple signs from a local database.
- Log practice sessions to a CSV file for later analysis.

All code runs on a standard laptop webcam with no special hardware.

---

## What we built

### 1. Basic Hand Landmark Detection & Feedback (`feedback_demo.py`)

- Captures webcam feed.
- Runs MediaPipe Hand Landmarker to extract 21 hand landmarks.
- Normalises landmarks (makes them position/scale‑invariant).
- Records a reference sign by pressing `r`.
- Compares live hand pose to the reference using Euclidean distance.
- Draws a **white skeleton** when no reference is present, and a **colour‑coded skeleton** (green/yellow/red) when comparing.
- Shows textual feedback messages.
- Allows deleting the reference with `d`.

### 2. Advanced Multi‑Sign Learning Module (`sign_learning_demo.py`)

- Extends the basic demo with:
  - **Multi‑sign database** stored in a JSON file.
  - **Sign selection** (press `s` and type name) and recording (press `r` and type name).
  - **Per‑finger error hints** – identifies which landmarks deviate most from the reference.
  - **Progress bar** showing percentage match.
  - **Streak counter** for consecutive correct frames.
  - **Average session score**.
  - **Session timer**.
  - **Practice log** saved to `practice_log.csv` on exit.
  - Semi‑transparent UI panels and a cleaner HUD.

---

## Environment Setup

### Prerequisites
- Python 3.10+ (tested on 3.14)
- Windows / macOS / Linux
- Webcam

### Installation

```bash
# 1. Create project folder
mkdir SignLanguageLearningModule
cd SignLanguageLearningModule

# 2. Create virtual environment
python -m venv venv

# 3. Activate (Windows)
venv\Scripts\activate
# or (macOS/Linux)
source venv/bin/activate

# 4. Install dependencies
pip install --upgrade pip
pip install mediapipe opencv-python numpy
```

*Note:* MediaPipe 0.10.30+ (the only version supporting Python 3.14) uses the new **Tasks API**. The scripts are written for that API, so no downgrade is needed.

---

## File Structure

```
SignLanguageLearningModule/
├── venv/                     # Virtual environment
├── feedback_demo.py          # Basic single‑sign demo
├── sign_learning_demo.py     # Advanced multi‑sign module
├── hand_landmarker.task      # Auto‑downloaded model
├── signs_database.json       # Saved signs (created after recording)
├── reference_sign.npy        # (Only used by basic demo)
└── practice_log.csv          # Session log (after using advanced demo)
```

---

## How to Run

### Basic Demo
```bash
python feedback_demo.py
```

### Advanced Module
```bash
python sign_learning_demo.py
```

Controls are displayed on the bottom of the camera window.

---

## Key Concepts & Algorithms

### 1. MediaPipe Hand Landmarks
- 21 3D points per hand (x, y, z).
- Extracted using `HandLandmarker` in `VIDEO` mode.

### 2. Landmark Normalisation
- Position invariance: centre all landmarks on the wrist (landmark 0).
- Scale invariance: divide by the distance from wrist to middle finger MCP (landmark 9).
- This ensures the same sign works regardless of hand size or distance from camera.

### 3. Similarity Metric
- Mean Euclidean distance between corresponding normalised landmarks.
- Lower distance → more similar.

### 4. Feedback Generation
- **Green** (distance < 0.10) – “Excellent!”
- **Yellow** (0.10 ≤ distance < 0.22) – “Getting closer...”
- **Red** (distance ≥ 0.22) – “Keep trying”
- Per‑finger hints: list the top 3 landmarks with distance > 0.08, ordered by deviation.

### 5. Adaptive Elements
- **Streak counter** resets on yellow or red, encouraging consistent quality.
- **Average score** over a session gives a macro‑view of progress.
- The progress bar normalises distance to a 0–100% scale (0% at distance ≥ 0.25, 100% at 0.0).

---

## Troubleshooting

### `AttributeError: module 'mediapipe' has no attribute 'solutions'`
- You are using MediaPipe ≥0.10.31, which removed the `solutions` module.
- Our scripts use the *Tasks API* (`mediapipe.tasks`), so they work correctly. Make sure you are running the latest version of the scripts (not an old `solutions`‑based one).

### Camera not opening
- Ensure no other application is using the webcam.
- On Windows, check privacy settings allow camera access for Python/terminal.

### Errors when installing mediapipe
- For Python 3.14, use `pip install mediapipe` (it will fetch 0.10.35 or later).
- No need to force a specific version; the scripts are compatible.

---

## Mapping to Research Proposal Objectives

| Proposal Objective | Proof of Concept |
|--------------------|------------------|
| Real‑time gesture feedback with corrective guidance | Colour‑coded skeleton, textual feedback, per‑finger hints |
| Multi‑sign vocabulary support | JSON database, recording & selection by name |
| Adaptive learning (personalised practice) | Streak counter, average score, error pattern hints |
| Seamless transition to communication | Built on the same hand‑tracking backbone that will power the full system |
| Gamification features | Progress bar, streak, session timer |

---

## Demo Script for Progress Presentation

1. **Launch the advanced module** (`sign_learning_demo.py`).
2. **Show the empty database** (“Signs: 0”).
3. **Record first sign**: press `r`, type `thumbs_up`, hold the sign.
4. The display says “Sign ‘thumbs_up’ recorded! Now try to match it.”
5. **Practise the sign**: match the pose → green skeleton, high progress bar, streak builds.
6. **Do it wrong**: open palm → red skeleton, hints show “Check Index TIP” etc.
7. **Record second sign**: `r`, type `open_palm`.
8. **Switch signs**: press `s`, type `thumbs_up` – demonstra switching.
9. **Delete a sign**: press `d`, follow terminal prompts.
10. **Quit** (`q`) → show the generated `practice_log.csv` with session data.

---

## Future Enhancements (Beyond PP1)
- Add more granular feedback (movement trajectory analysis).
- Integrate with the team’s transformer‑based recognition engine (Component 1).
- Build React Native mobile interface.
- Add gamified scenario simulations.
- Implement adaptive curriculum with reinforcement learning.

---

## Credits

Developed as part of the **R26‑SE‑019** project at SLIIT, 2026.  
Code and guidance provided by the AI assistant in collaboration with the student.
```