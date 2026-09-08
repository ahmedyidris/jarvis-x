#!/usr/bin/env python3
import sys

folder_id = "YOUR_FOLDER_ID_HERE"

if folder_id == "YOUR_FOLDER_ID_HERE":
    print("⚠ Update DRIVE_FOLDER_ID in code/drive-voice-sync.py")
    print("Steps:")
    print("  1. Create 'Jarvis X - Voice Training' folder on Google Drive")
    print("  2. Get folder ID from URL")
    print("  3. Replace YOUR_FOLDER_ID_HERE with actual ID")
    sys.exit(1)

print(f"✓ Drive folder configured: {folder_id}")
print(f"✓ Download link: https://drive.google.com/drive/folders/{folder_id}")
