from flask import Flask, render_template, Response
from flask_socketio import SocketIO, emit
import cv2
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from real_time_translator import RealTimeTranslator

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize translator
translator = None

def generate_frames():
    """Generate video frames for streaming."""
    global translator
    
    cap = cv2.VideoCapture(0)
    
    while True:
        success, frame = cap.read()
        if not success:
            break
        
        processed_frame, prediction, confidence = translator.process_frame(frame)
        
        # Encode frame
        ret, buffer = cv2.imencode('.jpg', processed_frame)
        frame_bytes = buffer.tobytes()
        
        # Send translation update via WebSocket
        translated_text = translator.get_translated_text()
        socketio.emit('translation_update', {
            'text': translated_text,
            'current_prediction': prediction,
            'confidence': confidence
        })
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    
    cap.release()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    global translator
    if translator is None:
        translator = RealTimeTranslator()
    return Response(generate_frames(),
                   mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio.on('clear_sentence')
def handle_clear():
    if translator:
        translator.sentence = []
        emit('translation_update', {'text': ''})

@socketio.on('reset_model')
def handle_reset():
    global translator
    translator = RealTimeTranslator()
    emit('status', {'message': 'Model reloaded successfully'})

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)