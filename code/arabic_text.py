"""Arabic TTS text prep for Chatterbox-Egyptian.

The model reads Arabic script with Egyptian phonology, so "جارفيس" correctly
becomes "garfees". English names must stay in Latin script to be pronounced
as English. This module reverses common transliterations before synthesis.
"""
import re

# Arabic transliteration -> Latin. Extend as needed.
LATIN_NAMES = {
    "جارفيس": "Jarvis",
    "جيرس ناكس": "Jarvis X",
    "جارفيس إكس": "Jarvis X",
    "جارفس": "Jarvis",
    "جيرفس": "Jarvis",
    "جيرفيس": "Jarvis",
    "چارفيس": "Jarvis",
    "أحمد إدريس": "Ahmed Idris",
    "جوجل": "Google",
    "جيميل": "Gmail",
    "يوتيوب": "YouTube",
    "واتساب": "WhatsApp",
    "أندرويد": "Android",
    "ويندوز": "Windows",
    "لينكس": "Linux",
    "كروم": "Chrome",
    "بايثون": "Python",
    "دوكر": "Docker",
    "جيت هاب": "GitHub",
}


def prepare(text: str) -> str:
    """Restore Latin spelling for names the model would otherwise Arabize."""
    for ar, latin in LATIN_NAMES.items():
        text = text.replace(ar, latin)
    # strip emoji and symbols the vocoder would try to vocalize
    text = re.sub(r"[\U0001F000-\U0001FAFF\U00002600-\U000027BF\uFE0F]", "", text)
    return re.sub(r"\s+", " ", text).strip()
