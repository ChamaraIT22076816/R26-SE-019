"""
Advanced Sign Language Learning Demo
- Record multiple signs (press 'r' and type name in terminal)
- Select a sign to practice (press 's' in the camera window)
- Real‑time feedback: color‑coded skeleton, progress bar, streak,
  per‑finger error hints, session timer
- Practice log saved to 'practice_log.csv'
"""

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
import os
import urllib.request
import json
import csv
from datetime import datetime

# ---------- Paths ----------
MODEL_FILE = "hand_landmarker.task"
SIGNS_DB_FILE = "signs_database.json"
LOG_FILE = "practice_log.csv"

# ---------- Feedback settings ----------
MATCH_GREEN  = 0.10
MATCH_YELLOW = 0.22
# 0 – 1 scale: distance ≤ MATCH_GREEN → great

# ---------- MediaPipe constants ----------
CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),          # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),          # index
    (0, 9), (9, 10), (10, 11), (11, 12),      # middle
    (0, 13), (13, 14), (14, 15), (15, 16),    # ring
    (0, 17), (17, 18), (18, 19), (19, 20)     # pinky
]

# Hand landmark names for error hints (21 points)
LANDMARK_NAMES = [
    "Wrist", "Thumb CMC", "Thumb MCP", "Thumb IP", "Thumb TIP",
    "Index MCP", "Index PIP", "Index DIP", "Index TIP",
    "Middle MCP", "Middle PIP", "Middle DIP", "Middle TIP",
    "Ring MCP", "Ring PIP", "Ring DIP", "Ring TIP",
    "Pinky MCP", "Pinky PIP", "Pinky DIP", "Pinky TIP"
]

# ---------- Helper functions ----------
def download_model():
    if os.path.exists(MODEL_FILE):
        return
    print("Downloading Hand Landmarker model (~15MB)...")
    url = ("https://storage.googleapis.com/mediapipe-models/"
           "hand_landmarker/hand_landmarker/float16/latest/"
           "hand_landmarker.task")
    urllib.request.urlretrieve(url, MODEL_FILE)
    print("Model downloaded.")

def normalize_landmarks(hand_landmarks_proto):
    """Convert to 21x3 array, normalise by wrist->middle MCP distance."""
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks_proto])
    wrist = pts[0]
    centered = pts - wrist
    scale = np.linalg.norm(pts[9] - wrist)   # middle finger MCP
    if scale < 1e-6:
        return centered
    return centered / scale

def similarity(live_norm, ref_norm):
    """Euclidean distance averaged over 21 points."""
    diff = live_norm - ref_norm
    return np.mean(np.linalg.norm(diff, axis=1))

def get_feedback(distance):
    """Return (BGR color, message) based on distance thresholds."""
    if distance < MATCH_GREEN:
        return (0, 255, 0), "Excellent!"
    elif distance < MATCH_YELLOW:
        return (0, 255, 255), "Getting closer..."
    else:
        return (0, 0, 255), "Keep trying"

def per_finger_hints(live_norm, ref_norm):
    """
    Compare each landmark's distance and return a list of strings
    for the 3 most deviant landmarks (excluding wrist).
    """
    devs = []
    for i in range(1, 21):   # skip wrist
        d = np.linalg.norm(live_norm[i] - ref_norm[i])
        devs.append((i, d))
    devs.sort(key=lambda x: x[1], reverse=True)   # most deviant first
    hints = []
    for idx, dist in devs[:3]:
        if dist > 0.08:   # only show if significant deviation
            hints.append(f"Check {LANDMARK_NAMES[idx]}")
    return hints

def compute_score(distance):
    """0% at distance >=0.25, 100% at distance 0."""
    max_d = 0.25
    if distance >= max_d:
        return 0.0
    return (1.0 - distance / max_d) * 100.0

def load_signs_db():
    """Load existing sign database from JSON file, or return empty dict."""
    if os.path.exists(SIGNS_DB_FILE):
        with open(SIGNS_DB_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_signs_db(db):
    """Save sign database to JSON file."""
    with open(SIGNS_DB_FILE, 'w') as f:
        json.dump(db, f, indent=2)

def log_practice(sign_name, attempts, avg_score):
    """Append one session entry to the CSV log file."""
    file_exists = os.path.isfile(LOG_FILE)
    with open(LOG_FILE, 'a', newline='') as csvfile:
        writer = csv.writer(csvfile)
        if not file_exists:
            writer.writerow(["Timestamp", "Sign Name", "Attempts", "Average Score (%)"])
        writer.writerow([datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                         sign_name, attempts, f"{avg_score:.1f}"])

# ---------- UI drawing helpers ----------
def draw_progress_bar(img, score, x, y, width=180, height=12):
    """Horizontal bar that fills from left to right."""
    cv2.rectangle(img, (x, y), (x + width, y + height), (50, 50, 50), -1)
    fill = int((score / 100.0) * width)
    cv2.rectangle(img, (x, y), (x + fill, y + height), (0, 255, 0), -1)
    cv2.rectangle(img, (x, y), (x + width, y + height), (200, 200, 200), 1)
    cv2.putText(img, f"{score:.0f}%", (x + 5, y + height - 3),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

def draw_panel(img, text_lines, position, bg_color=(0,0,0), alpha=0.5):
    """Draw a semi-transparent panel with multiple lines of text."""
    h, w = img.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.55
    thickness = 1
    line_height = 25
    padding = 10
    # Calculate panel size
    max_len = max(len(line) for line in text_lines)
    panel_w = max_len * 10 + 2 * padding
    panel_h = len(text_lines) * line_height + 2 * padding
    x, y = position
    # Clip if outside
    if x + panel_w > w:
        x = w - panel_w
    if y + panel_h > h:
        y = h - panel_h
    # Create overlay
    overlay = img.copy()
    cv2.rectangle(overlay, (x, y), (x + panel_w, y + panel_h), bg_color, -1)
    cv2.addWeighted(overlay, alpha, img, 1 - alpha, 0, img)
    # Draw text
    for i, line in enumerate(text_lines):
        cv2.putText(img, line, (x + padding, y + padding + (i+1)*line_height),
                    font, font_scale, (255, 255, 255), thickness)

# ---------- Main application ----------
def main():
    download_model()

    # Hand landmarker setup
    base_options = mp.tasks.BaseOptions(model_asset_path=MODEL_FILE)
    options = vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_tasks.vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.7,
        min_tracking_confidence=0.5)
    landmarker = vision.HandLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    # Load sign database
    signs_db = load_signs_db()
    current_sign_name = None   # name of the sign being practiced
    ref_norm = None
    just_recorded = False
    streak = 0
    last_feedback = None
    total_attempts = 0
    total_score = 0.0
    session_start = datetime.now()

    print("✅ Sign database loaded:", list(signs_db.keys()) if signs_db else "empty")
    print("Controls:")
    print("  'r' - record a new sign (type name in terminal)")
    print("  's' - select sign to practice")
    print("  'd' - delete current sign from database")
    print("  'q' - quit")

    frame_idx = 0

    while True:
        success, frame = cap.read()
        if not success:
            continue

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        frame_idx += 1
        detection = landmarker.detect_for_video(mp_image, frame_idx)

        key = cv2.waitKey(5) & 0xFF

        # ---------- 'r' – Record a new sign ----------
        if key == ord('r') and detection.hand_landmarks:
            # Ask for sign name in terminal
            name = input("Enter a name for this sign (e.g., 'thumbs_up'): ").strip()
            if not name:
                print("Recording cancelled (no name given).")
            else:
                ref_norm = normalize_landmarks(detection.hand_landmarks[0])
                signs_db[name] = ref_norm.tolist()   # convert numpy array to list for JSON
                save_signs_db(signs_db)
                current_sign_name = name
                just_recorded = True
                streak = 0
                total_attempts = 0
                total_score = 0.0
                print(f"✅ Sign '{name}' recorded and stored. Now practicing '{name}'.")

        # ---------- 's' – Select an existing sign to practice ----------
        if key == ord('s'):
            if not signs_db:
                print("No signs in database. Record one first with 'r'.")
            else:
                print("Available signs:", list(signs_db.keys()))
                name = input("Type the sign name to practice: ").strip()
                if name in signs_db:
                    ref_norm = np.array(signs_db[name])
                    current_sign_name = name
                    streak = 0
                    total_attempts = 0
                    total_score = 0.0
                    print(f"🔁 Now practicing '{name}'.")
                else:
                    print(f"Sign '{name}' not found in database.")

        # ---------- 'd' – Delete current/highlighted sign ----------
        if key == ord('d'):
            if current_sign_name and current_sign_name in signs_db:
                print(f"Delete which sign? Current sign is '{current_sign_name}'. "
                      f"Type 'yes' to confirm or type a different name:")
                target = input().strip()
                if target == 'yes':
                    target = current_sign_name
                if target in signs_db:
                    del signs_db[target]
                    save_signs_db(signs_db)
                    if current_sign_name == target:
                        ref_norm = None
                        current_sign_name = None
                    print(f"🗑️ Sign '{target}' deleted.")
                else:
                    print("Sign not found in database.")
            else:
                print("No current sign. Use 's' to select one or type the sign name:")
                target = input().strip()
                if target in signs_db:
                    del signs_db[target]
                    save_signs_db(signs_db)
                    print(f"🗑️ Sign '{target}' deleted.")
                else:
                    print("Sign not found in database.")

        # ---------- Scene drawing ----------
        h, w = frame.shape[:2]

        if detection.hand_landmarks:
            landmarks = detection.hand_landmarks[0]
            # Pixel coordinates for drawing
            pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]

            # White skeleton always
            for (a, b) in CONNECTIONS:
                cv2.line(frame, pts[a], pts[b], (255, 255, 255), 1)
            for pt in pts:
                cv2.circle(frame, pt, 2, (255, 255, 255), -1)

            # ---- If a reference sign is active, give feedback ----
            if ref_norm is not None:
                if just_recorded:
                    # Show recording confirmation for this frame only
                    draw_panel(frame, [f"Sign '{current_sign_name}' recorded!",
                                        "Now try to match it."],
                               (10, 10), bg_color=(0, 100, 0), alpha=0.7)
                    just_recorded = False
                else:
                    live_norm = normalize_landmarks(landmarks)
                    dist = similarity(live_norm, ref_norm)
                    color, msg = get_feedback(dist)
                    score = compute_score(dist)
                    total_attempts += 1
                    total_score += score

                    # Draw colored skeleton
                    for (a, b) in CONNECTIONS:
                        cv2.line(frame, pts[a], pts[b], color, 3)
                    for pt in pts:
                        cv2.circle(frame, pt, 4, color, -1)

                    # Feedback text
                    cv2.putText(frame, msg, (10, 70),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
                    cv2.putText(frame, f"Sign: {current_sign_name}", (10, 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1)

                    # Progress bar + score
                    draw_progress_bar(frame, score, 10, h - 50, width=180)
                    cv2.putText(frame, f"Avg Score: {(total_score/total_attempts):.0f}%",
                                (10, h - 60), cv2.FONT_HERSHEY_SIMPLEX,
                                0.5, (200, 200, 200), 1)

                    # Streak
                    if dist < MATCH_GREEN:
                        if last_feedback != "green":
                            streak = 1
                        else:
                            streak += 1
                        last_feedback = "green"
                    elif dist < MATCH_YELLOW:
                        if last_feedback != "yellow":
                            streak = 0
                        last_feedback = "yellow"
                    else:
                        if last_feedback != "red":
                            streak = 0
                        last_feedback = "red"
                    cv2.putText(frame, f"Streak: {streak}", (200, h - 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 1)

                    # Per‑finger hints
                    hints = per_finger_hints(live_norm, ref_norm)
                    if hints:
                        draw_panel(frame, hints, (400, 10), bg_color=(50, 50, 50), alpha=0.6)
            else:
                # No sign selected
                cv2.putText(frame, "No sign selected.", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 1)
        else:
            cv2.putText(frame, "No hand detected", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 1)

        # Bottom‑right: sign count & timer
        timer_str = str(datetime.now() - session_start).split('.')[0]
        cv2.putText(frame, f"Signs: {len(signs_db)}  |  Session: {timer_str}",
                    (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

        # Keyboard shortcuts reminder
        cv2.putText(frame, "[r] record  [s] select  [d] delete  [q] quit",
                    (w - 400, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

        cv2.imshow("Sign Learning Module", frame)

        if key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

    # ---------- End of session: log practice data ----------
    if current_sign_name and total_attempts > 0:
        avg_score = total_score / total_attempts
        log_practice(current_sign_name, total_attempts, avg_score)
        print(f"📊 Session for '{current_sign_name}' logged: {total_attempts} attempts, "
              f"average score {avg_score:.1f}%")
    elif total_attempts > 0:
        # If somehow attempts but no sig? just log generic
        log_practice("unknown", total_attempts, total_score/total_attempts)
    print("👋 Goodbye!")

if __name__ == "__main__":
    main()