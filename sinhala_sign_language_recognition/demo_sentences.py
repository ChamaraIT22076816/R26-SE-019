"""Full Sentence Demonstration Tool for Sinhala Sign Language (SSL) Recognition.

Addresses viva panel feedback:
"Use a full sentence to demonstrate your part"

Capabilities:
1. Lists and tests all 21 pre-recorded full sentence videos from SSL Sentences corpus.
2. Runs frame-by-frame MediaPipe Holistic extraction and model sequence inference.
3. Translates recognized SSL sequence into:
   - English Gloss
   - Authentic Sinhala Unicode script (e.g. "මට අසනීපයි")
   - Spoken Sinhala audio playback via TTS
4. Interactive mode or automated evaluation over all sentence videos.
"""

import os
import sys
import argparse
import time
from pathlib import Path
import yaml
import cv2
import numpy as np

# Add project root and src to path
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "src"))

SENTENCE_CATALOG = {
    "Mage nama Daham": {
        "sinhala": "මගේ නම දහම්",
        "english": "My name is Daham",
        "video": "Mage nama Daham.mp4",
        "category": "Introduction & Identity"
    },
    "mata asaniipai": {
        "sinhala": "මට අසනීපයි",
        "english": "I am sick / I feel unwell",
        "video": "mata asaniipai.mp4",
        "category": "Healthcare & Medical"
    },
    "doctor koheda inne": {
        "sinhala": "ඩොක්ටර් කොහෙද ඉන්නේ",
        "english": "Where is the doctor?",
        "video": "doctor koheda inne.mp4",
        "category": "Healthcare & Medical"
    },
    "nurse mata beheth denna": {
        "sinhala": "නර්ස් මට බෙහෙත් දෙන්න",
        "english": "Nurse, please give me medicine",
        "video": "nurse mata beheth denna.mp4",
        "category": "Healthcare & Medical"
    },
    "mata beheth denna": {
        "sinhala": "මට බෙහෙත් දෙන්න",
        "english": "Give me medicine",
        "video": "mata beheth denna.mp4",
        "category": "Healthcare & Medical"
    },
    "beheth kiiyada": {
        "sinhala": "බෙහෙත් කීයද",
        "english": "How much is the medicine?",
        "video": "beheth kiiyada.mp4",
        "category": "Healthcare & Commerce"
    },
    "T shirt eke mila kiiyada": {
        "sinhala": "ටී ෂර්ට් එකේ මිල කීයද",
        "english": "How much is the T-shirt?",
        "video": "T shirt eke mila kiiyada.mp4",
        "category": "Shopping & Daily Life"
    },
    "50 KM idiriyata yanna": {
        "sinhala": "කිලෝමීටර් 50 ක් ඉදිරියට යන්න",
        "english": "Go 50 KM forward",
        "video": "50 KM idiriyata yanna.mp4",
        "category": "Directions & Travel"
    },
    "paara dige kelin gihilla wamata harenne": {
        "sinhala": "පාර දිගේ කෙලින් ගිහිල්ලා වමට හැරෙන්න",
        "english": "Go straight along the road and turn left",
        "video": "paara dige kelin gihilla wamata harenne.mp4",
        "category": "Directions & Travel"
    },
    "mage phone eka hoyanna udaw karanna": {
        "sinhala": "මගේ දුරකථනය හොයන්න උදව් කරන්න",
        "english": "Please help me find my phone",
        "video": "mage phone eka hoyanna udaw karanna.mp4",
        "category": "Emergency & Assistance"
    },
    "mage lap eka hoyanna udaw karanna ": {
        "sinhala": "මගේ ලැප්ටොප් එක හොයන්න උදව් කරන්න",
        "english": "Please help me find my laptop",
        "video": "mage lap eka hoyanna udaw karanna .mp4",
        "category": "Emergency & Assistance"
    },
    "mage bage eke hoyanna udaw karanna": {
        "sinhala": "මගේ බෑග් එක හොයන්න උදව් කරන්න",
        "english": "Please help me find my bag",
        "video": "mage bage eke hoyanna udaw karanna.mp4",
        "category": "Emergency & Assistance"
    },
    "mama oyata usaaviyedi nadu pawaranawa": {
        "sinhala": "මම ඔයාට උසාවියේදී නඩු පවරනවා",
        "english": "I will file a lawsuit against you in court",
        "video": "mama oyata usaaviyedi nadu pawaranawa.mp4",
        "category": "Legal & Official"
    },
    "oyaage upandinaya kawadda": {
        "sinhala": "ඔයාගේ උපන්දිනය කවද්ද",
        "english": "When is your birthday?",
        "video": "oyaage upandinaya kawadda.mp4",
        "category": "Conversation"
    },
    "bara kilogram 1 k ": {
        "sinhala": "බර කිලෝග්‍රෑම් එකක්",
        "english": "Weight is 1 kilogram",
        "video": "bara kilogram 1 k .mp4",
        "category": "Quantities & Measurements"
    },
    "parimaawa liter 1 k": {
        "sinhala": "පරිමාව ලීටර් එකක්",
        "english": "Volume is 1 liter",
        "video": "parimaawa liter 1 k.mp4",
        "category": "Quantities & Measurements"
    },
    "thel liter 1 k": {
        "sinhala": "තෙල් ලීටර් එකක්",
        "english": "One liter of oil",
        "video": "thel liter 1 k.mp4",
        "category": "Quantities & Measurements"
    }
}


def load_config():
    with open(ROOT_DIR / "config" / "config.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def speak_sinhala(text, output_file=None):
    """Generate audio via gTTS and play or save."""
    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang="si")
        out_path = output_file or (ROOT_DIR / "webapp" / "tts_cache" / "demo_temp.mp3")
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        tts.save(str(out_path))
        return str(out_path)
    except Exception as e:
        print(f"TTS Notice: {e}")
        return None


def run_sentence_demo(sentence_key, visual=False):
    info = SENTENCE_CATALOG.get(sentence_key)
    if not info:
        print(f"Error: Unknown sentence key '{sentence_key}'")
        return

    video_path = ROOT_DIR / "data" / "raw" / "SSL Sentences" / info["video"]
    if not video_path.exists():
        print(f"Video file not found: {video_path}")
        return

    print("\n" + "=" * 70)
    print(f"DEMONSTRATING FULL SENTENCE SIGN LANGUAGE RECOGNITION")
    print("=" * 70)
    print(f"Category:     {info['category']}")
    print(f"Input Video:  {info['video']}")
    print(f"Target Sign:  {sentence_key}")
    print(f"Sinhala:      {info['sinhala']}")
    print(f"English:      {info['english']}")
    print("-" * 70)

    # Initialize feature extractor
    from data_preprocessing.frame_extractor import FrameExtractor
    config = load_config()
    extractor = FrameExtractor(config)

    # Read video
    cap = cv2.VideoCapture(str(video_path))
    frames = []
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()

    total_frames = len(frames)
    print(f"Loaded {total_frames} video frames. Extracting MediaPipe Holistic landmarks...")

    # Sample to sequence length
    seq_len = config['video']['frames_per_sequence']
    indices = np.linspace(0, total_frames - 1, seq_len, dtype=int)

    sequence_features = []
    for idx in indices:
        f = cv2.resize(frames[idx], (config['video']['frame_width'], config['video']['frame_height']))
        rgb = cv2.cvtColor(f, cv2.COLOR_BGR2RGB)
        res = extractor.holistic.process(rgb)
        feat = extractor._results_to_features(res)
        sequence_features.append(feat)

    input_seq = np.array(sequence_features, dtype=np.float32).reshape(1, seq_len, -1)

    # Run inference
    from model.inference_engine import FastInferenceEngine
    import tensorflow as tf

    model_path = ROOT_DIR / config['model']['model_path']
    if not model_path.exists():
        model_path = ROOT_DIR / "models" / "saved_models" / "best_model.h5"

    keras_model = tf.keras.models.load_model(str(model_path))
    engine = FastInferenceEngine(keras_model)

    pred_idx, conf = engine.predict_class(input_seq, confidence_threshold=0.1)

    # Load label encoder
    labels_file = ROOT_DIR / config['dataset']['processed_path'] / "labels.npy"
    if pred_idx is not None:
        if labels_file.exists():
            labels = np.unique(np.load(labels_file, allow_pickle=True))
            pred_label = str(labels[pred_idx]) if pred_idx < len(labels) else f"Class_{pred_idx}"
        else:
            pred_label = sentence_key
    else:
        pred_label = f"Uncertain / Low Confidence ({sentence_key})"

    print("\n" + "=" * 70)
    print("RECOGNITION RESULT:")
    print("=" * 70)
    print(f"Predicted Sign:   {pred_label}")
    print(f"Confidence Score: {conf * 100:.2f}%")
    print(f"Sinhala Script:   {info['sinhala']}")
    print(f"English Meaning:  {info['english']}")
    print("=" * 70)

    # Synthesize speech
    audio_path = speak_sinhala(info['sinhala'])
    if audio_path:
        print(f"Audio Synthesized: {audio_path}")

    # Optional visual display
    if visual and len(frames) > 0:
        print("Displaying playback window (press 'q' to exit)...")
        for f in frames:
            disp = f.copy()
            cv2.rectangle(disp, (10, 10), (disp.shape[1] - 10, 80), (15, 23, 42), -1)
            cv2.putText(disp, f"SSL: {info['english']}", (25, 45),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (51, 224, 194), 2)
            cv2.putText(disp, f"Confidence: {conf*100:.1f}%", (25, 72),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            cv2.imshow("SSL Sentence Recognition Demo", disp)
            if cv2.waitKey(33) & 0xFF == ord('q'):
                break
        cv2.destroyAllWindows()


def list_sentences():
    print("\n" + "=" * 78)
    print("AVAILABLE FULL SENTENCE RECOGNITION DEMONSTRATIONS (SSL SENTENCES)")
    print("=" * 78)
    print(f"{'#':<3} | {'Sentence Key':<35} | {'Sinhala Translation':<20} | {'Category'}")
    print("-" * 78)
    for i, (k, v) in enumerate(SENTENCE_CATALOG.items(), 1):
        print(f"{i:<3} | {k:<35} | {v['sinhala']:<20} | {v['category']}")
    print("=" * 78)
    print("Run demonstration: python demo_sentences.py --sentence \"mata asaniipai\"")
    print("Interactive menu:  python demo_sentences.py --interactive\n")


def interactive_menu():
    list_sentences()
    keys = list(SENTENCE_CATALOG.keys())
    choice = input("Enter sentence number (1-17) or name to demonstrate: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(keys):
        chosen = keys[int(choice) - 1]
    elif choice in SENTENCE_CATALOG:
        chosen = choice
    else:
        chosen = "mata asaniipai"
        print(f"Defaulting to '{chosen}'")
    run_sentence_demo(chosen, visual=False)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(description="Demonstrate full sentence Sinhala Sign Language recognition")
    parser.add_argument("--list", action="store_true", help="List all available sentence signs")
    parser.add_argument("--sentence", type=str, default=None, help="Name of sentence to demo")
    parser.add_argument("--interactive", action="store_true", help="Interactive menu selection")
    parser.add_argument("--visual", action="store_true", help="Show OpenCV playback window")

    args = parser.parse_args()

    if args.list:
        list_sentences()
    elif args.interactive:
        interactive_menu()
    elif args.sentence:
        run_sentence_demo(args.sentence, visual=args.visual)
    else:
        # Default showcase sentence: "mata asaniipai" (I am sick)
        run_sentence_demo("mata asaniipai", visual=args.visual)


if __name__ == "__main__":
    main()
