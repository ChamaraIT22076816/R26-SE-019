"""Visualization utilities for Sinhala Sign Language Recognition."""

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, cast
import matplotlib.pyplot as plt
import numpy as np


def plot_training_curves(
    history: Dict[str, Any],
    save_path: Optional[str] = "models/saved_models/training_history.png",
    show: bool = False,
) -> None:
    """Plot and save training/validation accuracy and loss curves."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    fig = cast(Any, fig)

    # Accuracy
    if "accuracy" in history:
        ax1.plot(history["accuracy"], label="Train Accuracy", color="#2563eb", lw=2)
    if "val_accuracy" in history:
        ax1.plot(history["val_accuracy"], label="Val Accuracy", color="#10b981", lw=2)
    ax1.set_title("Model Accuracy Across Epochs", fontsize=12, fontweight="bold")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Accuracy")
    ax1.grid(True, linestyle="--", alpha=0.6)
    ax1.legend(loc="lower right")

    # Loss
    if "loss" in history:
        ax2.plot(history["loss"], label="Train Loss", color="#dc2626", lw=2)
    if "val_loss" in history:
        ax2.plot(history["val_loss"], label="Val Loss", color="#f59e0b", lw=2)
    ax2.set_title("Loss Trajectory Across Epochs", fontsize=12, fontweight="bold")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Loss")
    ax2.grid(True, linestyle="--", alpha=0.6)
    ax2.legend(loc="upper right")

    plt.tight_layout()
    if save_path:
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(save_path, dpi=300)  # type: ignore
    if show:
        plt.show()
    plt.close(fig)


def plot_confusion_matrix(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    labels: Sequence[str],
    top_k: int = 20,
    save_path: Optional[str] = "models/saved_models/confusion_matrix.png",
) -> None:
    """Plot confusion matrix for the most frequent or top-k classes."""
    from sklearn.metrics import confusion_matrix

    cm = confusion_matrix(cast(Any, y_true), cast(Any, y_pred))
    display_labels: List[str] = list(labels)

    # Sub-select top_k classes if too large for legible display
    if len(display_labels) > top_k:
        cm = cm[:top_k, :top_k]
        display_labels = display_labels[:top_k]

    fig, ax = plt.subplots(figsize=(10, 8))
    fig = cast(Any, fig)
    cax = ax.matshow(cm, cmap="Blues", alpha=0.85)
    fig.colorbar(cax)

    ticks = np.arange(len(display_labels))
    ax.set_xticks(ticks)
    ax.set_yticks(ticks)
    ax.set_xticklabels(display_labels, rotation=45, ha="left", fontsize=9)
    ax.set_yticklabels(display_labels, fontsize=9)

    ax.set_title(f"Confusion Matrix (Top {len(display_labels)} Classes)", pad=20, fontweight="bold")
    ax.set_ylabel("True Class")
    ax.set_xlabel("Predicted Class")
    plt.tight_layout()

    if save_path:
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(save_path, dpi=300)  # type: ignore
    plt.close(fig)
