const i18next = require('i18next');

const resources = {
  en: {
    translation: {
      'submit': 'Submit',
      'query': 'Enter your query',
      'result': 'Result',
      'error': 'An error occurred',
      'loading': 'Loading...',
      'market': 'Market Brief',
      'crypto': 'Crypto Tracker',
      'news': 'News Digest',
      'settings': 'Settings',
      'language': 'Language',
      'accessibility': 'Accessibility',
      'captions_on': 'Captions On',
      'screen_reader': 'Screen Reader Enabled',
      'keyboard_help': 'Press ? for help'
    }
  },
  ar: {
    translation: {
      'submit': 'إرسال',
      'query': 'أدخل استفسارك',
      'result': 'النتيجة',
      'error': 'حدث خطأ',
      'loading': 'جاري التحميل...',
      'market': 'ملخص السوق',
      'crypto': 'متتبع العملات المشفرة',
      'news': 'ملخص الأخبار',
      'settings': 'الإعدادات',
      'language': 'اللغة',
      'accessibility': 'إمكانية الوصول',
      'captions_on': 'الترجمة قيد التشغيل',
      'screen_reader': 'قارئ الشاشة مفعل',
      'keyboard_help': 'اضغط ? للمساعدة'
    }
  }
};

i18next.init({
  interpolation: { escapeValue: false },
  lng: navigator?.language?.split('-')[0] || 'en',
  fallbackLng: 'en',
  resources
});

module.exports = i18next;
