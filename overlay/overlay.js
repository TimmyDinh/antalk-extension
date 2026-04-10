/**
 * AnTalk Extension — Overlay (runs inside iframe)
 * Dual-panel layout: Heard (source) | Translation (target)
 */
(function () {
  'use strict';

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'zh', label: '中文' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'th', label: 'ไทย' }
  ];

  let ttsEnabled = false;
  let entries = [];
  let sourceLangCode = 'vi';
  let targetLangCode = 'en';

  // DOM
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('status-text');
  const systemBtn = document.getElementById('system-btn');
  const micBtn = document.getElementById('mic-btn');
  const ttsBtn = document.getElementById('tts-btn');
  const sourceContent = document.getElementById('source-content');
  const targetContent = document.getElementById('target-content');
  const sourceHeader = document.getElementById('source-header');
  const targetHeader = document.getElementById('target-header');
  const sourceLang = document.getElementById('source-lang');
  const targetLang = document.getElementById('target-lang');
  const engineLabel = document.getElementById('engine-label');

  // Populate languages
  LANGUAGES.forEach(l => {
    sourceLang.add(new Option(l.label, l.code));
    targetLang.add(new Option(l.label, l.code));
  });
  sourceLang.value = 'vi';
  targetLang.value = 'en';

  // Load settings
  try {
    chrome.storage.local.get(['sourceLang', 'targetLang', 'sttEngine'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data.sourceLang) { sourceLang.value = data.sourceLang; sourceLangCode = data.sourceLang; }
      if (data.targetLang) { targetLang.value = data.targetLang; targetLangCode = data.targetLang; }
      if (data.sttEngine) engineLabel.textContent = data.sttEngine === 'soniox' ? 'Soniox' : 'Free';
      updateHeaders();
    });
  } catch (e) {}

  function updateHeaders() {
    const srcName = LANGUAGES.find(l => l.code === sourceLangCode)?.label || sourceLangCode;
    const tgtName = LANGUAGES.find(l => l.code === targetLangCode)?.label || targetLangCode;
    sourceHeader.textContent = 'HEARD (' + srcName + ')';
    targetHeader.textContent = 'TRANSLATION (' + tgtName + ')';
  }

  // ─── Pinyin Helper ───
  function isChinese(code) { return code === 'zh'; }

  function getPinyin(text) {
    try {
      if (typeof pinyinPro !== 'undefined' && pinyinPro.pinyin) {
        return pinyinPro.pinyin(text, { toneType: 'symbol', type: 'string' });
      }
    } catch (e) {}
    return '';
  }

  function makePinyinEl(text) {
    const py = getPinyin(text);
    if (!py) return null;
    const el = document.createElement('div');
    el.className = 'pinyin';
    el.textContent = py;
    return el;
  }

  // ─── Buttons ───
  document.getElementById('settings-btn').onclick = () => sendMsg({ type: 'OPEN_SETTINGS' });

  systemBtn.onclick = () => {
    setMode('SYSTEM');
    sendMsg({ type: 'SWITCH_MODE', mode: 'SYSTEM' });
  };

  micBtn.onclick = () => {
    setMode('MIC');
    sendMsg({ type: 'SWITCH_MODE', mode: 'MIC' });
  };

  document.getElementById('stop-btn').onclick = () => {
    sendMsg({ type: 'STOP_KEEP_OVERLAY' });
    setStopped();
  };

  ttsBtn.onclick = () => {
    ttsEnabled = !ttsEnabled;
    ttsBtn.classList.toggle('active', ttsEnabled);
  };

  // ─── CC (Subtitle Mode) Button ───
  const ccBtn = document.getElementById('cc-btn');
  let subtitleModeActive = false;

  // Load saved display mode
  try {
    chrome.storage.local.get(['antalkDisplayMode'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data.antalkDisplayMode === 'subtitle') {
        subtitleModeActive = true;
        ccBtn.classList.add('active');
      }
    });
  } catch (e) {}

  ccBtn.onclick = () => {
    subtitleModeActive = !subtitleModeActive;
    ccBtn.classList.toggle('active', subtitleModeActive);
    sendMsg({
      type: 'TOGGLE_DISPLAY_MODE',
      mode: subtitleModeActive ? 'subtitle' : 'panel'
    });
  };

  // Listen for display mode changes (e.g. fallback if no video found)
  // handled in the main onMessage listener below

  document.getElementById('clear-btn').onclick = () => clearAll();

  document.getElementById('copy-btn').onclick = () => {
    const text = entries.map(e => e.original + '\n' + e.translated).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    }).catch(() => {});
  };

  document.getElementById('close-btn').onclick = () => {
    sendMsg({ type: 'STOP' });
    window.parent.postMessage({ antalk: 'HIDE' }, '*');
  };

  document.getElementById('swap-btn').onclick = () => {
    const tmp = sourceLang.value;
    sourceLang.value = targetLang.value;
    targetLang.value = tmp;
    sourceLangCode = sourceLang.value;
    targetLangCode = targetLang.value;
    updateHeaders();
    saveLangs();
  };

  sourceLang.onchange = () => { sourceLangCode = sourceLang.value; updateHeaders(); saveLangs(); };
  targetLang.onchange = () => { targetLangCode = targetLang.value; updateHeaders(); saveLangs(); };

  function saveLangs() {
    try { chrome.storage.local.set({ sourceLang: sourceLang.value, targetLang: targetLang.value }); } catch (e) {}
    sendMsg({ type: 'LANG_CHANGED', sourceLang: sourceLang.value, targetLang: targetLang.value });
  }

  // ─── Drag (tell parent to move wrapper) ───
  const toolbar = document.getElementById('toolbar');
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'SPAN' && e.target.classList.contains('sep')) return;
    // Get the iframe's position in the parent viewport
    const iframeRect = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    const clientXInParent = e.clientX + iframeRect.left;
    const clientYInParent = e.clientY + iframeRect.top;
    window.parent.postMessage({ antalk: 'DRAG_START', clientX: clientXInParent, clientY: clientYInParent }, '*');
  });

  // ─── State ───
  function setMode(mode) {
    systemBtn.classList.toggle('active', mode === 'SYSTEM');
    micBtn.classList.toggle('active', mode === 'MIC');
  }

  function setListening(msg) {
    dot.classList.add('on');
    statusText.textContent = msg || 'Listening';
  }

  function setStopped() {
    dot.classList.remove('on');
    statusText.textContent = 'Stopped';
  }

  // ─── Content Management ───
  function clearAll() {
    entries = [];
    sourceContent.innerHTML = '<div class="placeholder">Waiting for audio...</div>';
    targetContent.innerHTML = '<div class="placeholder">Translation will appear here</div>';
  }

  function addEntry(original, translated) {
    // Remove placeholders
    sourceContent.querySelector('.placeholder')?.remove();
    targetContent.querySelector('.placeholder')?.remove();

    // Add original text to source panel
    const srcEntry = document.createElement('div');
    srcEntry.style.marginBottom = '6px';
    srcEntry.textContent = original;
    // Add pinyin if source is Chinese
    if (isChinese(sourceLangCode)) {
      const py = makePinyinEl(original);
      if (py) srcEntry.appendChild(py);
    }
    sourceContent.appendChild(srcEntry);

    // Add translated text to target panel
    const tgtEntry = document.createElement('div');
    tgtEntry.style.marginBottom = '6px';
    tgtEntry.textContent = translated;
    // Add pinyin if target is Chinese
    if (isChinese(targetLangCode)) {
      const py = makePinyinEl(translated);
      if (py) tgtEntry.appendChild(py);
    }
    targetContent.appendChild(tgtEntry);

    entries.push({ original, translated });

    // Auto-scroll both panels
    sourceContent.scrollTop = sourceContent.scrollHeight;
    targetContent.scrollTop = targetContent.scrollHeight;

    // TTS
    if (ttsEnabled && translated) speakText(translated, targetLangCode);
  }

  function updatePartial(text) {
    sourceContent.querySelector('.placeholder')?.remove();
    let p = sourceContent.querySelector('.partial');
    if (!p) {
      p = document.createElement('div');
      p.className = 'partial';
      sourceContent.appendChild(p);
    }
    // Show only the latest part
    const lines = text.split('\n');
    p.textContent = lines[lines.length - 1] || text;
    sourceContent.scrollTop = sourceContent.scrollHeight;
  }

  function removePartial() {
    const p = sourceContent.querySelector('.partial');
    if (p) p.remove();
  }

  // ─── TTS ───
  function speakText(text, langCode) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode;
    u.rate = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(langCode));
    if (match) u.voice = match;
    window.speechSynthesis.speak(u);
  }

  // ─── Messaging ───
  function sendMsg(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (e) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ ok: true }); return; }

    switch (msg.type) {
      case 'SHOW_OVERLAY':
        if (msg.mode) setMode(msg.mode);
        if (msg.engine) engineLabel.textContent = msg.engine === 'soniox' ? 'Soniox' : 'Free';
        setListening('Listening');
        break;
      case 'HIDE_OVERLAY':
        setStopped();
        window.parent.postMessage({ antalk: 'HIDE' }, '*');
        break;
      case 'STT_PARTIAL':
        updatePartial(msg.text);
        break;
      case 'STT_FINAL':
        removePartial();
        break;
      case 'TRANSLATION':
        removePartial();
        addEntry(msg.original, msg.translated);
        break;
      case 'STATUS':
        statusText.textContent = msg.status;
        break;
      case 'ERROR':
        statusText.textContent = msg.message;
        dot.style.background = '#f44336';
        break;
      case 'DISPLAY_MODE_CHANGED':
        subtitleModeActive = (msg.mode === 'subtitle');
        ccBtn.classList.toggle('active', subtitleModeActive);
        break;
    }
  });
})();
