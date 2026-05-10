"""
Interactive Sign Learning Feedback Demo (MediaPipe Tasks API)
- Records a reference sign (e.g., thumbs-up) by pressing 'r'
- Continuously compares your live hand pose to the reference,
  showing green/yellow/red overlay + textual correction hints.
- Press 'q' to quit.
"""

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
import os
import urllib.request

# ---------- Configuration ----------
FEEDBACK_THRESHOLD_GOOD = 0.05   # similarity below this = green
FEEDBACK_THRESHOLD_OK  = 0.15   # between good and ok = yellow
WINDOW_NAME = "Sign Feedback Demo"
REFERENCE_FILE = "reference_sign.npy"
MODEL_FILE = "hand_landmarker.task"
# -----------------------------------

def download_model():
    """Download the Hand Landmarker model if not already present."""
    if os.path.exists(MODEL_FILE):
        return
    print("Downloading Hand Landmarker model (~15MB)...")
    url = ("https://storage.googleapis.com/mediapipe-models/"
           "hand_landmarker/hand_landmarker/float16/latest/"
           "hand_landmarker.task")
    urllib.request.urlretrieve(url, MODEL_FILE)
    print("Model downloaded.")

def normalize_landmarks(hand_landmarks_proto):
    """Convert Task API hand landmarks into a 21x3 numpy array, normalized."""
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks_proto])
    wrist = pts[0]
    centered = pts - wrist
    scale = np.linalg.norm(pts[9] - wrist)
    if scale < 1e-6:
        return centered
    return centered / scale

def similarity(live_norm, ref_norm):
    """Average Euclidean distance between normalized landmarks."""
    diff = live_norm - ref_norm
    distances = np.linalg.norm(diff, axis=1)
    return np.mean(distances)

def get_feedback_color_and_text(mean_dist):
    if mean_dist < FEEDBACK_THRESHOLD_GOOD:
        return (0, 255, 0), "Great! Sign is correct."
    elif mean_dist < FEEDBACK_THRESHOLD_OK:
        return (0, 255, 255), "Almost there! Check your hand shape."
    else:
        return (0, 0, 255), "Try again." 

def main():
    # Make sure the model is available
    download_model()

    # Create Hand Landmarker
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

    reference_norm = None
    try:
        reference_norm = np.load(REFERENCE_FILE)
        print(f"Loaded reference from {REFERENCE_FILE}")
    except FileNotFoundError:
        print("No reference found. Press 'r' to record a new reference sign.")

    frame_idx = 0  # Used for VIDEO mode timestamp

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue

        frame = cv2.flip(frame, 1)
        # Convert to RGB because Tasks API expects RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # Detect hands (VIDEO mode requires a timestamp in ms)
        frame_idx += 1
        detection_result = landmarker.detect_for_video(mp_image, frame_idx)

        key = cv2.waitKey(5) & 0xFF

        # ---- Record reference if 'r' pressed and a hand is detected ----
        if key == ord('r') and detection_result.hand_landmarks:
            reference_norm = normalize_landmarks(detection_result.hand_landmarks[0])
            np.save(REFERENCE_FILE, reference_norm)
            print("Reference sign recorded!")

        # ---- Draw hand landmarks if present ----
        if detection_result.hand_landmarks:
            # The Task API returns a list of NormalizedLandmark protos per hand
            hand_landmarks = detection_result.hand_landmarks[0]

            # Draw the basic white skeleton
            landmark_points = []
            for lm in hand_landmarks:
                # Convert normalized coordinates (0-1) to pixel coordinates
                h, w, _ = frame.shape
                cx, cy = int(lm.x * w), int(lm.y * h)
                landmark_points.append((cx, cy))

            # Draw connections manually (simplified for demo; we'll use MediaPipe drawing utils if available)
            # But we can still use mp_drawing from solutions? Not imported. We'll draw manually.
            # Drawing connections to keep it clean:
            connections = [(0, 1), (1, 2), (2, 3), (3, 4),  # thumb
                           (0, 5), (5, 6), (6, 7), (7, 8),  # index
                           (0, 9), (9, 10), (10, 11), (11, 12), # middle
                           (0, 13), (13, 14), (14, 15), (15, 16), # ring
                           (0, 17), (17, 18), (18, 19), (19, 20)] # pinky
            for (start, end) in connections:
                pt1 = landmark_points[start]
                pt2 = landmark_points[end]
                cv2.line(frame, pt1, pt2, (255, 255, 255), 1)
            for pt in landmark_points:
                cv2.circle(frame, pt, 2, (255, 255, 255), -1)

            # ---- If reference exists, compare and give feedback ----
            if reference_norm is not None:
                live_norm = normalize_landmarks(hand_landmarks)
                dist = similarity(live_norm, reference_norm)
                color, msg = get_feedback_color_and_text(dist)

                # Draw skeleton again in feedback color (thicker)
                for (start, end) in connections:
                    pt1 = landmark_points[start]
                    pt2 = landmark_points[end]
                    cv2.line(frame, pt1, pt2, color, 3)
                for pt in landmark_points:
                    cv2.circle(frame, pt, 4, color, -1)

                cv2.putText(frame, msg, (10, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
                cv2.putText(frame, f"Similarity distance: {dist:.3f}", (10, 80),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 1)
            else:
                cv2.putText(frame, "Press 'r' to record reference", (10, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 255), 2)
        else:
            cv2.putText(frame, "No hand detected", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

        cv2.imshow(WINDOW_NAME, frame)
        if key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()