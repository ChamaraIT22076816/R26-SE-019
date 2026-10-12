"""File and dataset management utilities for Sinhala Sign Language Recognition."""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import numpy as np
import yaml

def load_yaml_config(config_path: str = "config/config.yaml") -> Dict[str, Any]:
    """Safely load YAML configuration file."""
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path.resolve()}")
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def load_processed_dataset(data_dir: str = "data/processed") -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """Load pre-processed sequences, labels, and metadata.
    
    Returns:
        (X, y, metadata_dict)
    """
    path = Path(data_dir)
    data_file = path / "processed_data.npy"
    labels_file = path / "labels.npy"
    meta_file = path / "metadata.json"
    
    if not data_file.exists():
        raise FileNotFoundError(f"Missing processed data array at {data_file}")
    if not labels_file.exists():
        raise FileNotFoundError(f"Missing labels array at {labels_file}")
        
    X = np.load(data_file)
    y = np.load(labels_file, allow_pickle=True)
    
    metadata = {}
    if meta_file.exists():
        with open(meta_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
            
    return X, y, metadata

def save_json(data: Any, file_path: str, indent: int = 2):
    """Save serializable data to JSON with UTF-8 encoding."""
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
