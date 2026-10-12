"""Automated training, comprehensive multi-metric evaluation, and side-by-side comparison

Trains and benchmarks:
1. Stacked LSTM (Baseline)
2. Bidirectional LSTM (Bi-LSTM)
3. Spatial-Temporal Transformer (SignTransformerRecognizer)

Calculates:
- Categorical Accuracy
- Macro and Weighted Precision
- Macro and Weighted Recall
- Macro and Weighted F1-Score
- Top-3 and Top-5 Accuracy
- Real-time Inference Latency (ms per sequence)
- Parameter Count
Generates:
- models/saved_models/model_comparison.json
- models/saved_models/model_comparison.png
- models/saved_models/{model}_confusion_matrix.png
"""

import os
import sys
import time
import json
from pathlib import Path
from datetime import datetime
from typing import Any, cast
import yaml
import numpy as np
import matplotlib.pyplot as plt

# Ensure root and src are on path
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "src"))

import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
to_categorical = tf.keras.utils.to_categorical
from sklearn.metrics import precision_score, recall_score, f1_score

from model.lstm_model import LSTMRecognizer
from model.transformer_model import SignTransformerRecognizer
from model.model_trainer import ModelTrainer
from utils.visualization import plot_confusion_matrix


def load_config():
    with open(ROOT_DIR / "config" / "config.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def prepare_data(config):
    data_path = ROOT_DIR / config['dataset']['processed_path']
    X = np.load(data_path / 'processed_data.npy')
    y_raw = np.load(data_path / 'labels.npy', allow_pickle=True)

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y_raw)
    y_cat = to_categorical(y_encoded)
    classes = list(encoder.classes_)

    config['dataset']['num_classes'] = len(classes)

    X_train, X_test, y_train, y_test, y_enc_train, y_enc_test = train_test_split(
        X, y_cat, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train, y_train, test_size=0.2, random_state=42
    )

    print(f"Dataset Loaded: {len(X)} total sequences across {len(classes)} classes.")
    print(f"Splits -> Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
    return (X_train, y_train), (X_val, y_val), (X_test, y_test, y_enc_test), classes


def benchmark_latency(model, sample_input, iterations=50):
    """Measure inference latency per sequence in milliseconds."""
    # Warmup
    for _ in range(5):
        _ = model.predict(sample_input, verbose=0)

    start = time.perf_counter()
    for _ in range(iterations):
        _ = model.predict(sample_input, verbose=0)
    elapsed = time.perf_counter() - start
    return round((elapsed / iterations) * 1000.0, 2)


def evaluate_metrics(model, X_test, y_test_cat, y_test_indices, model_name, save_dir, classes):
    y_prob = model.predict(X_test, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)

    eval_res = model.evaluate(X_test, y_test_cat, verbose=0)
    eval_loss = float(eval_res[0])
    eval_acc = float(eval_res[1])
    top3 = float(eval_res[2]) if len(eval_res) > 2 else float(eval_acc)
    top5 = float(eval_res[3]) if len(eval_res) > 3 else float(eval_acc)

    p_macro = precision_score(y_test_indices, y_pred, average='macro', zero_division=0)
    p_weight = precision_score(y_test_indices, y_pred, average='weighted', zero_division=0)
    r_macro = recall_score(y_test_indices, y_pred, average='macro', zero_division=0)
    r_weight = recall_score(y_test_indices, y_pred, average='weighted', zero_division=0)
    f1_macro = f1_score(y_test_indices, y_pred, average='macro', zero_division=0)
    f1_weight = f1_score(y_test_indices, y_pred, average='weighted', zero_division=0)

    sample = X_test[:1]
    latency_ms = benchmark_latency(model, sample)

    # Plot confusion matrix
    cm_path = save_dir / f"{model_name}_confusion_matrix.png"
    plot_confusion_matrix(y_test_indices, y_pred, classes, top_k=20, save_path=str(cm_path))

    metrics = {
        "model_name": model_name,
        "parameters": int(model.count_params()),
        "test_loss": float(eval_loss),
        "test_accuracy": float(eval_acc),
        "precision_macro": float(p_macro),
        "precision_weighted": float(p_weight),
        "recall_macro": float(r_macro),
        "recall_weighted": float(r_weight),
        "f1_score_macro": float(f1_macro),
        "f1_score_weighted": float(f1_weight),
        "top_3_accuracy": float(top3),
        "top_5_accuracy": float(top5),
        "inference_latency_ms": float(latency_ms),
    }

    metrics_file = save_dir / f"{model_name}_evaluation_results.json"
    with open(metrics_file, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    return metrics


def plot_comparison_chart(comparison_data, save_path):
    models = list(comparison_data.keys())
    accuracies = [comparison_data[m]['test_accuracy'] * 100 for m in models]
    f1_scores = [comparison_data[m]['f1_score_weighted'] * 100 for m in models]
    latencies = [comparison_data[m]['inference_latency_ms'] for m in models]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    fig = cast(Any, fig)

    # Metric Bars
    x = np.arange(len(models))
    width = 0.35

    rects1 = ax1.bar(x - width/2, accuracies, width, label='Accuracy (%)', color='#2563eb')
    rects2 = ax1.bar(x + width/2, f1_scores, width, label='F1-Score Weighted (%)', color='#10b981')

    ax1.set_ylabel('Score (%)', fontweight='bold')
    ax1.set_title('Model Performance Comparison (Test Set)', fontweight='bold', fontsize=12)
    ax1.set_xticks(x)
    ax1.set_xticklabels([m.upper() for m in models], fontweight='bold')
    ax1.set_ylim([80, 102])
    ax1.grid(True, linestyle='--', alpha=0.5, axis='y')
    ax1.legend(loc='lower right')

    for r in rects1 + rects2:
        h = r.get_height()
        ax1.annotate(f'{h:.1f}%',
                    xy=(r.get_x() + r.get_width() / 2, h),
                    xytext=(0, 3), textcoords="offset points",
                    ha='center', va='bottom', fontsize=9, fontweight='bold')

    # Latency Bars
    bars = ax2.bar(models, latencies, color=['#6366f1', '#8b5cf6', '#ec4899'], width=0.45)
    ax2.set_ylabel('Inference Latency per Sequence (ms)', fontweight='bold')
    ax2.set_title('Inference Latency Benchmark', fontweight='bold', fontsize=12)
    ax2.set_xticks(range(len(models)))
    ax2.set_xticklabels([m.upper() for m in models], fontweight='bold')
    ax2.grid(True, linestyle='--', alpha=0.5, axis='y')

    for b in bars:
        h = b.get_height()
        ax2.annotate(f'{h:.1f} ms',
                    xy=(b.get_x() + b.get_width() / 2, h),
                    xytext=(0, 3), textcoords="offset points",
                    ha='center', va='bottom', fontsize=9, fontweight='bold')

    plt.tight_layout()
    fig.savefig(save_path, dpi=300)  # type: ignore
    plt.close(fig)
    print(f"Comparison chart saved to {save_path}")


def main():
    config = load_config()
    config['training']['epochs'] = 20
    config['training']['early_stopping_patience'] = 5
    save_dir = ROOT_DIR / config['training']['model_save_path']
    save_dir.mkdir(parents=True, exist_ok=True)

    (X_train, y_train), (X_val, y_val), (X_test, y_test, y_test_indices), classes = prepare_data(config)

    trainer = ModelTrainer(config)
    comparison_results = {}

    # Define architectures to train & benchmark
    experiments = [
        ("lstm", "Stacked LSTM", lambda: LSTMRecognizer(config).build_model()),
        ("bilstm", "Bidirectional LSTM", lambda: LSTMRecognizer(config).build_bidirectional_lstm()),
        ("transformer", "Spatial-Temporal Transformer", lambda: SignTransformerRecognizer(config).build_model()),
    ]

    for model_key, display_name, builder_fn in experiments:
        print("\n" + "=" * 70)
        print(f"[*] Training & Benchmarking: {display_name} ({model_key})")
        print("=" * 70)

        saved_path = save_dir / f"{model_key}_model.h5"

        if saved_path.exists() and model_key == "lstm":
            print(f"Loading existing trained {display_name} weights from {saved_path}...")
            model = tf.keras.models.load_model(str(saved_path))
            model.compile(
                optimizer='adam',
                loss='categorical_crossentropy',
                metrics=['accuracy',
                         tf.keras.metrics.TopKCategoricalAccuracy(k=3, name='top_3_accuracy'),
                         tf.keras.metrics.TopKCategoricalAccuracy(k=5, name='top_5_accuracy')]
            )
        else:
            model = builder_fn()
            # Fast training schedule with early stopping
            trained_model, history = trainer.train_model(
                model, X_train, y_train, X_val, y_val, model_name=model_key
            )
            trainer.save_model(trained_model, model_key)
            trainer.plot_training_history(history, model_name=model_key)
            model = trained_model

        metrics = evaluate_metrics(
            model, X_test, y_test, y_test_indices, model_key, save_dir, classes
        )
        comparison_results[model_key] = metrics

    # Save multi-model comparison results
    comp_file = save_dir / "model_comparison.json"
    with open(comp_file, "w", encoding="utf-8") as f:
        json.dump(comparison_results, f, indent=2)

    # Plot comparison chart
    chart_file = save_dir / "model_comparison.png"
    plot_comparison_chart(comparison_results, chart_file)

    # Print final summary table
    print("\n" + "=" * 88)
    print("MULTI-MODEL PERFORMANCE COMPARISON (TEST SPLIT)")
    print("=" * 88)
    print(f"{'Model':<15} | {'Params':<10} | {'Accuracy':<10} | {'Macro F1':<10} | {'Weighted F1':<12} | {'Top-3 Acc':<10} | {'Latency':<8}")
    print("-" * 88)
    for k, v in comparison_results.items():
        print(f"{k.upper():<15} | {v['parameters']:<10,d} | {v['test_accuracy']*100:<9.2f}% | {v['f1_score_macro']*100:<9.2f}% | {v['f1_score_weighted']*100:<11.2f}% | {v['top_3_accuracy']*100:<9.2f}% | {v['inference_latency_ms']:<6.1f}ms")
    print("=" * 88)


if __name__ == "__main__":
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
    main()
