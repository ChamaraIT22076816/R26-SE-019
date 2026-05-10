# run_complete_pipeline.py
import os
import sys
import argparse

def run_pipeline(steps=['extract', 'train'], max_videos_per_category=None, sample_ratio=1.0):
    """
    Run the complete pipeline for Kaggle dataset.
    
    Args:
        steps: Steps to run ['extract', 'augment', 'train']
        max_videos_per_category: Limit videos per category
        sample_ratio: Sample ratio for faster testing (0-1)
    """
    
    # Step 1: Extract landmarks from Kaggle dataset
    if 'extract' in steps:
        print("\n" + "="*60)
        print("📹 STEP 1: Extracting landmarks from Kaggle dataset")
        print("="*60)
        
        from src.kaggle_data_loader import KaggleDataLoader
        loader = KaggleDataLoader(data_path='data/raw', processed_path='data/processed')
        
        X, y = loader.process_all_videos(
            max_videos_per_category=max_videos_per_category,
            sequence_length=30,
            sample_ratio=sample_ratio
        )
        
        print(f"✅ Extracted {len(X)} sequences from {len(set(y))} classes")
    
    # Step 2: Train model
    if 'train' in steps:
        print("\n" + "="*60)
        print("🤖 STEP 2: Training LSTM model")
        print("="*60)
        
        from src.train_model import SLSTrainer
        trainer = SLSTrainer(data_path='data/processed', model_path='models')
        
        X, y = trainer.load_processed_data()
        model, history = trainer.train(X, y, epochs=150, batch_size=32)
        
        print("✅ Model training complete!")
    
    print("\n" + "="*60)
    print("🎉 PIPELINE COMPLETE!")
    print("="*60)
    print("\nNext steps:")
    print("1. Test real-time translator: python run.py --mode run")
    print("2. Launch web interface: python run.py --mode web")
    print("3. Export to TFLite (optional): Run export_to_tflite() from trainer")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Run SSL pipeline for Kaggle dataset')
    parser.add_argument('--steps', nargs='+', default=['extract', 'train'],
                       choices=['extract', 'train'],
                       help='Pipeline steps to run')
    parser.add_argument('--max_videos', type=int, default=None,
                       help='Maximum videos per category (for testing)')
    parser.add_argument('--sample_ratio', type=float, default=1.0,
                       help='Sample ratio for testing (0-1)')
    
    args = parser.parse_args()
    
    run_pipeline(
        steps=args.steps,
        max_videos_per_category=args.max_videos,
        sample_ratio=args.sample_ratio
    )