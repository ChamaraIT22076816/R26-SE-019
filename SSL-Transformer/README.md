<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&height=250&section=header&text=Sinhala%20to%20Sign%20Language&fontSize=40&animation=fadeIn" />

  # 🤟 Sinhala Audio → Sign Language (SSL) Translator
  
  **Transforming spoken Sinhala into real-time 3D Sign Language animations.**

  [![Python](https://img.shields.io/badge/Python-3.12+-blue?style=for-the-badge&logo=python&logoColor=white)](#)
  [![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](#)
  [![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)](#)
  [![Three.js](https://img.shields.io/badge/Three.js-black?style=for-the-badge&logo=three.js&logoColor=white)](#)
  [![Blender](https://img.shields.io/badge/Blender-EA7600?style=for-the-badge&logo=blender&logoColor=white)](#)
</div>

---

## 🌟 Overview
This project is an end-to-end prototype that translates spoken Sinhala audio into 3D Sinhala Sign Language (SSL) animations. It bridges the communication gap by utilizing state-of-the-art machine learning pipelines and real-time 3D web rendering.

## 🚀 The Pipeline
Our translation engine processes audio in five dynamic stages:
1. **🎤 Whisper ASR:** Converts spoken Sinhala `.wav` files into accurate text transcripts.
2. **🧩 Sinling Tokenizer & POS:** Tokenizes the Sinhala text and identifies grammatical structures (Part of Speech).
3. **🎭 Emotion Detection:** Analyzes the audio using `wav2vec2` to extract the speaker's emotion, setting the tone for the avatar.
4. **🧠 Gloss Mapping:** Maps the processed tokens into exact SSL Glosses (the direct vocabulary of sign language).
5. **✨ 3D Animation:** A custom Three.js web client instantly loads the corresponding skeletal animation `.json` files and renders the sequence on a fully rigged 3D avatar.

## 🛠️ Technology Stack

### **Backend (AI Engine)**
- **Python:** Core processing language.
- **FastAPI:** High-performance async API server.
- **HuggingFace Transformers:** For Whisper ASR & Emotion classification.
- **Sinling:** Specialized NLP toolkit for the Sinhala language.
- **Ngrok:** Secure HTTP tunneling to connect the local frontend to the cloud GPU.

### **Frontend (Web Renderer)**
- **HTML5 / CSS3 / Vanilla JS:** Zero-build, lightning-fast static client deployable on Vercel.
- **Three.js:** Real-time WebGL rendering of the 3D scene.
- **FBXLoader:** Parses and loads the custom-rigged character model.

### **Animation Pipeline**
- **Blender:** Used to manually pose the sign language gestures.
- **Python (bpy):** Custom Blender scripts export precise bone quaternion rotations to JSON formats avoiding gimbal lock.

## ⚙️ How to Run

### 1. Start the Backend (Google Colab)
1. Copy the code in `colab_backend.py` to a Google Colab notebook. 
2. Ensure you have a GPU instance (T4) running.
3. Run the notebook to install dependencies, load the models, and start the FastAPI server. 
4. It will print a public **ngrok** `https://` URL.

### 2. Start the Frontend 
Serve the directory containing your `index.html` (formerly `ssl_renderer.html`), `character.fbx`, and `signs/` folder.
If running locally:
```bash
python -m http.server 8080
```
Open `http://localhost:8080` in your browser. *(Or deploy directly to Vercel!)*

### 3. Connect & Translate
- Paste the **ngrok URL** into the backend API input on the web app.
- Click **Connect**.
- Upload a Sinhala `.wav` file.
- Click **Translate** and watch the avatar perform the signs!

---
<div align="center">
  <i>Built for IT4010 — R26-SE-019</i>
</div>
