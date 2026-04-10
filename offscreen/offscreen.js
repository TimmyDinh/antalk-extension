/**
 * AnTalk Extension — Offscreen Document
 * Handles audio capture, STT processing, and translation.
 * Runs in background — no visible UI.
 */
(function () {
  'use strict';

  let stt = null;
  let translator = new Translator();
  let config = {
    sourceLang: 'en',
    targetLang: 'vi',
    engine: 'free'
  };

  // ─── Message Handling ───
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'START_STT':
        handleStart(msg);
        sendResponse({ ok: true });
        break;

      case 'STOP_STT':
        handleStop();
        sendResponse({ ok: true });
        break;

      case 'UPDATE_CONFIG':
        if (msg.sourceLang) config.sourceLang = msg.sourceLang;
        if (msg.targetLang) config.targetLang = msg.targetLang;
        sendResponse({ ok: true });
        break;
    }
    return true;
  });

  // ─── Start STT ───
  async function handleStart(msg) {
    handleStop(); // Stop any existing session

    config.sourceLang = msg.sourceLang || 'en';
    config.targetLang = msg.targetLang || 'vi';
    config.engine = msg.engine || 'free';

    sendStatus('Starting...');

    try {
      if (msg.mode === 'SYSTEM') {
        // Tab audio capture — requires Soniox
        await startSystemMode(msg.streamId, msg);
      } else if (msg.engine === 'soniox') {
        // MIC + Soniox
        await startMicSoniox(msg);
      } else {
        // MIC + Free (Web Speech)
        await startMicFree(msg);
      }
    } catch (err) {
      sendError(err.message || 'Failed to start');
    }
  }

  // ─── SYSTEM Mode (Tab Audio → Soniox) ───
  async function startSystemMode(streamId, msg) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // API key passed directly from service worker (no storage access needed)
    const apiKey = msg.apiKey;
    if (!apiKey) {
      sendError('Soniox API key required. Set it in Settings.');
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    stt = new SonioxSTT();
    setupSTTCallbacks(stt);

    const languages = [config.sourceLang, config.targetLang];
    await stt.startWithStream(apiKey, stream, languages, true);
  }

  // ─── MIC + Soniox ───
  async function startMicSoniox(msg) {
    const apiKey = msg.apiKey;
    if (!apiKey) {
      sendError('Soniox API key required. Set it in Settings.');
      return;
    }

    stt = new SonioxSTT();
    setupSTTCallbacks(stt);

    const languages = [config.sourceLang, config.targetLang];
    await stt.start(apiKey, languages, true);
  }

  // ─── MIC + Free (Web Speech API) ───
  async function startMicFree(msg) {
    if (!WebSpeechSTT.isSupported()) {
      sendError('Web Speech API not supported in this context.');
      return;
    }

    stt = new WebSpeechSTT();
    setupSTTCallbacks(stt);

    await stt.start(null, config.sourceLang, false);
  }

  // ─── Wire STT Callbacks ───
  function setupSTTCallbacks(sttInstance) {
    sttInstance.onPartial = (text, detectedLang) => {
      forward({ type: 'STT_PARTIAL', text });
    };

    sttInstance.onFinal = (text, detectedLang) => {
      forward({ type: 'STT_FINAL', text, lang: detectedLang });

      // Translate the latest sentence (not the full accumulated text)
      const lastSentence = extractLastSentence(text);
      if (lastSentence) {
        translateAndForward(lastSentence, detectedLang);
      }
    };

    sttInstance.onError = (err) => {
      sendError(err);
    };

    sttInstance.onStatusChange = (status) => {
      sendStatus(status);
    };
  }

  // ─── Translation ───
  async function translateAndForward(text, detectedLang) {
    let fromLang = config.sourceLang;
    let toLang = config.targetLang;

    // If language was detected and it matches the target, swap
    if (detectedLang) {
      const detectedShort = detectedLang.substring(0, 2).toLowerCase();
      if (detectedShort === config.targetLang) {
        fromLang = config.targetLang;
        toLang = config.sourceLang;
      } else {
        fromLang = detectedShort;
      }
    }

    try {
      const translated = await translator.translate(text, fromLang, toLang);
      if (translated) {
        forward({
          type: 'TRANSLATION',
          original: text,
          translated,
          sourceLang: fromLang,
          targetLang: toLang,
          speaker: 'Speaker 1'
        });
      }
    } catch (err) {
      sendError(`Translation error: ${err.message}`);
    }
  }

  /**
   * Extract the last sentence/segment from accumulated text
   */
  function extractLastSentence(fullText) {
    if (!fullText) return '';
    const lines = fullText.split('\n').filter(l => l.trim());
    return lines[lines.length - 1] || fullText;
  }

  // ─── Stop ───
  function handleStop() {
    if (stt) {
      stt.stop();
      stt = null;
    }
  }

  // ─── Messaging helpers ───
  function forward(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (e) {}
  }

  function sendStatus(status) {
    forward({ type: 'STATUS', status });
  }

  function sendError(message) {
    forward({ type: 'ERROR', message });
  }
})();
