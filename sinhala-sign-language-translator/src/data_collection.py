import cv2
import numpy as np
import os
import mediapipe as mp
from utils import extract_keypoints, mp_holistic

class DataCollector:
    """
    Tool for collecting Sinhala Sign Language training data.
    Captures sequences of keypoints for each sign.
    """
    
    def __init__(self, data_path='../data/raw'):
        self.data_path = data_path
        os.makedirs(data_path, exist_ok=True)
        self.mp_holistic = mp.solutions.holistic
        self.holistic = self.mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5)
        
        # Define Sinhala sign categories (extend as needed)
        self.actions = np.array(['හලෝ (Hello)', 'ස්තුතියි (Thank You)', 'ආයුබෝවන් (Welcome)', 
                                 'ඔව් (Yes)', 'නැත (No)', 'කොහොමද (How Are You)'])
        
    def collect_sequences(self, sequences_per_action=30, sequence_length=30):
        """
        Collect landmark sequences for each action.
        
        Args:
            sequences_per_action: Number of sequences to collect per sign
            sequence_length: Number of frames per sequence
        """
        cap = cv2.VideoCapture(0)
        
        for action_idx, action in enumerate(self.actions):
            print(f"\n=== Collecting data for: {action} ===")
            print(f"Press 'Space' to start recording sequence")
            print(f"Press 'Q' to skip this action")
            
            action_path = os.path.join(self.data_path, action)
            os.makedirs(action_path, exist_ok=True)
            
            sequence_count = 0
            recording = False
            frame_buffer = []
            
            while sequence_count < sequences_per_action:
                ret, frame = cap.read()
                if not ret:
                    break
                    
                frame = cv2.flip(frame, 1)
                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = self.holistic.process(image)
                image.flags.writeable = True
                image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
                
                # Display status
                status = f"Collecting: {action} | Sequence: {sequence_count+1}/{sequences_per_action}"
                if recording:
                    status = f"RECORDING: {len(frame_buffer)}/{sequence_length} frames"
                
                cv2.putText(image, status, (10, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0) if recording else (255, 255, 255), 2)
                
                # Draw landmarks
                if results.pose_landmarks:
                    mp.solutions.drawing_utils.draw_landmarks(
                        image, results.pose_landmarks, self.mp_holistic.POSE_CONNECTIONS)
                if results.left_hand_landmarks:
                    mp.solutions.drawing_utils.draw_landmarks(
                        image, results.left_hand_landmarks, self.mp_holistic.HAND_CONNECTIONS)
                if results.right_hand_landmarks:
                    mp.solutions.drawing_utils.draw_landmarks(
                        image, results.right_hand_landmarks, self.mp_holistic.HAND_CONNECTIONS)
                
                # Collect keypoints if recording
                if recording:
                    keypoints = extract_keypoints(results)
                    frame_buffer.append(keypoints)
                    
                    if len(frame_buffer) == sequence_length:
                        # Save sequence
                        sequence_path = os.path.join(action_path, f"seq_{sequence_count}.npy")
                        np.save(sequence_path, np.array(frame_buffer))
                        sequence_count += 1
                        recording = False
                        frame_buffer = []
                        print(f"✓ Saved sequence {sequence_count}/{sequences_per_action}")
                
                cv2.imshow('Data Collection', image)
                key = cv2.waitKey(10) & 0xFF
                
                if key == ord(' ') and not recording:
                    recording = True
                    frame_buffer = []
                elif key == ord('q'):
                    recording = False
                    break
                elif key == 27:  # ESC
                    cap.release()
                    cv2.destroyAllWindows()
                    return
                    
            print(f"✓ Completed {action}: {sequence_count} sequences collected")
        
        cap.release()
        cv2.destroyAllWindows()
        print("\n✅ Data collection complete!")

if __name__ == "__main__":
    collector = DataCollector()
    collector.collect_sequences(sequences_per_action=30, sequence_length=30)