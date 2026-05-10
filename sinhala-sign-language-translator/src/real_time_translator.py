import cv2
import numpy as np
import tensorflow as tf
import mediapipe as mp
import joblib
from collections import deque, Counter
import time
from utils import extract_keypoints, draw_styled_landmarks, prob_viz


class RealTimeTranslator:
    """
    Real-time Sinhala Sign Language Translator
    """

    def __init__(
        self,
        model_path='../models/ssl_lstm_model.h5',
        encoder_path='../models/label_encoder.pkl'
    ):

        # Load trained model
        self.model = tf.keras.models.load_model(model_path)

        # Load label encoder
        self.label_encoder = joblib.load(encoder_path)
        self.actions = self.label_encoder.classes_

        print("\n✅ Model Loaded Successfully")
        print(f"✅ Total Classes: {len(self.actions)}")

        # MediaPipe Holistic
        self.mp_holistic = mp.solutions.holistic

        self.holistic = self.mp_holistic.Holistic(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

        # Sequence settings
        self.sequence_length = 30
        self.sequence_buffer = deque(maxlen=self.sequence_length)

        # Prediction smoothing
        self.prediction_history = deque(maxlen=5)

        # Sentence builder
        self.sentence = []

        # Prediction controls
        self.last_prediction = ""
        self.last_prediction_time = time.time()

        self.cooldown_seconds = 1.5
        self.confidence_threshold = 0.80

        # Colors for probability bars
        self.colors = [
            (245, 117, 16),
            (117, 245, 16),
            (16, 117, 245)
        ] * 100

    def process_frame(self, frame):

        # Flip webcam
        frame = cv2.flip(frame, 1)

        # Convert BGR -> RGB
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        image.flags.writeable = False

        # MediaPipe detection
        results = self.holistic.process(image)

        image.flags.writeable = True

        # RGB -> BGR
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

        # Draw landmarks
        draw_styled_landmarks(image, results)

        # Extract keypoints
        keypoints = extract_keypoints(results)

        # IMPORTANT DEBUG
        print("Keypoints Shape:", keypoints.shape)

        # Must be 258
        if keypoints.shape[0] != 258:
            print(f"❌ ERROR: Expected 258 features, got {keypoints.shape[0]}")
            return image, None, 0

        # Add to sequence
        self.sequence_buffer.append(keypoints)

        prediction = None
        confidence = 0

        # Predict only when sequence is full
        if len(self.sequence_buffer) == self.sequence_length:

            sequence = np.expand_dims(
                np.array(self.sequence_buffer),
                axis=0
            )

            # IMPORTANT DEBUG
            print("Prediction Input Shape:", sequence.shape)

            try:
                res = self.model.predict(sequence, verbose=0)[0]

                confidence = np.max(res)

                predicted_index = np.argmax(res)

                prediction = self.actions[predicted_index]

                # Add smoothing
                self.prediction_history.append(prediction)

                if len(self.prediction_history) == self.prediction_history.maxlen:

                    majority_prediction = Counter(
                        self.prediction_history
                    ).most_common(1)[0][0]

                    current_time = time.time()

                    if (
                        confidence > self.confidence_threshold
                        and majority_prediction != self.last_prediction
                        and (
                            current_time - self.last_prediction_time
                            > self.cooldown_seconds
                        )
                    ):

                        self.sentence.append(majority_prediction)

                        self.last_prediction = majority_prediction

                        self.last_prediction_time = current_time

                        print(
                            f"✅ Recognized: {majority_prediction} "
                            f"({confidence*100:.2f}%)"
                        )

                # Draw probabilities
                image = prob_viz(
                    res,
                    self.actions,
                    image,
                    self.colors
                )

            except Exception as e:
                print(f"❌ Prediction Error: {e}")

        # Show current prediction
        if prediction:

            cv2.putText(
                image,
                f"{prediction} ({confidence*100:.1f}%)",
                (10, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                2,
                cv2.LINE_AA
            )

        return image, prediction, confidence

    def get_translated_text(self):

        if len(self.sentence) == 0:
            return ""

        return " ".join(self.sentence[-10:])

    def run(self):

        cap = cv2.VideoCapture(0)

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        print("\n" + "=" * 60)
        print("🎥 Sinhala Sign Language Translator")
        print("=" * 60)
        print("Controls:")
        print("  q → Quit")
        print("  c → Clear sentence")
        print("=" * 60)

        while cap.isOpened():

            ret, frame = cap.read()

            if not ret:
                print("❌ Failed to read webcam")
                break

            processed_frame, prediction, confidence = self.process_frame(frame)

            # Create bottom panel
            h, w = processed_frame.shape[:2]

            panel = np.zeros((100, w, 3), dtype=np.uint8)

            translated_text = self.get_translated_text()

            cv2.putText(
                panel,
                f"Translation: {translated_text}",
                (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (255, 255, 255),
                2,
                cv2.LINE_AA
            )

            # Combine
            display = np.vstack([processed_frame, panel])

            cv2.imshow(
                "Sinhala Sign Language Translator",
                display
            )

            key = cv2.waitKey(10) & 0xFF

            if key == ord('q'):
                break

            elif key == ord('c'):
                self.sentence = []
                self.prediction_history.clear()
                print("🗑 Sentence Cleared")

        cap.release()

        cv2.destroyAllWindows()


if __name__ == "__main__":

    translator = RealTimeTranslator()

    translator.run()
    