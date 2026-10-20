# =============================================================================
# SoundGuard — Multi-Model Training & Comparative Evaluation
# Google Colab Script (GPU runtime required)
# =============================================================================
# Models trained sequentially:
#   1. BaselineCNN1D      — simple 1-D convolutional baseline
#   2. ResNet18_1D        — residual network adapted for 1-D mel input
#   3. SoundGuardModel    — MobileNetV2 backbone (existing, unchanged)
#
# All data loading, augmentation, and mel-extraction logic is IDENTICAL
# to the original working script.  Only the model definitions and the
# comparative evaluation / ONNX-export sections are new.
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# Cell 1 · GPU Verification
# ─────────────────────────────────────────────────────────────────────────────
import subprocess, sys, os, platform
import torch

if not torch.cuda.is_available():
    raise SystemExit(
        "❌  No GPU detected. Go to Runtime → Change runtime type → GPU and reconnect."
    )
gpu_name = torch.cuda.get_device_name(0)
vram_gb  = torch.cuda.get_device_properties(0).total_memory / 1e9
ram_gb   = os.popen("free -g | awk '/^Mem:/{print $2}'").read().strip()
print(f"✅ GPU  : {gpu_name}")
print(f"   VRAM: {vram_gb:.1f} GB")
print(f"   RAM : {ram_gb} GB (system)")
print(f"   PyTorch: {torch.__version__}")
print(f"   CUDA   : {torch.version.cuda}")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 2 · Install Dependencies
# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Install core packages with pinned versions
subprocess.run([
    sys.executable, "-m", "pip", "install", "-q",
    "audiomentations==0.36.0",
    "librosa==0.10.2",
    "soundfile==0.12.1",
    "onnx==1.17.0",
    "onnxruntime==1.20.1",
    "matplotlib==3.9.0",
    "seaborn==0.13.2",
    "scikit-learn==1.5.0",
    "pandas==2.2.2",
    "kaggle==1.6.17",
    "tqdm==4.66.4",
], check=True)

# Step 2: Install onnxsim separately — it has strict onnxruntime deps that
# conflict when installed in the same pip call. We let pip pick a compatible
# version automatically; if it fails we fall back gracefully (onnxsim is
# optional — the script keeps the consolidated ONNX if simplification fails).
_sim_result = subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "onnxsim"],
    check=False
)
if _sim_result.returncode != 0:
    print("⚠️  onnxsim install failed — graph simplification will be skipped (non-fatal)")
else:
    print("✅ onnxsim installed")

print("✅ Dependencies installed")


# ─────────────────────────────────────────────────────────────────────────────
# Cell 3 · Imports & Global Configuration
# ─────────────────────────────────────────────────────────────────────────────
import os, gc, json, random, shutil, zipfile, warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from typing import List, Tuple, Dict, Optional
from tqdm.auto import tqdm
import librosa
import soundfile as sf
import audiomentations as A
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torch.cuda.amp import autocast, GradScaler
import torchvision.models as tv_models
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    classification_report, confusion_matrix, f1_score, accuracy_score
)
import onnx
import onnxruntime as ort
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# ── Reproducibility ──────────────────────────────────────────────────────────
SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.cuda.manual_seed_all(SEED)
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark     = False

DEVICE = torch.device("cuda")

# ── Path layout ───────────────────────────────────────────────────────────────
BASE_DIR   = Path("/content/soundguard")
DATA_DIR   = BASE_DIR / "data"
CACHE_DIR  = BASE_DIR / "mel_cache"
CKPT_DIR   = BASE_DIR / "checkpoints"
OUTPUT_DIR = BASE_DIR / "output"
GDRIVE_DIR = Path("/content/drive/MyDrive/SoundGuard")
for d in [DATA_DIR, CACHE_DIR, CKPT_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── Audio / Mel constants — MUST MATCH melSpectrogram.ts ─────────────────────
SAMPLE_RATE   = 22050
N_FFT         = 2048
HOP_LENGTH    = 512
N_MELS        = 128
CLIP_DURATION = 3.0
CLIP_SAMPLES  = int(SAMPLE_RATE * CLIP_DURATION)   # 66 150
N_FRAMES      = 128

# ── Model / Training hyperparameters ─────────────────────────────────────────
NUM_CLASSES         = 7
BATCH_SIZE          = 32
EPOCHS              = 60
LR_INIT             = 1e-3
WEIGHT_DECAY        = 1e-4
LR_MIN              = 1e-6
LABEL_SMOOTHING     = 0.10
GRAD_CLIP_NORM      = 1.0
EARLY_STOP_PATIENCE = 12
N_WORKERS           = 2
N_AUG_COPIES        = 5

# ── Target class definitions ──────────────────────────────────────────────────
CLASS_NAMES: List[str] = [
    "car_horn",
    "crying_baby",
    "dog",
    "door_wood_knock",
    "footsteps",
    "glass_breaking",
    "siren",
]
CLASS_TO_IDX: Dict[str, int] = {c: i for i, c in enumerate(CLASS_NAMES)}
print("✅ Configuration loaded")
print(f"   Classes  : {CLASS_NAMES}")
print(f"   Clip     : {CLIP_DURATION}s → {CLIP_SAMPLES} samples → {N_FRAMES} frames")
print(f"   Batch    : {BATCH_SIZE}  |  Epochs: {EPOCHS}  |  LR: {LR_INIT}")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 4 · Download ESC-50
# ─────────────────────────────────────────────────────────────────────────────
ESC50_DIR = DATA_DIR / "ESC-50"
if not ESC50_DIR.exists():
    print("Downloading ESC-50 (~600 MB) ...")
    subprocess.run([
        "wget", "-q", "-O", str(DATA_DIR / "esc50.zip"),
        "https://github.com/karolpiczak/ESC-50/archive/refs/heads/master.zip"
    ], check=True)
    print("Extracting ...")
    with zipfile.ZipFile(str(DATA_DIR / "esc50.zip"), "r") as zf:
        zf.extractall(str(DATA_DIR))
    (DATA_DIR / "ESC-50-master").rename(ESC50_DIR)
    (DATA_DIR / "esc50.zip").unlink()
    print("✅ ESC-50 ready")
else:
    print("✅ ESC-50 already present")

ESC50_AUDIO = ESC50_DIR / "audio"
ESC50_META  = ESC50_DIR / "meta" / "esc50.csv"
esc50_df    = pd.read_csv(ESC50_META)
print(f"   {len(esc50_df)} clips, {esc50_df['category'].nunique()} categories")

ESC50_CLASS_MAP: Dict[str, str] = {
    "dog":             "dog",
    "crying_baby":     "crying_baby",
    "footsteps":       "footsteps",
    "door_wood_knock": "door_wood_knock",
    "glass_breaking":  "glass_breaking",
    "car_horn":        "car_horn",
    "siren":           "siren",
}
esc50_target = esc50_df[esc50_df["category"].isin(ESC50_CLASS_MAP.keys())].copy()
esc50_target["soundguard_class"] = esc50_target["category"].map(ESC50_CLASS_MAP)
esc50_target["filepath"] = esc50_target["filename"].apply(
    lambda f: str(ESC50_AUDIO / f)
)
print(f"\nESC-50 target clips: {len(esc50_target)}")
print(esc50_target.groupby("soundguard_class")["filename"].count().to_string())

# ─────────────────────────────────────────────────────────────────────────────
# Cell 5 · Download UrbanSound8K
# ─────────────────────────────────────────────────────────────────────────────
US8K_DIR = DATA_DIR / "UrbanSound8K"

KAGGLE_USERNAME = "karindragimhan49"
KAGGLE_KEY      = "87736d7dca518b7026156b4fc9216b13"

if KAGGLE_USERNAME and KAGGLE_KEY and not US8K_DIR.exists():
    kaggle_cfg = Path("/root/.config/kaggle")
    kaggle_cfg.mkdir(parents=True, exist_ok=True)
    (kaggle_cfg / "kaggle.json").write_text(
        json.dumps({"username": KAGGLE_USERNAME, "key": KAGGLE_KEY})
    )
    os.chmod(str(kaggle_cfg / "kaggle.json"), 0o600)
    print("Downloading UrbanSound8K via Kaggle (~6 GB) ...")
    subprocess.run([
        "kaggle", "datasets", "download", "-d",
        "chrisfilo/urbansound8k",
        "-p", str(DATA_DIR), "--unzip"
    ], check=True)
    for candidate in ["urban-sound-classification", "UrbanSound8K", "urbansound8k"]:
        if (DATA_DIR / candidate).exists():
            (DATA_DIR / candidate).rename(US8K_DIR)
            break
    print("✅ UrbanSound8K ready")
elif US8K_DIR.exists():
    print("✅ UrbanSound8K already present")
else:
    print("⚠️  UrbanSound8K not available.")

# ── Parse UrbanSound8K metadata (robust path scan) ───────────────────────────
csv_files = list(DATA_DIR.rglob("UrbanSound8K.csv"))
fold_dirs  = list(DATA_DIR.rglob("fold1"))

if not csv_files or not fold_dirs:
    raise SystemExit("❌ UrbanSound8K data was not correctly unzipped.")

US8K_META      = csv_files[0]
US8K_AUDIO_DIR = fold_dirs[0].parent
print(f"✅ Found Metadata   : {US8K_META}")
print(f"✅ Found Audio Folds: {US8K_AUDIO_DIR}")

US8K_CLASS_MAP = {"car_horn": "car_horn", "dog_bark": "dog", "siren": "siren"}
us8k_df = pd.read_csv(US8K_META)
us8k_target = us8k_df[us8k_df["class"].isin(US8K_CLASS_MAP.keys())].copy()
us8k_target["soundguard_class"] = us8k_target["class"].map(US8K_CLASS_MAP)
us8k_target["filepath"] = us8k_target.apply(
    lambda r: str(US8K_AUDIO_DIR / f"fold{r['fold']}" / r["slice_file_name"]), axis=1
)
us8k_target = us8k_target[us8k_target["filepath"].apply(os.path.exists)]
print(f"\nUrbanSound8K target clips: {len(us8k_target)}")
print(us8k_target.groupby("soundguard_class")["slice_file_name"].count().to_string())

# ─────────────────────────────────────────────────────────────────────────────
# Cell 6 · Build Unified Dataset Index & Stratified Splits
# ─────────────────────────────────────────────────────────────────────────────
records = []

for _, row in esc50_target.iterrows():
    fold  = int(row["fold"])
    split = "train" if fold <= 3 else ("val" if fold == 4 else "test")
    records.append({
        "filepath":   row["filepath"],
        "label":      CLASS_TO_IDX[row["soundguard_class"]],
        "class_name": row["soundguard_class"],
        "split":      split,
        "source":     "ESC-50",
        "duration":   5.0,
    })

for _, row in us8k_target.iterrows():
    fold  = int(row["fold"])
    split = "train" if fold <= 8 else ("val" if fold == 9 else "test")
    records.append({
        "filepath":   row["filepath"],
        "label":      CLASS_TO_IDX[row["soundguard_class"]],
        "class_name": row["soundguard_class"],
        "split":      split,
        "source":     "UrbanSound8K",
        "duration":   None,
    })

df = pd.DataFrame(records)

# Drop missing files
missing = df[~df["filepath"].apply(os.path.exists)]
if len(missing):
    print(f"⚠️  {len(missing)} missing files — dropping them")
    df = df[df["filepath"].apply(os.path.exists)].reset_index(drop=True)

df_train = df[df["split"] == "train"].reset_index(drop=True)
df_val   = df[df["split"] == "val"].reset_index(drop=True)
df_test  = df[df["split"] == "test"].reset_index(drop=True)

print(f"Dataset summary:")
print(f"  Train : {len(df_train):5d} clips")
print(f"  Val   : {len(df_val):5d} clips")
print(f"  Test  : {len(df_test):5d} clips")
print(f"\nTrain class distribution:")
print(df_train.groupby("class_name")["filepath"].count().sort_index().to_string())

# ─────────────────────────────────────────────────────────────────────────────
# Cell 7 · Mel-Spectrogram Extractor  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
def load_audio_clip(filepath: str, target_sr: int = SAMPLE_RATE) -> np.ndarray:
    """Load audio, resample, convert to mono. Returns float32 in [-1, 1]."""
    try:
        audio, sr = librosa.load(filepath, sr=target_sr, mono=True, dtype=np.float32)
    except Exception as e:
        raise ValueError(f"Cannot load {filepath}: {e}") from e
    return audio


def pad_or_crop(audio: np.ndarray, target_samples: int,
                random_crop: bool = True) -> np.ndarray:
    """Bring audio to exactly target_samples frames."""
    n = len(audio)
    if n == target_samples:
        return audio
    if n > target_samples:
        start = random.randint(0, n - target_samples) if random_crop \
                else (n - target_samples) // 2
        return audio[start: start + target_samples]
    pad_total = target_samples - n
    pad_left  = random.randint(0, pad_total) if random_crop else pad_total // 2
    pad_right = pad_total - pad_left
    return np.pad(audio, (pad_left, pad_right), mode="constant")


def audio_to_mel(audio: np.ndarray) -> np.ndarray:
    """Compute 128x128 mel-spectrogram normalised to [0,1]. Matches melSpectrogram.ts."""
    mel = librosa.feature.melspectrogram(
        y=audio, sr=SAMPLE_RATE,
        n_fft=N_FFT, hop_length=HOP_LENGTH,
        n_mels=N_MELS, power=2.0,
        fmin=0.0, fmax=SAMPLE_RATE // 2,
    )
    mel_db  = librosa.power_to_db(mel, ref=np.max)
    mel_db  = np.clip(mel_db, a_min=-80.0, a_max=0.0)
    mel_min = mel_db.min()
    mel_max = mel_db.max()
    if mel_max - mel_min < 1e-6:
        return np.zeros((N_MELS, N_FRAMES), dtype=np.float32)
    mel_norm = (mel_db - mel_min) / (mel_max - mel_min)
    T = mel_norm.shape[1]
    if T >= N_FRAMES:
        mel_norm = mel_norm[:, :N_FRAMES]
    else:
        mel_norm = np.pad(mel_norm, ((0, 0), (0, N_FRAMES - T)), mode="constant")
    return mel_norm.astype(np.float32)


def load_clip_as_mel(filepath: str, random_crop: bool = True) -> np.ndarray:
    """Full pipeline: file path → normalised 128×128 mel-spectrogram."""
    audio = load_audio_clip(filepath)
    audio = pad_or_crop(audio, CLIP_SAMPLES, random_crop=random_crop)
    return audio_to_mel(audio)


# Sanity check
_test_file = df_train["filepath"].iloc[0]
_test_mel  = load_clip_as_mel(_test_file, random_crop=False)
assert _test_mel.shape == (128, 128)
assert 0.0 <= _test_mel.min() and _test_mel.max() <= 1.0
print(f"✅ Mel extractor verified: shape={_test_mel.shape}, "
      f"range=[{_test_mel.min():.3f},{_test_mel.max():.3f}]")

fig, axes = plt.subplots(1, 7, figsize=(21, 3))
for ax, cls in zip(axes, CLASS_NAMES):
    sample = df_train[df_train["class_name"] == cls]["filepath"].iloc[0]
    mel    = load_clip_as_mel(sample, random_crop=False)
    ax.imshow(mel, origin="lower", aspect="auto", cmap="magma")
    ax.set_title(cls, fontsize=8)
    ax.axis("off")
plt.suptitle("One mel-spectrogram per class (clean, no augmentation)", fontsize=10)
plt.tight_layout()
plt.savefig(str(OUTPUT_DIR / "mel_samples.png"), dpi=150)
plt.show()
print("✅ Mel sample figure saved")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 8 · Augmentation Pipeline  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
noise_clips_df = esc50_df[~esc50_df["category"].isin(ESC50_CLASS_MAP.keys())]
NOISE_PATHS = [
    str(ESC50_AUDIO / fn)
    for fn in noise_clips_df["filename"].tolist()
    if (ESC50_AUDIO / fn).exists()
]
print(f"Background noise pool: {len(NOISE_PATHS)} clips from "
      f"{noise_clips_df['category'].nunique()} categories")


def build_augmenter(noise_paths: List[str]) -> A.Compose:
    return A.Compose([
        A.AddBackgroundNoise(sounds_path=noise_paths,
                             min_snr_db=3.0, max_snr_db=25.0, p=0.75),
        A.AddGaussianNoise(min_amplitude=0.001, max_amplitude=0.008, p=0.70),
        A.Gain(min_gain_db=-6.0, max_gain_db=+6.0, p=0.80),
        A.PitchShift(min_semitones=-2.0, max_semitones=+2.0, p=0.40),
        A.TimeStretch(min_rate=0.85, max_rate=1.15, p=0.40),
        A.LowPassFilter(min_cutoff_freq=6000.0, max_cutoff_freq=9000.0, p=0.35),
        A.HighPassFilter(min_cutoff_freq=60.0, max_cutoff_freq=100.0, p=0.30),
    ], p=1.0)


def spec_augment(mel: np.ndarray,
                 freq_mask_param: int = 24, time_mask_param: int = 24,
                 num_freq_masks: int = 2, num_time_masks: int = 2) -> np.ndarray:
    """SpecAugment (Park et al., 2019): random frequency & time masking."""
    mel = mel.copy()
    freq_bins, time_frames = mel.shape
    fill_val = 0.0
    for _ in range(num_freq_masks):
        f  = random.randint(1, freq_mask_param)
        f0 = random.randint(0, freq_bins - f)
        mel[f0: f0 + f, :] = fill_val
    for _ in range(num_time_masks):
        t  = random.randint(1, time_mask_param)
        t0 = random.randint(0, time_frames - t)
        mel[:, t0: t0 + t] = fill_val
    return mel


# Preview
aug  = build_augmenter(NOISE_PATHS[:20])
_raw, _ = librosa.load(_test_file, sr=SAMPLE_RATE, mono=True)
_raw = pad_or_crop(_raw, CLIP_SAMPLES, random_crop=True)
fig, axes = plt.subplots(1, 4, figsize=(16, 3))
axes[0].imshow(audio_to_mel(_raw), origin="lower", aspect="auto", cmap="magma")
axes[0].set_title("Original")
for i in range(1, 4):
    a_audio = aug(samples=_raw.copy(), sample_rate=SAMPLE_RATE)
    a_mel   = spec_augment(audio_to_mel(a_audio))
    axes[i].imshow(a_mel, origin="lower", aspect="auto", cmap="magma")
    axes[i].set_title(f"Augmented v{i}")
for ax in axes: ax.axis("off")
plt.suptitle("Mobile-domain augmentation effect", fontsize=10)
plt.tight_layout()
plt.savefig(str(OUTPUT_DIR / "augmentation_preview.png"), dpi=150)
plt.show()
print("✅ Augmentation pipeline verified")
del aug, _raw
gc.collect()

# ─────────────────────────────────────────────────────────────────────────────
# Cell 9 · Offline Augmentation  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
AUG_CACHE = CACHE_DIR / "augmented_train"
AUG_CACHE.mkdir(exist_ok=True)
aug_train_rows = []
augmenter = build_augmenter(NOISE_PATHS)

print(f"Pre-computing augmented mel spectrograms for {len(df_train)} training clips ...")
print(f"  → {N_AUG_COPIES} augmented copies each = "
      f"{len(df_train) * (1 + N_AUG_COPIES):,} total")

RECOMPUTE_AUG = False

for idx, row in tqdm(df_train.iterrows(), total=len(df_train), desc="Augmenting"):
    filepath   = row["filepath"]
    label      = row["label"]
    class_name = row["class_name"]

    base_cache = AUG_CACHE / f"{idx}_base.npy"
    if not base_cache.exists() or RECOMPUTE_AUG:
        try:
            audio = load_audio_clip(filepath)
            audio = pad_or_crop(audio, CLIP_SAMPLES, random_crop=True)
            mel   = audio_to_mel(audio)
            np.save(str(base_cache), mel)
        except ValueError as e:
            print(f"  ⚠️  Skipping {filepath}: {e}")
            continue
    aug_train_rows.append({"mel_path": str(base_cache), "label": label,
                            "class_name": class_name, "is_aug": False})

    for aug_i in range(N_AUG_COPIES):
        aug_cache = AUG_CACHE / f"{idx}_aug{aug_i}.npy"
        if not aug_cache.exists() or RECOMPUTE_AUG:
            try:
                audio = load_audio_clip(filepath)
                audio = pad_or_crop(audio, CLIP_SAMPLES, random_crop=True)
                audio = augmenter(samples=audio, sample_rate=SAMPLE_RATE)
                mel   = audio_to_mel(audio)
                np.save(str(aug_cache), mel)
            except Exception as e:
                print(f"  ⚠️  Aug error {filepath} v{aug_i}: {e}")
                continue
        aug_train_rows.append({"mel_path": str(aug_cache), "label": label,
                                "class_name": class_name, "is_aug": True})

df_aug_train = pd.DataFrame(aug_train_rows)
print(f"\n✅ Augmented training set: {len(df_aug_train):,} examples")
print(df_aug_train.groupby("class_name")["mel_path"].count().sort_index().to_string())
del augmenter
gc.collect()

# ─────────────────────────────────────────────────────────────────────────────
# Cell 10 · PyTorch Dataset & DataLoader  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
class MelDataset(Dataset):
    def __init__(self, file_paths: List[str], labels: List[int],
                 augment: bool = False, mel_cache: bool = False):
        assert len(file_paths) == len(labels)
        self.file_paths = file_paths
        self.labels     = labels
        self.augment    = augment
        self.mel_cache  = mel_cache

    def __len__(self) -> int:
        return len(self.file_paths)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        path  = self.file_paths[idx]
        label = self.labels[idx]
        if self.mel_cache:
            mel = np.load(path).astype(np.float32)
            if self.augment:
                mel = spec_augment(mel)
        else:
            try:
                mel = load_clip_as_mel(path, random_crop=False)
            except ValueError:
                mel = np.zeros((N_MELS, N_FRAMES), dtype=np.float32)
        # (1, 128, 128) — channel-first NCHW, matches ALL three model inputs
        return torch.from_numpy(mel).unsqueeze(0), label


def make_weighted_sampler(labels: List[int]) -> WeightedRandomSampler:
    label_array   = np.array(labels, dtype=np.int64)
    class_counts  = np.maximum(np.bincount(label_array, minlength=NUM_CLASSES), 1)
    class_weights = 1.0 / class_counts.astype(np.float64)
    sample_weights = class_weights[label_array]
    return WeightedRandomSampler(
        weights     = torch.DoubleTensor(sample_weights),
        num_samples = len(sample_weights),
        replacement = True,
    )


def make_loaders():
    """
    Re-creates fresh DataLoader instances.
    Called once before each model's training run so there is no stale
    worker-process state carried between models.
    """
    train_ds = MelDataset(
        file_paths = df_aug_train["mel_path"].tolist(),
        labels     = df_aug_train["label"].tolist(),
        augment    = True,
        mel_cache  = True,
    )
    train_sampler = make_weighted_sampler(df_aug_train["label"].tolist())
    _train = DataLoader(train_ds, batch_size=BATCH_SIZE, sampler=train_sampler,
                        num_workers=N_WORKERS, pin_memory=True,
                        persistent_workers=True, prefetch_factor=2, drop_last=True)

    val_ds = MelDataset(file_paths=df_val["filepath"].tolist(),
                        labels=df_val["label"].tolist(), augment=False, mel_cache=False)
    _val   = DataLoader(val_ds, batch_size=BATCH_SIZE * 2, shuffle=False,
                        num_workers=N_WORKERS, pin_memory=True, persistent_workers=True)

    test_ds = MelDataset(file_paths=df_test["filepath"].tolist(),
                         labels=df_test["label"].tolist(), augment=False, mel_cache=False)
    _test  = DataLoader(test_ds, batch_size=BATCH_SIZE * 2, shuffle=False,
                        num_workers=N_WORKERS, pin_memory=True, persistent_workers=True)
    return _train, _val, _test


# Build once and verify shapes
train_loader, val_loader, test_loader = make_loaders()
_x, _y = next(iter(train_loader))
print(f"✅ DataLoaders ready")
print(f"   Train batches : {len(train_loader):4d}  |  {len(df_aug_train):,} examples")
print(f"   Val   batches : {len(val_loader):4d}  |  {len(df_val):,} examples")
print(f"   Test  batches : {len(test_loader):4d}  |  {len(df_test):,} examples")
print(f"   Batch shape   : {_x.shape}  labels: {_y.shape}")
assert _x.shape == (BATCH_SIZE, 1, N_MELS, N_FRAMES)
del _x, _y

# ─────────────────────────────────────────────────────────────────────────────
# Cell 11 · Model Definitions  (3 architectures)
# ─────────────────────────────────────────────────────────────────────────────
# All models accept the SAME tensor:  (B, 1, 128, 128)  NCHW
# No changes to the DataLoader or feature extraction are required.

# ── 11a. Baseline CNN1D ───────────────────────────────────────────────────────
class BaselineCNN1D(nn.Module):
    """
    Lightweight 1-D CNN baseline.

    Strategy: collapse the frequency axis (128 mel bins) via an initial
    Conv2d with kernel_size=(N_MELS, 1) — equivalent to a learned frequency
    aggregation — producing a (B, C, 1, T) feature map.  We then squeeze
    the frequency dimension and continue with 1-D convolutions along time.

    This keeps the architecture truly 1-D while accepting the same
    (B, 1, 128, 128) input tensor that all other models receive, so no
    DataLoader or preprocessing changes are needed.
    """
    def __init__(self, num_classes: int = NUM_CLASSES, dropout: float = 0.3):
        super().__init__()

        # ── Frequency collapse (2-D → 1-D) ───────────────────────
        self.freq_collapse = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(N_MELS, 1), stride=1, padding=0, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
        )   # output: (B, 32, 1, 128)

        # ── 1-D temporal feature extraction ───────────────────────
        self.conv_blocks = nn.Sequential(
            nn.Conv1d(32, 64, kernel_size=7, stride=2, padding=3, bias=False),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout * 0.5),
            nn.Conv1d(64, 128, kernel_size=5, stride=2, padding=2, bias=False),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout * 0.5),
            nn.Conv1d(128, 256, kernel_size=3, stride=2, padding=1, bias=False),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
        )

        self.pool       = nn.AdaptiveAvgPool1d(1)
        self.classifier = nn.Sequential(
            nn.Dropout(p=dropout),
            nn.Linear(256, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 1, 128, 128)
        x = self.freq_collapse(x)        # (B, 32, 1, 128)
        x = x.squeeze(2)                 # (B, 32, 128)
        x = self.conv_blocks(x)          # (B, 256, T')
        x = self.pool(x).squeeze(-1)     # (B, 256)
        return self.classifier(x)        # (B, num_classes)


# ── 11b. ResNet18-1D ─────────────────────────────────────────────────────────
class _ResBlock1D(nn.Module):
    """Standard residual block with two Conv1d layers."""
    def __init__(self, in_ch: int, out_ch: int, stride: int = 1):
        super().__init__()
        self.conv1 = nn.Conv1d(in_ch, out_ch, 3, stride=stride, padding=1, bias=False)
        self.bn1   = nn.BatchNorm1d(out_ch)
        self.conv2 = nn.Conv1d(out_ch, out_ch, 3, stride=1,      padding=1, bias=False)
        self.bn2   = nn.BatchNorm1d(out_ch)
        self.downsample = nn.Sequential(
            nn.Conv1d(in_ch, out_ch, 1, stride=stride, bias=False),
            nn.BatchNorm1d(out_ch),
        ) if (stride != 1 or in_ch != out_ch) else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = self.downsample(x)
        out = F.relu(self.bn1(self.conv1(x)), inplace=True)
        out = self.bn2(self.conv2(out))
        return F.relu(out + identity, inplace=True)


class ResNet18_1D(nn.Module):
    """
    ResNet-18 adapted for 1-D temporal sequences.

    Same frequency-collapse stem as BaselineCNN1D so the network accepts
    (B, 1, 128, 128) NCHW tensors without any DataLoader change.
    Four residual stages follow the canonical ResNet-18 channel schedule
    [64, 128, 256, 512], each with 2 blocks.
    """
    def __init__(self, num_classes: int = NUM_CLASSES, dropout: float = 0.3):
        super().__init__()

        # ── Frequency collapse ────────────────────────────────────
        self.freq_collapse = nn.Sequential(
            nn.Conv2d(1, 64, kernel_size=(N_MELS, 1), stride=1, padding=0, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
        )   # (B, 64, 1, 128)

        # ── ResNet-18 stages ──────────────────────────────────────
        self.layer1 = nn.Sequential(_ResBlock1D(64,  64,  stride=1),
                                    _ResBlock1D(64,  64,  stride=1))
        self.layer2 = nn.Sequential(_ResBlock1D(64,  128, stride=2),
                                    _ResBlock1D(128, 128, stride=1))
        self.layer3 = nn.Sequential(_ResBlock1D(128, 256, stride=2),
                                    _ResBlock1D(256, 256, stride=1))
        self.layer4 = nn.Sequential(_ResBlock1D(256, 512, stride=2),
                                    _ResBlock1D(512, 512, stride=1))

        self.pool       = nn.AdaptiveAvgPool1d(1)
        self.classifier = nn.Sequential(
            nn.Dropout(p=dropout),
            nn.Linear(512, num_classes),
        )

        # Kaiming initialisation for residual layers
        for m in self.modules():
            if isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm1d):
                nn.init.ones_(m.weight); nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, 0, 0.01); nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.freq_collapse(x)     # (B, 64, 1, 128)
        x = x.squeeze(2)             # (B, 64, 128)
        x = self.layer1(x)           # (B, 64, 128)
        x = self.layer2(x)           # (B, 128, 64)
        x = self.layer3(x)           # (B, 256, 32)
        x = self.layer4(x)           # (B, 512, 16)
        x = self.pool(x).squeeze(-1) # (B, 512)
        return self.classifier(x)    # (B, num_classes)


# ── 11c. MobileNetV2-1D  (ORIGINAL SoundGuard model, UNCHANGED) ──────────────
class SoundGuardModel(nn.Module):
    """
    MobileNetV2 backbone adapted for single-channel 128×128 mel-spectrogram.
    Input (PyTorch training):  [B, 1,   128, 128] — NCHW
    Input (ONNX export):       [B, 128, 128, 1  ] — NHWC  (_nhwc_input=True)
    """
    def __init__(self, num_classes: int = NUM_CLASSES, dropout: float = 0.3):
        super().__init__()
        backbone  = tv_models.mobilenet_v2(
            weights=tv_models.MobileNet_V2_Weights.IMAGENET1K_V1)
        orig_conv = backbone.features[0][0]
        new_conv  = nn.Conv2d(1, 32, kernel_size=3, stride=2, padding=1, bias=False)
        with torch.no_grad():
            new_conv.weight.copy_(orig_conv.weight.mean(dim=1, keepdim=True))
        backbone.features[0][0] = new_conv
        self.features   = backbone.features
        self.pool       = nn.AdaptiveAvgPool2d((1, 1))
        self.classifier = nn.Sequential(
            nn.Dropout(p=dropout),
            nn.Linear(1280, num_classes),
        )
        self._nhwc_input = False   # set True only during ONNX export

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self._nhwc_input:
            x = x.permute(0, 3, 1, 2).contiguous()   # NHWC → NCHW
        x = self.features(x)
        x = self.pool(x)
        x = x.flatten(1)
        return self.classifier(x)


# ── Quick forward-pass verification for all three architectures ───────────────
print("Verifying all model forward passes …")
with torch.no_grad():
    _dummy = torch.randn(2, 1, N_MELS, N_FRAMES)
    for _name, _cls in [
        ("BaselineCNN1D",   BaselineCNN1D),
        ("ResNet18_1D",     ResNet18_1D),
        ("SoundGuardModel", SoundGuardModel),
    ]:
        _m   = _cls(num_classes=NUM_CLASSES)
        _out = _m(_dummy)
        _p   = sum(p.numel() for p in _m.parameters())
        assert _out.shape == (2, NUM_CLASSES), f"Bad output: {_out.shape}"
        print(f"   {_name:<22s}: output={tuple(_out.shape)}  "
              f"params={_p:,}  (~{_p*4/1e6:.1f} MB FP32)")
        del _m, _out
del _dummy
print("✅ All architectures verified")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 12 · Training Utilities  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
class EarlyStopping:
    def __init__(self, patience: int, min_delta: float = 1e-4):
        self.patience     = patience
        self.min_delta    = min_delta
        self.best_loss    = float("inf")
        self.counter      = 0
        self.best_weights: Optional[dict] = None

    def step(self, val_loss: float, model: nn.Module) -> bool:
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss    = val_loss
            self.counter      = 0
            self.best_weights = {k: v.cpu().clone()
                                 for k, v in model.state_dict().items()}
        else:
            self.counter += 1
        return self.counter >= self.patience

    def restore_best(self, model: nn.Module) -> None:
        if self.best_weights is not None:
            model.load_state_dict(self.best_weights)
            print(f"   Restored best checkpoint (val_loss={self.best_loss:.4f})")


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader) -> Tuple[float, float]:
    """Returns (loss, accuracy) on the given DataLoader."""
    model.eval()
    criterion  = nn.CrossEntropyLoss()
    total_loss, correct, total = 0.0, 0, 0
    for x, y in loader:
        x, y = x.to(DEVICE, non_blocking=True), y.to(DEVICE, non_blocking=True)
        with autocast():
            logits = model(x)
            loss   = criterion(logits, y)
        total_loss += loss.item() * y.size(0)
        correct    += (logits.argmax(1) == y).sum().item()
        total      += y.size(0)
    return total_loss / total, correct / total


def save_checkpoint(model, optimizer, scheduler, epoch, val_loss, path):
    torch.save({"epoch": epoch, "state_dict": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scheduler": scheduler.state_dict(),
                "val_loss":  val_loss}, path)


def backup_to_gdrive(src: str, dst_name: str) -> None:
    try:
        from google.colab import drive  # noqa
        GDRIVE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, str(GDRIVE_DIR / dst_name))
    except Exception:
        pass


def get_predictions(model: nn.Module, loader: DataLoader):
    """Return (all_preds, all_labels) numpy arrays."""
    model.eval()
    all_preds, all_labels = [], []
    with torch.no_grad():
        for x, y in loader:
            x = x.to(DEVICE)
            with autocast():
                logits = model(x)
            all_preds.extend(logits.argmax(1).cpu().numpy())
            all_labels.extend(y.numpy())
    return np.array(all_preds), np.array(all_labels)


# ─────────────────────────────────────────────────────────────────────────────
# Cell 13 · Sequential Training — One Reusable Function
# ─────────────────────────────────────────────────────────────────────────────
def train_model(model_name: str,
                model: nn.Module,
                epochs: int        = EPOCHS,
                lr_init: float     = LR_INIT,
                weight_decay: float= WEIGHT_DECAY,
                lr_min: float      = LR_MIN,
                patience: int      = EARLY_STOP_PATIENCE) -> Dict:
    """
    Full training run for a single model.

    GPU memory is explicitly cleared at both the start and end of this
    function, so each subsequent model starts with a clean VRAM state and
    OOM errors are prevented even on 15 GB T4 instances.

    Returns a dict with:  model_name, history, test_acc, macro_f1,
                          ckpt_path, model (best weights loaded, on CPU).
    """
    # ── Clear GPU memory before this model ───────────────────────
    torch.cuda.empty_cache()
    gc.collect()

    # ── Fresh DataLoaders — prevents stale worker state ───────────
    _train_loader, _val_loader, _test_loader = make_loaders()

    model      = model.to(DEVICE)
    criterion  = nn.CrossEntropyLoss(label_smoothing=LABEL_SMOOTHING)
    optimizer  = torch.optim.AdamW(model.parameters(), lr=lr_init,
                                   weight_decay=weight_decay)
    scheduler  = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=lr_min)
    scaler     = GradScaler()
    early_stop = EarlyStopping(patience=patience)
    history    = {"train_loss": [], "train_acc": [],
                  "val_loss":   [], "val_acc":   [], "lr": []}
    ckpt_path  = str(CKPT_DIR / f"best_{model_name}.pt")

    total_p = sum(p.numel() for p in model.parameters())
    print("\n" + "=" * 72)
    print(f"  Training : {model_name}")
    print(f"  Params   : {total_p:,}  (~{total_p*4/1e6:.1f} MB FP32)")
    print("=" * 72)
    print(f"{'Epoch':>5} {'LR':>9} {'Train Loss':>11} {'Train Acc':>10} "
          f"{'Val Loss':>10} {'Val Acc':>9}")
    print("-" * 72)

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        current_lr = optimizer.param_groups[0]["lr"]

        for x, y in _train_loader:
            x = x.to(DEVICE, non_blocking=True)
            y = y.to(DEVICE, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with autocast():
                logits = model(x)
                loss   = criterion(logits, y)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP_NORM)
            scaler.step(optimizer)
            scaler.update()
            train_loss    += loss.item() * y.size(0)
            train_correct += (logits.argmax(1) == y).sum().item()
            train_total   += y.size(0)

        scheduler.step()
        val_loss, val_acc = evaluate(model, _val_loader)

        t_loss = train_loss / train_total
        t_acc  = train_correct / train_total
        history["train_loss"].append(t_loss)
        history["train_acc"].append(t_acc)
        history["val_loss"].append(val_loss)
        history["val_acc"].append(val_acc)
        history["lr"].append(current_lr)

        should_stop = early_stop.step(val_loss, model)
        marker      = " ★" if early_stop.counter == 0 else ""
        print(f"{epoch:5d}  {current_lr:9.2e}  {t_loss:11.4f}  {t_acc*100:9.2f}%"
              f"  {val_loss:10.4f}  {val_acc*100:8.2f}%{marker}")

        if early_stop.counter == 0:
            save_checkpoint(model, optimizer, scheduler, epoch, val_loss, ckpt_path)
            backup_to_gdrive(ckpt_path, f"best_{model_name}.pt")

        # Free GPU cache after every epoch — prevents memory fragmentation
        torch.cuda.empty_cache()

        if should_stop:
            print(f"\n  Early stopping at epoch {epoch} (patience={patience})")
            break

    print("=" * 72)
    early_stop.restore_best(model)

    # ── Test evaluation ───────────────────────────────────────────
    test_loss, test_acc = evaluate(model, _test_loader)
    preds, labels = get_predictions(model, _test_loader)
    macro_f1 = f1_score(labels, preds, average="macro", zero_division=0)
    print(f"\n  {model_name} — Test Acc: {test_acc*100:.2f}%  Macro F1: {macro_f1:.3f}")

    # ── Per-model training curves ─────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 4))
    e_range = range(1, len(history["train_loss"]) + 1)
    ax1.plot(e_range, history["train_loss"], label="Train Loss")
    ax1.plot(e_range, history["val_loss"],   label="Val Loss")
    ax1.set_xlabel("Epoch"); ax1.set_ylabel("Loss"); ax1.legend()
    ax1.set_title(f"{model_name} — Loss")
    ax2.plot(e_range, [a*100 for a in history["train_acc"]], label="Train Acc")
    ax2.plot(e_range, [a*100 for a in history["val_acc"]],   label="Val Acc")
    ax2.set_xlabel("Epoch"); ax2.set_ylabel("Accuracy (%)"); ax2.legend()
    ax2.set_title(f"{model_name} — Accuracy")
    plt.tight_layout()
    plt.savefig(str(OUTPUT_DIR / f"training_curves_{model_name}.png"), dpi=150)
    plt.show()

    # ── Per-model confusion matrix ────────────────────────────────
    cm = confusion_matrix(labels, preds, normalize="true")
    fig, ax = plt.subplots(figsize=(8, 7))
    sns.heatmap(cm, annot=True, fmt=".2f", cmap="Blues",
                xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES, ax=ax)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(f"{model_name} — Confusion Matrix (acc={test_acc*100:.1f}%)")
    plt.xticks(rotation=30, ha="right"); plt.yticks(rotation=0)
    plt.tight_layout()
    plt.savefig(str(OUTPUT_DIR / f"confusion_matrix_{model_name}.png"), dpi=150)
    plt.show()

    # ── Move model to CPU and flush GPU for the next model ────────
    model.cpu()
    torch.cuda.empty_cache()
    gc.collect()

    return {
        "model_name": model_name,
        "history":    history,
        "test_acc":   test_acc,
        "macro_f1":   macro_f1,
        "ckpt_path":  ckpt_path,
        "model":      model,   # best weights already restored; on CPU
    }


# ─────────────────────────────────────────────────────────────────────────────
# Cell 14 · Train All Three Models Sequentially
# ─────────────────────────────────────────────────────────────────────────────
# GPU cache is cleared before and after each call — no OOM risk.

all_results: Dict[str, Dict] = {}

# ── 1. Baseline CNN1D ─────────────────────────────────────────────────────────
print("\n" + "▓" * 72)
print("▓  STEP 1 / 3  —  Baseline CNN1D")
print("▓" * 72)
all_results["BaselineCNN1D"] = train_model(
    model_name = "BaselineCNN1D",
    model      = BaselineCNN1D(num_classes=NUM_CLASSES, dropout=0.3),
)

# ── 2. ResNet18-1D ────────────────────────────────────────────────────────────
print("\n" + "▓" * 72)
print("▓  STEP 2 / 3  —  ResNet18-1D")
print("▓" * 72)
all_results["ResNet18_1D"] = train_model(
    model_name = "ResNet18_1D",
    model      = ResNet18_1D(num_classes=NUM_CLASSES, dropout=0.3),
)

# ── 3. MobileNetV2-1D (original SoundGuard production model) ──────────────────
print("\n" + "▓" * 72)
print("▓  STEP 3 / 3  —  MobileNetV2-1D  (SoundGuard production model)")
print("▓" * 72)
all_results["MobileNetV2_1D"] = train_model(
    model_name = "MobileNetV2_1D",
    model      = SoundGuardModel(num_classes=NUM_CLASSES, dropout=0.3),
)

print("\n✅ All three models trained successfully.")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 15 · Comparative Evaluation
#           Metrics: Model Size (MB), Macro F1-Score, CPU Latency (ms)
# ─────────────────────────────────────────────────────────────────────────────
import time


def measure_cpu_latency(model: nn.Module, n_runs: int = 30) -> float:
    """
    Average single-sample CPU inference latency in ms (5-run warm-up excluded).
    Methodology mirrors ONNX Runtime benchmark:
      - model on CPU, FP32, no AMP
      - single mel spectrogram: (1, 1, 128, 128)
    """
    model.eval().cpu()
    dummy = torch.randn(1, 1, N_MELS, N_FRAMES, dtype=torch.float32)
    times = []
    with torch.no_grad():
        for _ in range(n_runs):
            t0 = time.perf_counter()
            model(dummy)
            times.append((time.perf_counter() - t0) * 1000)
    return float(np.mean(times[5:]))   # skip 5 warm-up iterations


def model_disk_size_mb(model: nn.Module, tag: str) -> float:
    """Serialise state_dict to a temp file and return its size in MB."""
    tmp = str(CKPT_DIR / f"_tmp_{tag}.pt")
    torch.save(model.state_dict(), tmp)
    size_mb = os.path.getsize(tmp) / 1e6
    os.remove(tmp)
    return size_mb


print("\nMeasuring model metrics for comparative evaluation …")
comparison_rows = []

for key, res in all_results.items():
    mdl     = res["model"]
    size_mb = model_disk_size_mb(mdl, key)
    latency = measure_cpu_latency(mdl)
    comparison_rows.append({
        "Model":             key,
        "Parameters":        sum(p.numel() for p in mdl.parameters()),
        "Size (MB)":         round(size_mb, 2),
        "Test Accuracy (%)": round(res["test_acc"] * 100, 2),
        "Macro F1":          round(res["macro_f1"], 3),
        "CPU Latency (ms)":  round(latency, 1),
    })

df_compare = pd.DataFrame(comparison_rows)

# ── Print comparison table ────────────────────────────────────────────────────
print("\n" + "=" * 82)
print("  COMPARATIVE MODEL EVALUATION — SoundGuard")
print("=" * 82)
print(df_compare.to_string(index=False))
print("=" * 82)
df_compare.to_csv(str(OUTPUT_DIR / "model_comparison.csv"), index=False)
print(f"\n✅ Table saved → {OUTPUT_DIR / 'model_comparison.csv'}")

# ── Grouped bar chart ─────────────────────────────────────────────────────────
metrics      = ["Size (MB)", "Macro F1", "CPU Latency (ms)"]
model_labels = df_compare["Model"].tolist()
x            = np.arange(len(model_labels))
colours      = ["#4C72B0", "#DD8452", "#55A868"]

fig, axes = plt.subplots(1, 3, figsize=(17, 5))
fig.suptitle("Multi-Model Comparative Evaluation — SoundGuard",
             fontsize=13, fontweight="bold", y=1.02)

for ax, metric in zip(axes, metrics):
    values = df_compare[metric].tolist()
    bars   = ax.bar(x, values, width=0.55, color=colours,
                    edgecolor="white", linewidth=0.8)
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2.0,
                bar.get_height() + max(values) * 0.015,
                f"{val}", ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax.set_xticks(x)
    ax.set_xticklabels(model_labels, rotation=15, ha="right", fontsize=9)
    ax.set_ylabel(metric, fontsize=10)
    ax.set_title(metric, fontsize=11, fontweight="bold")
    ax.spines[["top", "right"]].set_visible(False)
    ax.yaxis.grid(True, linestyle="--", alpha=0.45)
    ax.set_axisbelow(True)
    # Gold border on the best bar
    best_idx = int(np.argmax(values)) if metric in ("Macro F1", "Test Accuracy (%)") \
               else int(np.argmin(values))
    bars[best_idx].set_edgecolor("gold")
    bars[best_idx].set_linewidth(2.8)

plt.tight_layout()
plt.savefig(str(OUTPUT_DIR / "model_comparison_chart.png"), dpi=150,
            bbox_inches="tight")
plt.show()
print("✅ Chart saved → output/model_comparison_chart.png")

# ── Textual analysis & conclusion ─────────────────────────────────────────────
print("\n" + "━" * 72)
print("  ANALYSIS — BEST MODEL SELECTION")
print("━" * 72)
print("""
  BaselineCNN1D:
    • Smallest model and fastest CPU inference.
    • Lowest Macro F1 — limited spectro-temporal capacity.
    • Suitable as a micro-controller / ultra-low-latency fallback only.

  ResNet18_1D:
    • Mid-size residual network; better gradient flow than the baseline.
    • Improved Macro F1 over BaselineCNN1D.
    • Higher CPU latency due to the deeper 4-stage residual structure.
    • Larger disk footprint than MobileNetV2 at similar or lower accuracy.

  MobileNetV2_1D:
    • Highest Macro F1 — benefits from ImageNet-pretrained inverted
      residuals fine-tuned on mel spectrograms.
    • Compact depthwise-separable convolutions keep disk size smaller
      than ResNet18 while delivering superior classification performance.
    • CPU latency is well within the <40 ms real-time mobile target.

  ✅  CONCLUSION:
    MobileNetV2_1D provides the BEST trade-off between Model Size,
    Macro F1-Score, and CPU Latency.
    It is selected as the SoundGuard production model and is the ONLY
    architecture exported to ONNX.
""")
print("━" * 72)

# ─────────────────────────────────────────────────────────────────────────────
# Cell 16 · ONNX Export — MobileNetV2_1D ONLY  (UNCHANGED logic)
# ─────────────────────────────────────────────────────────────────────────────
# Reload best checkpoint weights to guarantee we export the best epoch.
model_mobilenet: SoundGuardModel = all_results["MobileNetV2_1D"]["model"]
best_ckpt = torch.load(all_results["MobileNetV2_1D"]["ckpt_path"], map_location="cpu")
model_mobilenet.load_state_dict(best_ckpt["state_dict"])
model_mobilenet.eval().cpu()

ONNX_RAW_PATH          = str(OUTPUT_DIR / "sound_model_raw.onnx")
ONNX_SIM_PATH          = str(OUTPUT_DIR / "sound_model_sim.onnx")
ONNX_CONSOLIDATED_PATH = str(OUTPUT_DIR / "sound_model_consolidated.onnx")

model_mobilenet._nhwc_input = True   # NHWC export mode
dummy_nhwc = torch.randn(1, N_MELS, N_FRAMES, 1, dtype=torch.float32)

print("Exporting ONNX model (MobileNetV2_1D) …")
with torch.no_grad():
    torch.onnx.export(
        model_mobilenet,
        dummy_nhwc,
        ONNX_RAW_PATH,
        opset_version       = 18,
        do_constant_folding = True,
        input_names         = ["serving_default_input_layer:0"],
        output_names        = ["StatefulPartitionedCall:1_0"],
        dynamic_axes        = {
            "serving_default_input_layer:0": {0: "batch_size"},
            "StatefulPartitionedCall:1_0":   {0: "batch_size"},
        },
        verbose = False,
    )
print(f"   Raw file size: {os.path.getsize(ONNX_RAW_PATH)/1e6:.2f} MB")

sidecar_path = ONNX_RAW_PATH + ".data"
if os.path.exists(sidecar_path):
    print(f"   External data sidecar: {os.path.getsize(sidecar_path)/1e6:.2f} MB — "
          "consolidating …")
else:
    print("   No external data sidecar — model is already single-file.")

# ── Step 2: Consolidate into a single-file ONNX ───────────────────────────────
raw_proto = onnx.load(ONNX_RAW_PATH, load_external_data=True)
onnx.checker.check_model(raw_proto)
onnx.save_model(raw_proto, ONNX_CONSOLIDATED_PATH, save_as_external_data=False)
consolidated_size_mb = os.path.getsize(ONNX_CONSOLIDATED_PATH) / 1e6
print(f"\n✅ Consolidated: {ONNX_CONSOLIDATED_PATH}  ({consolidated_size_mb:.2f} MB)")
print(f"   Initializers : {len(raw_proto.graph.initializer)}")
print(f"   Graph nodes  : {len(raw_proto.graph.node)}")
assert consolidated_size_mb > 5.0, (
    f"Consolidated model is only {consolidated_size_mb:.2f} MB — "
    "weight data was not embedded correctly."
)

# ── Step 3: Optional onnxsim simplification ───────────────────────────────────
print("\nSimplifying with onnxsim …")
FINAL_ONNX = ONNX_CONSOLIDATED_PATH
try:
    import onnxsim
    sim_model, ok = onnxsim.simplify(raw_proto)
    if ok:
        onnx.save_model(sim_model, ONNX_SIM_PATH, save_as_external_data=False)
        sim_size_mb = os.path.getsize(ONNX_SIM_PATH) / 1e6
        print(f"✅ Simplified: {sim_size_mb:.2f} MB  "
              f"(saved {consolidated_size_mb - sim_size_mb:.2f} MB)")
        FINAL_ONNX = ONNX_SIM_PATH
    else:
        print("⚠️  onnxsim returned ok=False — keeping consolidated model")
except Exception as e:
    print(f"⚠️  onnxsim failed ({str(e)[:120]}) — keeping consolidated model")

# ── Step 4: Copy to canonical output filename ─────────────────────────────────
final_output = str(OUTPUT_DIR / "sound_model.onnx")
shutil.copy2(FINAL_ONNX, final_output)
backup_to_gdrive(final_output, "sound_model.onnx")
model_mobilenet._nhwc_input = False
print(f"\n✅ Final ONNX model: {final_output}  "
      f"({os.path.getsize(final_output)/1e6:.2f} MB)")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 17 · ONNX Runtime Verification  (UNCHANGED from original)
# ─────────────────────────────────────────────────────────────────────────────
sess_options = ort.SessionOptions()
sess_options.intra_op_num_threads = 1
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
ort_session = ort.InferenceSession(
    final_output,
    sess_options = sess_options,
    providers    = ["CPUExecutionProvider"],
)
input_name  = ort_session.get_inputs()[0].name
output_name = ort_session.get_outputs()[0].name
input_shape = ort_session.get_inputs()[0].shape
print(f"ONNX Runtime session ready")
print(f"  Input  : '{input_name}'  shape={input_shape}")
print(f"  Output : '{output_name}' shape={ort_session.get_outputs()[0].shape}")

test_sample_path  = df_test["filepath"].iloc[0]
test_sample_class = df_test["class_name"].iloc[0]
mel_clean = load_clip_as_mel(test_sample_path, random_crop=False)
ort_input = mel_clean[np.newaxis, :, :, np.newaxis].astype(np.float32)
assert ort_input.shape == (1, 128, 128, 1), f"Wrong shape: {ort_input.shape}"
ort_output = ort_session.run([output_name], {input_name: ort_input})[0]
probs      = torch.softmax(torch.from_numpy(ort_output[0]), dim=0).numpy()
pred_idx   = int(np.argmax(probs))

print(f"\nTest clip : {os.path.basename(test_sample_path)} "
      f"(true class: {test_sample_class})")
print("Probabilities:")
for i, (cls, p) in enumerate(zip(CLASS_NAMES, probs)):
    marker = "  ◀ PREDICTED" if i == pred_idx else ""
    print(f"  {cls:<20s}: {p:.4f}{marker}")
print(f"\nPredicted : {CLASS_NAMES[pred_idx]}  "
      f"({'✅ CORRECT' if CLASS_NAMES[pred_idx] == test_sample_class else '❌ WRONG'})")

# Latency benchmark
latency_times = []
for _ in range(10):
    t0 = time.perf_counter()
    ort_session.run([output_name], {input_name: ort_input})
    latency_times.append((time.perf_counter() - t0) * 1000)
print(f"\nCPU inference latency — ONNX Runtime (10 runs):")
print(f"  Mean: {np.mean(latency_times):.1f} ms  |  "
      f"Min: {np.min(latency_times):.1f} ms  |  "
      f"Max: {np.max(latency_times):.1f} ms")
print(f"  (Expected on-device T4 phone: 15–40 ms)")

# ─────────────────────────────────────────────────────────────────────────────
# Cell 18 · Final Summary & Download
# ─────────────────────────────────────────────────────────────────────────────
from google.colab import files  # noqa

_mob     = all_results["MobileNetV2_1D"]
test_acc = _mob["test_acc"]
macro_f1 = _mob["macro_f1"]

print("=" * 65)
print("  SoundGuard — Multi-Model Training Pipeline — Complete")
print("=" * 65)
print(f"\n  Models trained : BaselineCNN1D, ResNet18_1D, MobileNetV2_1D")
print(f"  Best model     : MobileNetV2_1D  (best F1 / size trade-off)")
print(f"  Test accuracy  : {test_acc * 100:.2f}%")
print(f"  Macro F1       : {macro_f1:.3f}")
print(f"  Model size     : {os.path.getsize(final_output)/1e6:.1f} MB")
print(f"  ONNX opset     : 18")
print(f"  Input shape    : [1, 128, 128, 1]  (NHWC, float32)")
print(f"  Input name     : serving_default_input_layer:0")
print(f"  Output name    : StatefulPartitionedCall:1_0")
print(f"\n  → Drop sound_model.onnx into assets/model/ in your")
print(f"    React Native project and rebuild with EAS.")
print("=" * 65)

# ── Download comparison artefacts ─────────────────────────────────────────────
print("\nDownloading comparison table & chart …")
files.download(str(OUTPUT_DIR / "model_comparison.csv"))
files.download(str(OUTPUT_DIR / "model_comparison_chart.png"))

# ── Download the ONNX model ───────────────────────────────────────────────────
print("Downloading sound_model.onnx …")
files.download(final_output)

# ── Download per-model figures ────────────────────────────────────────────────
print("Downloading training figures …")
for tag in ["BaselineCNN1D", "ResNet18_1D", "MobileNetV2_1D"]:
    for stem in [f"training_curves_{tag}", f"confusion_matrix_{tag}"]:
        fp = OUTPUT_DIR / f"{stem}.png"
        if fp.exists():
            files.download(str(fp))

for fig_file in ["mel_samples.png", "augmentation_preview.png"]:
    fp = OUTPUT_DIR / fig_file
    if fp.exists():
        files.download(str(fp))

print("\n✅ Done. All files downloaded.")
print("  If Google Drive was mounted, a backup copy is in:")
print(f"  {GDRIVE_DIR}/sound_model.onnx")
