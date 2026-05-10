import os
import json
import joblib
import numpy as np
import tensorflow as tf
import matplotlib.pyplot as plt

from collections import Counter
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import (
    LSTM,
    Dense,
    Dropout,
    BatchNormalization,
    Bidirectional,
    Conv1D,
    MaxPooling1D
)

from tensorflow.keras.callbacks import (
    EarlyStopping,
    ReduceLROnPlateau,
    ModelCheckpoint
)

from tensorflow.keras.regularizers import l2
from tensorflow.keras.optimizers import Adam


class SLSTrainer:
    """
    Sinhala Sign Language Trainer
    CNN + BiLSTM Hybrid Model
    """

    def __init__(
        self,
        data_path="data/processed",
        model_path="models"
    ):

        self.data_path = data_path
        self.model_path = model_path

        os.makedirs(self.model_path, exist_ok=True)

    # =========================================================
    # LOAD DATA
    # =========================================================

    def load_processed_data(self):

        data_file = os.path.join(
            self.data_path,
            "landmark_sequences.npz"
        )

        if not os.path.exists(data_file):
            raise FileNotFoundError(
                "Processed dataset not found."
            )

        data = np.load(data_file, allow_pickle=True)

        X = data["X"]
        y = data["y"]

        print("\n" + "=" * 60)
        print("📊 DATASET STATISTICS")
        print("=" * 60)

        print(f"Total Sequences : {len(X)}")
        print(f"Input Shape     : {X.shape}")
        print(f"Unique Classes  : {len(np.unique(y))}")

        # Class distribution
        unique, counts = np.unique(y, return_counts=True)

        print("\n📈 TOP CLASS DISTRIBUTION")

        sorted_idx = np.argsort(counts)[::-1]

        for i in range(min(10, len(unique))):
            idx = sorted_idx[i]
            print(f"{unique[idx]} : {counts[idx]}")

        return X, y

    # =========================================================
    # CLEAN DATASET
    # =========================================================

    def filter_small_classes(
        self,
        X,
        y,
        min_samples=3
    ):
        """
        Remove classes with very few samples
        """

        counter = Counter(y)

        valid_classes = [
            cls for cls, count in counter.items()
            if count >= min_samples
        ]

        indices = [
            i for i, label in enumerate(y)
            if label in valid_classes
        ]

        X_filtered = X[indices]
        y_filtered = y[indices]

        print("\n" + "=" * 60)
        print("🧹 DATA CLEANING")
        print("=" * 60)

        print(f"Original Samples : {len(X)}")
        print(f"Filtered Samples : {len(X_filtered)}")

        print(f"Original Classes : {len(counter)}")
        print(f"Remaining Classes: {len(valid_classes)}")

        return X_filtered, y_filtered

    # =========================================================
    # BUILD MODEL
    # =========================================================

    def build_model(
        self,
        input_shape,
        num_classes
    ):

        model = Sequential([

            # =================================================
            # CNN FEATURE EXTRACTION
            # =================================================

            Conv1D(
                64,
                kernel_size=3,
                padding="same",
                activation="relu",
                input_shape=input_shape
            ),

            BatchNormalization(),
            MaxPooling1D(2),
            Dropout(0.25),

            Conv1D(
                128,
                kernel_size=3,
                padding="same",
                activation="relu"
            ),

            BatchNormalization(),
            MaxPooling1D(2),
            Dropout(0.25),

            # =================================================
            # LSTM TEMPORAL LEARNING
            # =================================================

            Bidirectional(
                LSTM(
                    128,
                    return_sequences=True,
                    kernel_regularizer=l2(0.001)
                )
            ),

            BatchNormalization(),
            Dropout(0.3),

            Bidirectional(
                LSTM(
                    64,
                    return_sequences=False,
                    kernel_regularizer=l2(0.001)
                )
            ),

            BatchNormalization(),
            Dropout(0.3),

            # =================================================
            # CLASSIFIER
            # =================================================

            Dense(
                128,
                activation="relu",
                kernel_regularizer=l2(0.001)
            ),

            Dropout(0.4),

            Dense(
                64,
                activation="relu"
            ),

            Dropout(0.3),

            Dense(
                num_classes,
                activation="softmax"
            )

        ])

        optimizer = Adam(learning_rate=0.001)

        model.compile(
            optimizer=optimizer,
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"]
        )

        return model

    # =========================================================
    # TRAIN
    # =========================================================

    def train(
        self,
        X,
        y,
        epochs=100,
        batch_size=16,
        validation_split=0.2
    ):

        # =====================================================
        # REMOVE SMALL CLASSES
        # =====================================================

        X, y = self.filter_small_classes(
            X,
            y,
            min_samples=3
        )

        # =====================================================
        # LABEL ENCODING
        # =====================================================

        self.label_encoder = LabelEncoder()

        y_encoded = self.label_encoder.fit_transform(y)

        # =====================================================
        # TRAIN TEST SPLIT
        # =====================================================

        X_train, X_val, y_train, y_val = train_test_split(
            X,
            y_encoded,
            test_size=validation_split,
            random_state=42,
            shuffle=True
        )

        print("\n" + "=" * 60)
        print("📊 TRAIN / VALIDATION SPLIT")
        print("=" * 60)

        print(f"Training Samples   : {len(X_train)}")
        print(f"Validation Samples : {len(X_val)}")

        # =====================================================
        # BUILD MODEL
        # =====================================================

        input_shape = (
            X.shape[1],
            X.shape[2]
        )

        num_classes = len(
            self.label_encoder.classes_
        )

        model = self.build_model(
            input_shape,
            num_classes
        )

        print("\n" + "=" * 60)
        print("🤖 MODEL SUMMARY")
        print("=" * 60)

        model.summary()

        # =====================================================
        # CALLBACKS
        # =====================================================

        callbacks = [

            EarlyStopping(
                monitor="val_loss",
                patience=20,
                restore_best_weights=True,
                verbose=1
            ),

            ReduceLROnPlateau(
                monitor="val_loss",
                factor=0.5,
                patience=8,
                min_lr=1e-5,
                verbose=1
            ),

            ModelCheckpoint(
                filepath=os.path.join(
                    self.model_path,
                    "best_model.h5"
                ),

                monitor="val_accuracy",
                save_best_only=True,
                mode="max",
                verbose=1
            )
        ]

        # =====================================================
        # TRAINING
        # =====================================================

        print("\n" + "=" * 60)
        print("🏋️ STARTING TRAINING")
        print("=" * 60)

        history = model.fit(
            X_train,
            y_train,

            validation_data=(
                X_val,
                y_val
            ),

            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )

        # =====================================================
        # EVALUATION
        # =====================================================

        print("\n" + "=" * 60)
        print("📊 MODEL EVALUATION")
        print("=" * 60)

        train_loss, train_acc = model.evaluate(
            X_train,
            y_train,
            verbose=0
        )

        val_loss, val_acc = model.evaluate(
            X_val,
            y_val,
            verbose=0
        )

        print(f"Training Accuracy   : {train_acc*100:.2f}%")
        print(f"Validation Accuracy : {val_acc*100:.2f}%")

        # =====================================================
        # SAVE MODEL
        # =====================================================

        model.save(
            os.path.join(
                self.model_path,
                "ssl_lstm_model.h5"
            )
        )

        joblib.dump(
            self.label_encoder,
            os.path.join(
                self.model_path,
                "label_encoder.pkl"
            )
        )

        # =====================================================
        # SAVE HISTORY
        # =====================================================

        history_file = os.path.join(
            self.model_path,
            "training_history.json"
        )

        with open(history_file, "w") as f:

            json.dump(
                {
                    k: [float(x) for x in v]
                    for k, v in history.history.items()
                },
                f
            )

        print("\n✅ MODEL SAVED SUCCESSFULLY")

        # =====================================================
        # PLOT TRAINING
        # =====================================================

        self.plot_training_history(history)

        return model, history

    # =========================================================
    # PLOT HISTORY
    # =========================================================

    def plot_training_history(
        self,
        history
    ):

        plt.figure(figsize=(12, 5))

        # Accuracy
        plt.subplot(1, 2, 1)

        plt.plot(
            history.history["accuracy"],
            label="Train Accuracy"
        )

        plt.plot(
            history.history["val_accuracy"],
            label="Validation Accuracy"
        )

        plt.title("Accuracy")
        plt.xlabel("Epoch")
        plt.ylabel("Accuracy")
        plt.legend()

        # Loss
        plt.subplot(1, 2, 2)

        plt.plot(
            history.history["loss"],
            label="Train Loss"
        )

        plt.plot(
            history.history["val_loss"],
            label="Validation Loss"
        )

        plt.title("Loss")
        plt.xlabel("Epoch")
        plt.ylabel("Loss")
        plt.legend()

        plt.tight_layout()

        save_path = os.path.join(
            self.model_path,
            "training_plot.png"
        )

        plt.savefig(save_path)

        plt.show()

        print(f"\n📈 Training plot saved:")
        print(save_path)

    # =========================================================
    # EXPORT TFLITE
    # =========================================================

    def export_to_tflite(self):

        model_path = os.path.join(
            self.model_path,
            "ssl_lstm_model.h5"
        )

        model = tf.keras.models.load_model(
            model_path
        )

        converter = tf.lite.TFLiteConverter.from_keras_model(
            model
        )

        converter.optimizations = [
            tf.lite.Optimize.DEFAULT
        ]

        tflite_model = converter.convert()

        tflite_path = os.path.join(
            self.model_path,
            "ssl_model.tflite"
        )

        with open(tflite_path, "wb") as f:
            f.write(tflite_model)

        print("\n✅ TFLite Model Exported")
        print(tflite_path)

        return tflite_path


# =============================================================
# MAIN
# =============================================================

if __name__ == "__main__":

    trainer = SLSTrainer()

    # Load data
    X, y = trainer.load_processed_data()

    # Train model
    model, history = trainer.train(
        X,
        y,
        epochs=50,
        batch_size=16
    )

    # Export optional
    # trainer.export_to_tflite()

    print("\n✅ TRAINING COMPLETE")