import numpy as np
import mediapipe as mp
import cv2

# MediaPipe setup
mp_holistic = mp.solutions.holistic
mp_drawing = mp.solutions.drawing_utils


def extract_keypoints(results):
    """
    Extract ONLY pose + hands landmarks.

    Total Features:
    Pose  = 33 * 4 = 132
    Left Hand = 21 * 3 = 63
    Right Hand = 21 * 3 = 63

    TOTAL = 258
    """

    # Pose landmarks
    pose = np.array(
        [
            [res.x, res.y, res.z, res.visibility]
            for res in results.pose_landmarks.landmark
        ]
    ).flatten() if results.pose_landmarks else np.zeros(33 * 4)

    # Left hand landmarks
    lh = np.array(
        [
            [res.x, res.y, res.z]
            for res in results.left_hand_landmarks.landmark
        ]
    ).flatten() if results.left_hand_landmarks else np.zeros(21 * 3)

    # Right hand landmarks
    rh = np.array(
        [
            [res.x, res.y, res.z]
            for res in results.right_hand_landmarks.landmark
        ]
    ).flatten() if results.right_hand_landmarks else np.zeros(21 * 3)

    # FINAL = 258 FEATURES
    keypoints = np.concatenate([pose, lh, rh])

    return keypoints


def draw_styled_landmarks(image, results):
    """
    Draw pose and hand landmarks.
    """

    # Draw pose landmarks
    if results.pose_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.pose_landmarks,
            mp_holistic.POSE_CONNECTIONS,
            mp_drawing.DrawingSpec(
                color=(80, 22, 10),
                thickness=2,
                circle_radius=4
            ),
            mp_drawing.DrawingSpec(
                color=(80, 44, 121),
                thickness=2,
                circle_radius=2
            )
        )

    # Draw left hand landmarks
    if results.left_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.left_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
            mp_drawing.DrawingSpec(
                color=(121, 22, 76),
                thickness=2,
                circle_radius=4
            ),
            mp_drawing.DrawingSpec(
                color=(121, 44, 250),
                thickness=2,
                circle_radius=2
            )
        )

    # Draw right hand landmarks
    if results.right_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.right_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
            mp_drawing.DrawingSpec(
                color=(245, 117, 66),
                thickness=2,
                circle_radius=4
            ),
            mp_drawing.DrawingSpec(
                color=(245, 66, 230),
                thickness=2,
                circle_radius=2
            )
        )

    return image


def prob_viz(res, actions, input_frame, colors):
    """
    Visualize prediction probabilities.
    """

    output_frame = input_frame.copy()

    top_predictions = np.argsort(res)[-5:][::-1]

    for num, idx in enumerate(top_predictions):

        prob = res[idx]

        cv2.rectangle(
            output_frame,
            (0, 60 + num * 40),
            (int(prob * 300), 90 + num * 40),
            colors[num],
            -1
        )

        cv2.putText(
            output_frame,
            f"{actions[idx]} {prob*100:.1f}%",
            (10, 85 + num * 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA
        )

    return output_frame