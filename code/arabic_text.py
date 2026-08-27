"""Arabic TTS text prep for Chatterbox-Egyptian."""
import re

LATIN_NAMES = {
    "جارفيس": "Jarvis",
    "جارفيس إكس": "Jarvis X",
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

ARABIC_TO_LATIN = {
    'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'aa', 'ء': "'",
    'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h',
    'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
    'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't',
    'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
    'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
    'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a', 'ئ': "'",
    'ؤ': "'", 'لا': 'la', 'پ': 'p', 'چ': 'ch', 'ژ': 'zh',
    'گ': 'g', 'ڤ': 'v', 'َ': 'a', 'ُ': 'u', 'ِ': 'i',
    'ْ': '', 'ّ': '', 'ً': 'an', 'ٌ': 'un', 'ٍ': 'in',
    'ٰ': 'a', '،': ',', '؟': '?', '؛': ';',
}


def _is_arabic(c):
    code = ord(c)
    return (0x0600 <= code <= 0x06FF or
            0x0750 <= code <= 0x077F or
            0x08A0 <= code <= 0x08FF or
            0xFB50 <= code <= 0xFDFF or
            0xFE70 <= code <= 0xFEFF)


def arabic_to_latin(text):
    result = []
    i = 0
    while i < len(text):
        two = text[i:i+2]
        if two in ARABIC_TO_LATIN:
            result.append(ARABIC_TO_LATIN[two])
            i += 2
        elif text[i] in ARABIC_TO_LATIN:
            result.append(ARABIC_TO_LATIN[text[i]])
            i += 1
        else:
            result.append(text[i])
            i += 1
    return ''.join(result)


def prepare(text):
    for ar, latin in LATIN_NAMES.items():
        text = text.replace(ar, latin)
    text = re.sub(r"[\U0001F000-\U0001FAFF\U00002600-\U000027BF\uFE0F]", "", text)
    if any(_is_arabic(c) for c in text):
        text = arabic_to_latin(text)
    return re.sub(r"\s+", " ", text).strip()
