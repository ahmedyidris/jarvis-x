"""Segment long recording into 5-10 sec speech clips for Tortoise training"""
import librosa
import soundfile as sf
import os
import numpy as np

def segment_recording(input_file, output_dir, clip_duration=7.0):
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found")
        return 0
    
    print(f"[Segmenting] Loading: {input_file}")
    y, sr = librosa.load(input_file, sr=16000)
    print(f"[Segmenting] Duration: {len(y)/sr:.1f}s at {sr}Hz")
    
    clip_samples = int(clip_duration * sr)
    clips = []
    
    for i in range(0, len(y) - clip_samples, clip_samples // 2):
        clip = y[i:i+clip_samples]
        if len(clip) == clip_samples and np.mean(np.abs(clip)) > 0.001:
            clips.append(clip)
    
    os.makedirs(output_dir, exist_ok=True)
    for i, clip in enumerate(clips):
        filename = f"{output_dir}/segment-{i:03d}.wav"
        sf.write(filename, clip, sr)
        print(f"  ✓ segment-{i:03d}.wav ({len(clip)/sr:.1f}s)")
    
    print(f"[Segmenting] Extracted {len(clips)} clips")
    return len(clips)

if __name__ == '__main__':
    input_file = 'voices/my-voice/raw-clips/your-voice-raw.wav'
    output_dir = 'voices/my-voice/segments'
    segment_recording(input_file, output_dir)
