#!/usr/bin/env python3
"""Convert SSL dataset videos into reference recordings for the web app.

Reads sign videos, extracts hand landmarks with MediaPipe, and writes one JSON
per sign into web/public/references/ in exactly the shape the app already
consumes, plus a regenerated manifest.json.

WHY THERE IS NO NORMALISATION HERE
----------------------------------
The app stores *raw* image-normalised landmarks (see web/src/vision/types.ts)
and normalises at comparison time in web/src/scoring/normalize.ts - wrist
centring, hand-size scaling and aspect correction all happen there, on both the
reference and the attempt. So a reference must be raw landmarks too. If this
script normalised, references and attempts would be normalised twice over and
the two paths could silently drift apart. Emit exactly what MediaPipe returns.

The one thing that MUST stay in step with the app is the detector configuration
below; it mirrors web/src/vision/handTracker.ts. Both use the same
hand_landmarker.task model file.

WHY EACH CLIP RUNS IN A SUBPROCESS
----------------------------------
The dataset contains at least one truncated clip (A-Z/N.mp4, 56 KB against
~3 MB for its neighbours). OpenCV blocks indefinitely inside VideoCapture on
such a file - not an exception we could catch, a hang. Each clip is therefore
decoded in a child process under a wall-clock timeout, so one bad file costs a
warning instead of the whole batch. It also gives every clip a fresh landmarker,
which sidesteps MediaPipe VIDEO mode's monotonic-timestamp requirement.

GLOSS NAMING
------------
The gloss is the dataset's own label, uppercased - never a translation. The
dataset labels Sinhala signs in transliteration (e.g. "kanawa"), and inventing
an English gloss for a sign none of us can verify is not acceptable. Add
human-verified translations later as a separate display field.

Usage
-----
    python convert_references.py --dataset "<dataset root>" --category "A-Z"
    python convert_references.py --dataset "<dataset root>" --all --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# --- must mirror web/src/vision/handTracker.ts ------------------------------
NUM_HANDS = 2
MIN_HAND_DETECTION_CONFIDENCE = 0.5
MIN_HAND_PRESENCE_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.5
# ---------------------------------------------------------------------------

# Landmark coordinates beyond this many decimals are noise, and dropping them
# roughly halves the JSON size that has to live in the repo.
COORD_DECIMALS = 5

# Files converted from the dataset are prefixed so they can never collide with
# recordings exported from the browser, which must not be overwritten.
OUTPUT_PREFIX = "kaggle_"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = REPO_ROOT / "web" / "public" / "models" / "hand_landmarker.task"
DEFAULT_OUT = REPO_ROOT / "web" / "public" / "references"

# Trailing notes in filenames, e.g. "B(first way)" or "hadanawa(ex- lii walin)".
PAREN_NOTE = re.compile(r"\s*\(([^)]*)\)\s*")


def parse_label(path: Path) -> tuple[str, str | None]:
    """Split a filename into (gloss, variant note). Never translates."""
    stem = path.stem.strip()
    notes = PAREN_NOTE.findall(stem)
    base = re.sub(r"\s+", " ", PAREN_NOTE.sub(" ", stem).strip())
    variant = "; ".join(n.strip() for n in notes if n.strip()) or None
    return base.upper(), variant


def safe_filename(gloss: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", gloss).strip("_")
    return f"{OUTPUT_PREFIX}{slug}.json"


# =========================== child process ==================================


def run_worker(video: Path, out_path: Path, model: Path, max_width: int, dataset_name: str) -> int:
    """Decode one clip and write its recording JSON. Runs in a child process."""
    import cv2  # imported here so the parent never pays for it
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    landmarker = mp_vision.HandLandmarker.create_from_options(
        mp_vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model)),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=NUM_HANDS,
            min_hand_detection_confidence=MIN_HAND_DETECTION_CONFIDENCE,
            min_hand_presence_confidence=MIN_HAND_PRESENCE_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
        )
    )

    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        print(json.dumps({"error": "could not open"}))
        return 1

    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0

    frames: list[dict] = []
    index = 0
    while True:
        ok, frame_bgr = capture.read()
        if not ok:
            break
        # Landmarks are image-normalised, so a proportional downscale leaves
        # them (and the aspect ratio) unchanged while cutting decode cost.
        if max_width and frame_bgr.shape[1] > max_width:
            scale = max_width / frame_bgr.shape[1]
            frame_bgr = cv2.resize(frame_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

        timestamp_ms = int(round(index * 1000.0 / fps))
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms
        )

        hands = []
        for i, landmarks in enumerate(result.hand_landmarks):
            category = result.handedness[i][0] if i < len(result.handedness) else None
            hands.append(
                {
                    # MediaPipe reports anatomical handedness; the app tolerates a
                    # mirrored performance at scoring time (scoreAttempt tries both).
                    "handedness": getattr(category, "category_name", "Right"),
                    "score": round(float(getattr(category, "score", 0.0)), 4),
                    "landmarks": [
                        {
                            "x": round(float(p.x), COORD_DECIMALS),
                            "y": round(float(p.y), COORD_DECIMALS),
                            "z": round(float(p.z), COORD_DECIMALS),
                        }
                        for p in landmarks
                    ],
                }
            )
        frames.append({"timestampMs": timestamp_ms, "hands": hands})
        index += 1
    capture.release()

    # Clips open and close on a rest pose with the hands down. Trim to the
    # tracked span so DTW aligns sign-to-sign rather than rest-to-rest.
    first = next((i for i, f in enumerate(frames) if f["hands"]), None)
    last = next((i for i in range(len(frames) - 1, -1, -1) if frames[i]["hands"]), None)
    trimmed = frames[first : last + 1] if first is not None and last is not None else []
    if not trimmed:
        print(json.dumps({"error": "no hands detected", "decoded": len(frames)}))
        return 1

    origin = trimmed[0]["timestampMs"]
    for f in trimmed:
        f["timestampMs"] -= origin
    duration_ms = max(trimmed[-1]["timestampMs"], 1)
    coverage = sum(1 for f in trimmed if f["hands"]) / len(trimmed)
    gloss, variant = parse_label(video)
    if not gloss:
        print(json.dumps({"error": "no usable label in filename"}))
        return 1

    recording = {
        "id": f"kaggle-{uuid.uuid5(uuid.NAMESPACE_URL, video.name)}",
        "gloss": gloss,
        "signer": "kaggle-dataset",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "durationMs": duration_ms,
        "fps": round(fps, 2),
        "videoWidth": width,
        "videoHeight": height,
        "frames": trimmed,
        # --- provenance (extra fields; the app ignores what it does not read) ---
        "source": "kaggle-dataset",
        "sourceDataset": dataset_name,
        "sourceFile": video.name,
        "sourceCategory": video.parent.name,
        "sourceLabel": video.stem,
        "variant": variant,
        "note": "Gloss is the dataset's own label uppercased, not a translation.",
    }
    out_path.write_text(json.dumps(recording, separators=(",", ":")), encoding="utf-8")

    print(
        json.dumps(
            {
                "gloss": gloss,
                "variant": variant,
                "frames": len(trimmed),
                "durationMs": duration_ms,
                "coverage": round(coverage, 4),
                "sourceFile": video.name,
            }
        )
    )
    return 0


# ============================== parent ======================================


def convert_one(
    video: Path, tmp_dir: Path, args: argparse.Namespace
) -> dict | None:
    """Run one clip in a child process under a timeout. None on failure."""
    target = tmp_dir / (re.sub(r"[^A-Za-z0-9]+", "_", video.stem).strip("_") + ".json")
    cmd = [
        sys.executable, str(Path(__file__).resolve()),
        "--worker",
        "--video", str(video),
        "--worker-out", str(target),
        "--model", str(args.model),
        "--max-width", str(args.max_width),
        "--dataset-name", args.dataset_name,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=args.timeout
        )
    except subprocess.TimeoutExpired:
        print(f"  SKIP {video.name}: timed out after {args.timeout}s (unreadable or corrupt)")
        return None

    summary = None
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                summary = json.loads(line)
            except json.JSONDecodeError:
                pass
    if proc.returncode != 0 or summary is None or "error" in (summary or {}):
        reason = (summary or {}).get("error", f"exit {proc.returncode}")
        print(f"  SKIP {video.name}: {reason}")
        return None

    summary["path"] = target
    return summary


def write_manifest(out_dir: Path) -> list[str]:
    """List every reference JSON present, so browser exports are preserved."""
    files = sorted(p.name for p in out_dir.glob("*.json") if p.name != "manifest.json")
    (out_dir / "manifest.json").write_text(
        json.dumps({"files": files}, indent=2) + "\n", encoding="utf-8"
    )
    return files


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--dataset", type=Path, help="Dataset root folder")
    p.add_argument("--category", action="append", default=[], help="Subfolder to convert (repeatable)")
    p.add_argument("--all", action="store_true", help="Convert every subfolder")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    p.add_argument("--dataset-name", default="dckahawearachchi/sinhala-sign-language-dataset")
    # 0.7, not 0.5: lead/tail rest frames are already trimmed, so a low figure
    # here means dropouts *mid-sign*. Such a reference teaches the wrong motion
    # and drags down the feedback accuracy the proposal is measured on.
    p.add_argument("--min-coverage", type=float, default=0.7,
                   help="Skip clips where hands are tracked in less than this share of frames")
    p.add_argument("--manifest-only", action="store_true",
                   help="Just regenerate manifest.json from the files present, then exit")
    p.add_argument("--max-width", type=int, default=640,
                   help="Downscale frames to this width before inference (0 = keep original)")
    p.add_argument("--timeout", type=float, default=180.0, help="Per-clip wall-clock limit, seconds")
    p.add_argument("--limit", type=int, default=0, help="Convert at most N clips (0 = no limit)")
    p.add_argument("--dry-run", action="store_true", help="Report only; write nothing to --out")
    # internal
    p.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--video", type=Path, help=argparse.SUPPRESS)
    p.add_argument("--worker-out", type=Path, help=argparse.SUPPRESS)
    return p


def main() -> int:
    args = build_parser().parse_args()

    if args.worker:
        return run_worker(args.video, args.worker_out, args.model, args.max_width, args.dataset_name)

    if args.manifest_only:
        files = write_manifest(args.out)
        print(f"Manifest regenerated: {len(files)} file(s) in {args.out}")
        return 0

    if not args.dataset or not args.dataset.is_dir():
        sys.exit(f"Dataset folder not found: {args.dataset}")
    if not args.model.is_file():
        sys.exit(f"Model not found: {args.model}")

    if args.all:
        categories = sorted(p for p in args.dataset.iterdir() if p.is_dir())
    elif args.category:
        categories = [args.dataset / c for c in args.category]
    else:
        sys.exit("Pass --category NAME (repeatable) or --all")

    videos: list[Path] = []
    unlabelled: list[Path] = []
    for category in categories:
        if not category.is_dir():
            print(f"! no such category: {category.name}", file=sys.stderr)
            continue
        for path in sorted(category.glob("*.mp4")):
            # The corpus holds a few clips with no usable label: hidden files
            # literally named ".mp4", and names that are only a parenthetical
            # note ("(1st way).mp4", "(ex- kunu).mp4"). A sign we cannot name is
            # a sign we cannot practise, and guessing a gloss is not allowed.
            if path.name.startswith(".") or not parse_label(path)[0]:
                unlabelled.append(path)
                continue
            videos.append(path)

    if unlabelled:
        print(f"Ignoring {len(unlabelled)} clip(s) with no usable label:")
        for path in unlabelled:
            print(f"  - {path.parent.name}/{path.name}")
        print()

    if args.limit:
        videos = videos[: args.limit]
    if not videos:
        sys.exit("No videos found.")

    print(f"Converting {len(videos)} clip(s) from {len(categories)} category(ies)...\n")
    started = time.time()

    best: dict[str, dict] = {}
    alternates: list[dict] = []
    skipped: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for n, video in enumerate(videos, 1):
            summary = convert_one(video, tmp_dir, args)
            if summary is None:
                skipped.append(video.name)
                continue
            if summary["coverage"] < args.min_coverage:
                print(f"  SKIP {video.name}: hands in only {summary['coverage']:.0%} of frames")
                skipped.append(video.name)
                continue

            print(
                f"  ok   [{n}/{len(videos)}] {summary['gloss']:<24} "
                f"{summary['frames']:>4} frames  {summary['durationMs']/1000:>5.1f}s  "
                f"hands {summary['coverage']:.0%}"
                + (f"  [{summary['variant']}]" if summary.get("variant") else "")
            )

            gloss = summary["gloss"]
            incumbent = best.get(gloss)
            if incumbent is None:
                best[gloss] = summary
            elif summary["coverage"] > incumbent["coverage"]:
                alternates.append(incumbent)
                best[gloss] = summary
            else:
                alternates.append(summary)

        elapsed = time.time() - started
        print(
            f"\n{len(best)} gloss(es) ready, {len(alternates)} alternate take(s), "
            f"{len(skipped)} skipped, in {elapsed/60:.1f} min."
        )
        if alternates:
            print("Alternate takes, kept for later multi-reference work:")
            for alt in alternates:
                print(f"  - {alt['gloss']}: {alt['sourceFile']} (hands {alt['coverage']:.0%})")
        if skipped:
            print("Skipped clips:")
            for name in skipped:
                print(f"  - {name}")

        if args.dry_run:
            print("\nDry run - nothing written to the reference folder.")
            return 0

        args.out.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        for gloss, summary in sorted(best.items()):
            destination = args.out / safe_filename(gloss)
            shutil.copyfile(summary["path"], destination)
            total_bytes += destination.stat().st_size

    files = write_manifest(args.out)
    print(
        f"\nWrote {len(best)} reference(s) to {args.out} "
        f"({total_bytes/1_048_576:.1f} MB). Manifest lists {len(files)} file(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
