import os
import cv2
import json
import re
import numpy as np
import mediapipe as mp

from pathlib import Path
from tqdm import tqdm
from collections import defaultdict


# ============================================================
# Utility Function
# ============================================================

def extract_keypoints(results):
    """
    Extract pose + left hand + right hand landmarks
    and flatten into a single vector.
    """

    # Pose landmarks (33 landmarks × 4 values)
    pose = (
        np.array(
            [
                [res.x, res.y, res.z, res.visibility]
                for res in results.pose_landmarks.landmark
            ]
        ).flatten()
        if results.pose_landmarks
        else np.zeros(33 * 4)
    )

    # Left hand landmarks (21 landmarks × 3 values)
    lh = (
        np.array(
            [
                [res.x, res.y, res.z]
                for res in results.left_hand_landmarks.landmark
            ]
        ).flatten()
        if results.left_hand_landmarks
        else np.zeros(21 * 3)
    )

    # Right hand landmarks (21 landmarks × 3 values)
    rh = (
        np.array(
            [
                [res.x, res.y, res.z]
                for res in results.right_hand_landmarks.landmark
            ]
        ).flatten()
        if results.right_hand_landmarks
        else np.zeros(21 * 3)
    )

    return np.concatenate([pose, lh, rh])


# ============================================================
# Main Loader Class
# ============================================================

class KaggleDataLoader:
    """
    Sinhala Sign Language Dataset Loader
    """

    def __init__(self, data_path='data/raw', processed_path='data/processed'):

        self.data_path = Path(data_path)
        self.processed_path = Path(processed_path)

        self.processed_path.mkdir(parents=True, exist_ok=True)

        # MediaPipe Holistic
        self.mp_holistic = mp.solutions.holistic

        self.holistic = self.mp_holistic.Holistic(
            static_image_mode=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

    # ========================================================
    # Discover Dataset Structure
    # ========================================================

    def discover_dataset_structure(self):

        print("=" * 60)
        print("Discovering Kaggle Dataset Structure")
        print("=" * 60)

        archive_path = self.data_path / "archive"

        if not archive_path.exists():
            archive_path = self.data_path

        print(f"Looking in: {archive_path}")

        categories = [d for d in archive_path.iterdir() if d.is_dir()]

        print(f"\nFound {len(categories)} categories:")

        for cat in categories:

            video_count = (
                len(list(cat.glob("*.mp4"))) +
                len(list(cat.glob("*.MP4"))) +
                len(list(cat.glob("*.avi"))) +
                len(list(cat.glob("*.mov"))) +
                len(list(cat.glob("*.mkv")))
            )

            print(f"  📁 {cat.name}: {video_count} videos")

        return archive_path, categories

    # ========================================================
    # Extract Label
    # ========================================================

    def extract_label_from_filename(self, filename, category):

        name = Path(filename).stem
        name_lower = name.lower()

        # Numbers
        if "20-99" in category or "100" in category:

            numbers = re.findall(r"\d+", name)

            if numbers:
                return f"Number_{numbers[0]}"

            return "Number"

        # Alphabet
        if "A-Z" in category:

            letters = re.findall(r"[A-Za-z]", name)

            if letters:
                return f"Alphabet_{letters[0].upper()}"

            return "Alphabet"

        # Months
        if "Months" in category:

            months = {
                "jan": "January",
                "feb": "February",
                "mar": "March",
                "apr": "April",
                "may": "May",
                "jun": "June",
                "jul": "July",
                "aug": "August",
                "sep": "September",
                "oct": "October",
                "nov": "November",
                "dec": "December",
            }

            for key, value in months.items():
                if key in name_lower:
                    return value

        # Sentences
        if "Sentence" in category:
            return f"Sentence_{name}"

        # Default
        clean_name = (
            name.replace("_", " ")
            .replace("-", " ")
            .strip()
        )

        return clean_name

    # ========================================================
    # Extract Landmarks From Video
    # ========================================================

    def extract_landmarks_from_video(self, video_path, sequence_length=30):

        cap = cv2.VideoCapture(str(video_path))

        if not cap.isOpened():
            print(f"❌ Could not open {video_path.name}")
            return None

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if total_frames < sequence_length:
            cap.release()
            return None

        indices = np.linspace(
            0,
            total_frames - 1,
            sequence_length,
            dtype=int
        )

        landmark_sequence = []

        frame_idx = 0
        sample_idx = 0

        while cap.isOpened() and sample_idx < len(indices):

            ret, frame = cap.read()

            if not ret:
                break

            if frame_idx == indices[sample_idx]:

                # Resize
                frame = cv2.resize(frame, (640, 480))

                # Convert BGR → RGB
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                image.flags.writeable = False

                # Process frame
                results = self.holistic.process(image)

                # Extract keypoints
                keypoints = extract_keypoints(results)

                landmark_sequence.append(keypoints)

                sample_idx += 1

            frame_idx += 1

        cap.release()

        if len(landmark_sequence) == sequence_length:
            return np.array(landmark_sequence)

        return None

    # ========================================================
    # Process Entire Dataset
    # ========================================================

    def process_all_videos(
        self,
        max_videos_per_category=None,
        sequence_length=30,
        sample_ratio=1.0
    ):

        archive_path, categories = self.discover_dataset_structure()

        all_sequences = []
        all_labels = []

        category_stats = defaultdict(int)

        for category in tqdm(categories, desc="Processing categories"):

            category_name = category.name

            print(f"\n📹 Processing: {category_name}")

            video_files = []

            for ext in ["*.mp4", "*.MP4", "*.avi", "*.mov", "*.mkv"]:
                video_files.extend(category.glob(ext))

            # Sampling
            if sample_ratio < 1.0:

                n_samples = max(1, int(len(video_files) * sample_ratio))

                video_files = list(
                    np.random.choice(
                        video_files,
                        n_samples,
                        replace=False
                    )
                )

            # Limit
            if max_videos_per_category:
                video_files = video_files[:max_videos_per_category]

            print(f"  Found {len(video_files)} videos")

            for video_path in tqdm(
                video_files,
                desc=f"  Extracting from {category_name}",
                leave=False
            ):

                label = self.extract_label_from_filename(
                    video_path.name,
                    category_name
                )

                sequence = self.extract_landmarks_from_video(
                    video_path,
                    sequence_length
                )

                if sequence is not None:

                    all_sequences.append(sequence)
                    all_labels.append(label)

                    category_stats[category_name] += 1

        # Convert to arrays
        X = np.array(all_sequences)
        y = np.array(all_labels)

        print("\n" + "=" * 60)
        print("PROCESSING COMPLETE")
        print("=" * 60)

        print(f"Total sequences: {len(X)}")
        print(f"Unique classes: {len(np.unique(y))}")
        print(f"Dataset shape: {X.shape}")

        print("\nCategory Stats:")

        for cat, count in category_stats.items():
            print(f"  {cat}: {count}")

        # Save processed data
        processed_file = self.processed_path / "landmark_sequences.npz"

        np.savez(processed_file, X=X, y=y)

        print(f"\n✅ Saved processed data to:")
        print(processed_file)

        # Save label mapping
        unique_labels = np.unique(y)

        label_mapping = {
            int(i): str(label)
            for i, label in enumerate(unique_labels)
        }

        with open(
            self.processed_path / "label_mapping.json",
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                label_mapping,
                f,
                ensure_ascii=False,
                indent=2
            )

        return X, y

    # ========================================================
    # Dataset Summary
    # ========================================================

    def create_data_summary(self):

        processed_file = self.processed_path / "landmark_sequences.npz"

        if not processed_file.exists():
            print("❌ No processed dataset found")
            return

        data = np.load(processed_file, allow_pickle=True)

        X = data["X"]
        y = data["y"]

        print("\n" + "=" * 60)
        print("DATASET SUMMARY")
        print("=" * 60)

        print(f"Total samples: {len(X)}")
        print(f"Sequence length: {X.shape[1]}")
        print(f"Feature size: {X.shape[2]}")
        print(f"Classes: {len(np.unique(y))}")

        unique, counts = np.unique(y, return_counts=True)

        print("\nTop Classes:")

        for label, count in zip(unique[:20], counts[:20]):
            print(f"  {label}: {count}")


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":

    loader = KaggleDataLoader(
        data_path="data/raw",
        processed_path="data/processed"
    )

    # Small test run
    X, y = loader.process_all_videos(
        max_videos_per_category=10,
        sample_ratio=0.5
    )

    loader.create_data_summary()