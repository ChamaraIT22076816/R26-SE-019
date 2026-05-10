const socket = io();

// DOM elements
const videoFeed = document.getElementById('videoFeed');
const translatedText = document.getElementById('translatedText');
const currentPrediction = document.getElementById('currentPrediction');
const confidenceSpan = document.getElementById('confidence');
const clearBtn = document.getElementById('clearBtn');
const resetBtn = document.getElementById('resetBtn');

// Listen for translation updates from server
socket.on('translation_update', (data) => {
    if (data.text) {
        translatedText.textContent = data.text;
    }
    
    if (data.current_prediction) {
        currentPrediction.textContent = `Current Sign: ${data.current_prediction}`;
    }
    
    if (data.confidence) {
        confidenceSpan.textContent = `Confidence: ${(data.confidence * 100).toFixed(1)}%`;
    }
});

// Clear sentence
clearBtn.addEventListener('click', () => {
    socket.emit('clear_sentence');
    translatedText.textContent = '';
    currentPrediction.textContent = 'Current Sign: —';
    confidenceSpan.textContent = 'Confidence: 0%';
});

// Reset model
resetBtn.addEventListener('click', () => {
    socket.emit('reset_model');
    showToast('Model reset successfully!', 'success');
});

// Toast notification function
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : '#2196F3'};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Add animation style
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Handle connection status
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showToast('Connection lost! Please refresh the page.', 'error');
});

socket.on('status', (data) => {
    showToast(data.message, 'success');
});