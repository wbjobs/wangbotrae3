Audio Classifier ONNX Model
===========================

This directory should contain the pre-trained ONNX model file: `audio_classifier.onnx`

Expected Model Specifications:
------------------------------
- Input shape: [batch_size, 1, 128, 63]
  - batch_size: variable (use 1 for single inference)
  - 1: single channel (mono)
  - 128: number of Mel frequency bins (N_MELS)
  - 63: time frames for a 2-second audio clip at 16kHz

- Output shape: [batch_size, 5]
  - 5 class probabilities (softmax output):
    - Index 0: glass_break
    - Index 1: dog_bark
    - Index 2: knock
    - Index 3: car_horn
    - Index 4: baby_cry

Quick Setup:
------------
1. Place your trained `audio_classifier.onnx` file in this directory
   OR
2. Run `python create_dummy_model.py` to generate a dummy model for testing

The dummy model has the correct input/output shapes but random weights.
It will produce valid but meaningless predictions for testing the API.
