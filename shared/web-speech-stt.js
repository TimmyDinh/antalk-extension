/**
 * Web Speech API STT Module (Extension version)
 * Same interface as SonioxSTT for drop-in swap.
 * Adapted from AnTalk — uses globalThis, simplified restart.
 */
class WebSpeechSTT {
  constructor() {
    this.recognition = null;
    this.isRunning = false;

    // Callbacks (same as SonioxSTT)
    this.onPartial = null;
    this.onFinal = null;
    this.onError = null;
    this.onStatusChange = null;

    // State
    this._finalText = '';
    this._restartCount = 0;
    this._lastResultTime = 0;
  }

  static LANG_MAP = {
    'en': 'en-US', 'vi': 'vi-VN', 'ja': 'ja-JP', 'ko': 'ko-KR',
    'zh': 'zh-CN', 'fr': 'fr-FR', 'es': 'es-ES', 'th': 'th-TH'
  };

  static isSupported() {
    return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  }

  async start(apiKey, languages = 'en', enableLangId = false) {
    if (this.isRunning) return;

    const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const msg = 'Web Speech API not supported. Try Chrome or Edge.';
      if (this.onError) this.onError(msg);
      throw new Error(msg);
    }

    this._setStatus('Starting speech recognition...');

    const lang = Array.isArray(languages) ? languages[0] : languages;
    const bcp47 = WebSpeechSTT.LANG_MAP[lang] || lang;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = bcp47;
    this.recognition.maxAlternatives = 1;

    this._finalText = '';
    this._restartCount = 0;
    this._lastResultTime = Date.now();

    this._wireEvents();

    try {
      this.recognition.start();
      this.isRunning = true;
      this._setStatus('Listening...');
    } catch (err) {
      this.isRunning = false;
      const message = err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone in browser settings.'
        : `Failed to start: ${err.message}`;
      if (this.onError) this.onError(message);
      throw err;
    }
  }

  stop() {
    this.isRunning = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
      this.recognition = null;
    }
    this._setStatus('');
  }

  getFullText() {
    return this._finalText;
  }

  _wireEvents() {
    const rec = this.recognition;

    rec.onresult = (event) => {
      this._lastResultTime = Date.now();
      this._restartCount = 0;

      let interimTranscript = '';
      let newFinalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinalText += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (newFinalText) {
        const trimmed = newFinalText.trim();
        if (trimmed) {
          const needsPunctuation = !/[.!?]$/.test(trimmed);
          const separator = this._finalText ? '\n' : '';
          this._finalText += separator + trimmed + (needsPunctuation ? '.' : '');
        }
        if (this.onFinal) this.onFinal(this._finalText, null);
      }

      if (interimTranscript && this.onPartial) {
        this.onPartial(this._finalText + interimTranscript, null);
      }
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      let msg;
      switch (event.error) {
        case 'not-allowed':
          msg = 'Microphone access denied.';
          break;
        case 'network':
          msg = 'Network error. Check your internet connection.';
          break;
        default:
          msg = `Speech recognition error: ${event.error}`;
      }

      if (this.onError) this.onError(msg);
      this.isRunning = false;
    };

    rec.onend = () => {
      if (!this.isRunning) return;

      const timeSinceResult = Date.now() - this._lastResultTime;
      this._restartCount++;

      if (this._restartCount > 10 && timeSinceResult > 30000) {
        if (this.onError) this.onError('Speech recognition stopped responding. Please try again.');
        this.isRunning = false;
        return;
      }

      const delay = Math.min(300 * this._restartCount, 2000);
      setTimeout(() => {
        if (this.isRunning && this.recognition) {
          try { this.recognition.start(); } catch (e) {}
        }
      }, delay);
    };
  }

  _setStatus(status) {
    if (this.onStatusChange) this.onStatusChange(status);
  }
}
