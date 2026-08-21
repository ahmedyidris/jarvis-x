#!/bin/bash
# Sync voice files with Google Drive

DRIVE_FOLDER_ID="YOUR_FOLDER_ID_HERE"  # Replace with actual ID
LOCAL_DIR="voices/my-voice"

# Download from Drive (if you have specific file)
# gdown "SHARE_LINK" -O "$LOCAL_DIR/recording.m4a"

# Or upload to Drive after training
# gdown --folder "$DRIVE_FOLDER_ID" -O "$LOCAL_DIR"

echo "✓ Sync ready (update DRIVE_FOLDER_ID with your actual folder ID)"
