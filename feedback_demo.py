"""
Interactive Sign Learning Feedback Demo (MediaPipe Tasks API)
- Records a reference sign (e.g., thumbs-up) by pressing 'r'
- Continuously compares your live hand pose to the reference,
  showing green/yellow/red overlay + textual correction hints.
- Press 'd' to delete the saved reference and reset.
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
FEEDBACK_THRESHOLD_GOOD = 0.05
FEEDBACK_THRESHOLD_OK  = 0.15
WINDOW_NAME = "Sign Feedback Demo"
REFERENCE_FILE = "reference_sign.npy"
MODEL_FILE = "hand_landmarker.task"
# -----------------------------------

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
    pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks_proto])
    wrist = pts[0]
    centered = pts - wrist
    scale = np.linalg.norm(pts[9] - wrist)
    if scale < 1e-6:
        return centered
    return centered / scale

def similarity(live_norm, ref_norm):
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
    download_model()

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
    # Try to load existing reference
    if os.path.exists(REFERENCE_FILE):
        reference_norm = np.load(REFERENCE_FILE)
        print(f"✅ Loaded reference from '{REFERENCE_FILE}'")
    else:
        print("ℹ️  No reference saved yet. Press 'r' to record your first sign.")

    frame_idx = 0

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        frame_idx += 1
        detection_result = landmarker.detect_for_video(mp_image, frame_idx)

        key = cv2.waitKey(5) & 0xFF

        # ---- Record reference ('r') ----
        if key == ord('r') and detection_result.hand_landmarks:
            reference_norm = normalize_landmarks(detection_result.hand_landmarks[0])
            np.save(REFERENCE_FILE, reference_norm)
            print("✅ New reference recorded! Try matching it now.")

        # ---- Delete reference ('d') ----
        if key == ord('d'):
            if os.path.exists(REFERENCE_FILE):
                os.remove(REFERENCE_FILE)
                reference_norm = None
                print("🗑️  Reference deleted. Press 'r' to record a new one.")
            else:
                print("ℹ️  No reference to delete.")

        # ---- Draw landmarks and feedback ----
        if detection_result.hand_landmarks:
            hand_landmarks = detection_result.hand_landmarks[0]

            # Convert to pixel coordinates
            h, w, _ = frame.shape
            landmark_points = [(int(lm.x * w), int(lm.y * h)) for lm in hand_landmarks]

            connections = [
                (0, 1), (1, 2), (2, 3), (3, 4),       # thumb
                (0, 5), (5, 6), (6, 7), (7, 8),       # index
                (0, 9), (9, 10), (10, 11), (11, 12),  # middle
                (0, 13), (13, 14), (14, 15), (15, 16), # ring
                (0, 17), (17, 18), (18, 19), (19, 20)  # pinky
            ]

            # Draw white skeleton
            for (start, end) in connections:
                cv2.line(frame, landmark_points[start], landmark_points[end], (255, 255, 255), 1)
            for pt in landmark_points:
                cv2.circle(frame, pt, 2, (255, 255, 255), -1)

            # Feedback if reference exists
            if reference_norm is not None:
                live_norm = normalize_landmarks(hand_landmarks)
                dist = similarity(live_norm, reference_norm)
                color, msg = get_feedback_color_and_text(dist)

                # Draw colored skeleton thickly
                for (start, end) in connections:
                    cv2.line(frame, landmark_points[start], landmark_points[end], color, 3)
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

        # Show keyboard shortcuts
        cv2.putText(frame, "[r] record   [d] delete reference   [q] quit", (10, frame.shape[0] - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

        cv2.imshow(WINDOW_NAME, frame)
        if key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()