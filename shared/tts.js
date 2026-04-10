/**
 * TTS Module (Extension version)
 * Adapted from AnTalk — removed iOS workarounds, kept core functionality.
 * This module runs in the content script (needs visible page for SpeechSynthesis).
 */
class TTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this.enabled = true;
    this.speed = 1.0;
    this.voices = [];
    this.preferredVoice = null;
    this._loadVoices();

    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this._loadVoices();
    }
  }

  _loadVoices() {
    this.voices = this.synth.getVoices();
  }

  getVoice(langCode) {
    if (!this.voices.length) this._loadVoices();

    let voice = this.voices.find(v => v.lang.startsWith(langCode));

    const langMap = {
      'zh': ['zh-CN', 'zh-TW', 'zh-HK', 'cmn'],
      'vi': ['vi-VN', 'vi'],
      'ja': ['ja-JP', 'ja'],
      'ko': ['ko-KR', 'ko'],
      'en': ['en-US', 'en-GB', 'en'],
      'fr': ['fr-FR', 'fr'],
      'es': ['es-ES', 'es-MX', 'es'],
      'th': ['th-TH', 'th']
    };

    if (!voice && langMap[langCode]) {
      for (const code of langMap[langCode]) {
        voice = this.voices.find(v => v.lang.startsWith(code));
        if (voice) break;
      }
    }

    return voice || null;
  }

  getVoicesForLang(langCode) {
    if (!this.voices.length) this._loadVoices();
    const langMap = {
      'zh': ['zh-CN', 'zh-TW', 'zh-HK', 'cmn'],
      'vi': ['vi-VN', 'vi'],
      'ja': ['ja-JP', 'ja'],
      'ko': ['ko-KR', 'ko'],
      'en': ['en-US', 'en-GB', 'en'],
      'fr': ['fr-FR', 'fr'],
      'es': ['es-ES', 'es-MX', 'es'],
      'th': ['th-TH', 'th']
    };
    const codes = langMap[langCode] || [langCode];
    return this.voices.filter(v => codes.some(c => v.lang.startsWith(c)));
  }

  speak(text, langCode) {
    if (!this.enabled || !text || !text.trim()) return;
    if (!this.voices.length) this._loadVoices();

    this.synth.cancel();

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.rate = this.speed;
      utterance.lang = langCode;
      utterance.volume = 1;

      let voice = null;
      if (this.preferredVoice) {
        voice = this.voices.find(v => v.name === this.preferredVoice);
      }
      if (!voice) {
        voice = this.getVoice(langCode);
      }
      if (voice) utterance.voice = voice;

      utterance.onerror = (e) => {
        console.warn('TTS error:', e.error);
      };

      this.synth.speak(utterance);
    };

    setTimeout(doSpeak, 50);
  }

  stop() {
    this.synth.cancel();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  setSpeed(speed) {
    this.speed = speed;
  }
}
