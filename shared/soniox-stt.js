/**
 * Soniox Real-time STT Module (Extension version)
 * Adapted from AnTalk — adds startWithStream() for tab audio capture.
 */
class SonioxSTT {
  constructor() {
    this.ws = null;
    this.mediaRecorder = null;
    this.stream = null;
    this.isRunning = false;

    // Callbacks
    this.onPartial = null;    // (text, detectedLang) => {}
    this.onFinal = null;      // (text, detectedLang) => {}
    this.onError = null;      // (error) => {}
    this.onStatusChange = null; // (status) => {}

    // State
    this._finalText = '';
    this._partialText = '';
    this._detectedLang = null;
  }

  /**
   * Start with microphone (same as original AnTalk)
   */
  async start(apiKey, languages = 'en', enableLangId = false) {
    if (this.isRunning) return;

    try {
      this._setStatus('Requesting microphone...');

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      await this._startWithStream(apiKey, this.stream, languages, enableLangId);
    } catch (err) {
      this.stop();
      const message = err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone in browser settings.'
        : `Failed to start: ${err.message}`;
      if (this.onError) this.onError(message);
      throw err;
    }
  }

  /**
   * Start with an externally-provided MediaStream (e.g., from tabCapture)
   */
  async startWithStream(apiKey, stream, languages = 'en', enableLangId = false) {
    if (this.isRunning) return;

    try {
      this.stream = stream;
      await this._startWithStream(apiKey, stream, languages, enableLangId);
    } catch (err) {
      this.stop();
      if (this.onError) this.onError(`Failed to start: ${err.message}`);
      throw err;
    }
  }

  /**
   * Internal: connect WS and start recording from any stream
   */
  async _startWithStream(apiKey, stream, languages, enableLangId) {
    this._setStatus('Connecting to Soniox...');

    await this._connectWebSocket(apiKey, languages, enableLangId);
    this._startMediaRecorder(stream);

    this.isRunning = true;
    this._finalText = '';
    this._partialText = '';
    this._detectedLang = null;
    this._setStatus('Listening...');
  }

  stop() {
    this.isRunning = false;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(new ArrayBuffer(0));
      } catch (e) {}
      this.ws.close();
    }
    this.ws = null;

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this._setStatus('');
  }

  getFullText() {
    return this._finalText;
  }

  // --- Private ---

  _connectWebSocket(apiKey, languages, enableLangId) {
    return new Promise((resolve, reject) => {
      const wsUrl = 'wss://stt-rt.soniox.com/transcribe-websocket';
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        const langArray = Array.isArray(languages) ? languages : [languages];

        const config = {
          api_key: apiKey,
          model: 'stt-rt-preview',
          audio_format: 'auto',
          language_hints: langArray,
          enable_endpoint_detection: true
        };

        if (enableLangId) {
          config.enable_language_identification = true;
        }

        this.ws.send(JSON.stringify(config));
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket connection failed. Check API key and balance.'));
      };

      this.ws.onclose = () => {
        if (this.isRunning) {
          this.isRunning = false;
          if (this.onError) this.onError('Connection closed unexpectedly');
        }
      };

      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  _startMediaRecorder(stream) {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 16000
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        event.data.arrayBuffer().then(buffer => {
          this.ws.send(buffer);
        });
      }
    };

    this.mediaRecorder.start(250);
  }

  _handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      if (msg.error_code || msg.error_message) {
        if (this.onError) {
          this.onError(msg.error_message || `Error ${msg.error_code}`);
        }
        this.stop();
        return;
      }

      if (msg.finished) return;

      if (msg.tokens && msg.tokens.length > 0) {
        let newFinal = '';
        let newPartial = '';
        let detectedLang = null;

        for (const token of msg.tokens) {
          if (token.language) detectedLang = token.language;

          let tokenText = token.text;
          if (tokenText && tokenText.replace(/\s/g, '').toLowerCase() === '<end>') {
            continue;
          }

          if (token.is_final) {
            newFinal += tokenText;
          } else {
            newPartial += tokenText;
          }
        }

        if (detectedLang) this._detectedLang = detectedLang;

        if (newFinal) {
          this._finalText += newFinal;
          if (this.onFinal) this.onFinal(this._finalText, this._detectedLang);
        }

        this._partialText = newPartial;
        if (this.onPartial) {
          this.onPartial(this._finalText + newPartial, this._detectedLang);
        }
      }
    } catch (err) {
      console.error('Error parsing Soniox message:', err);
    }
  }

  _setStatus(status) {
    if (this.onStatusChange) this.onStatusChange(status);
  }
}
