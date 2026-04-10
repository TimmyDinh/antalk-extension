/**
 * AnTalk Extension — Popup Script
 * Handles Start/Stop, mode selection, and language configuration.
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

  // DOM
  const sourceLangSel = document.getElementById('source-lang');
  const targetLangSel = document.getElementById('target-lang');
  const engineSel = document.getElementById('engine');
  const startBtn = document.getElementById('start-btn');
  const modeHint = document.getElementById('mode-hint');
  const sonioxWarning = document.getElementById('soniox-warning');
  const settingsLink = document.getElementById('settings-link');
  const modeBtns = document.querySelectorAll('[data-mode]');

  let currentMode = 'SYSTEM';
  let isRunning = false;

  // Populate language dropdowns
  LANGUAGES.forEach(lang => {
    sourceLangSel.add(new Option(lang.label, lang.code));
    targetLangSel.add(new Option(lang.label, lang.code));
  });

  // Load saved settings
  chrome.storage.local.get(
    ['sourceLang', 'targetLang', 'sttEngine', 'audioMode'],
    (data) => {
      sourceLangSel.value = data.sourceLang || 'en';
      targetLangSel.value = data.targetLang || 'vi';
      engineSel.value = data.sttEngine || 'free';
      if (data.audioMode) {
        currentMode = data.audioMode;
        updateModeUI();
      }
      checkModeEngineCompat();
    }
  );

  // Check if already running
  chrome.storage.session.get(['isActive'], (data) => {
    if (data.isActive) {
      isRunning = true;
      startBtn.textContent = 'Stop';
      startBtn.classList.add('active');
    }
  });

  // ─── Mode Selection ───
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      updateModeUI();
      checkModeEngineCompat();
      chrome.storage.local.set({ audioMode: currentMode });
    });
  });

  function updateModeUI() {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
    modeHint.textContent = currentMode === 'SYSTEM'
      ? 'Captures audio from the current tab'
      : 'Uses your microphone';
  }

  // ─── Engine Compatibility ───
  engineSel.addEventListener('change', () => {
    chrome.storage.local.set({ sttEngine: engineSel.value });
    checkModeEngineCompat();
  });

  function checkModeEngineCompat() {
    // SYSTEM mode requires Soniox
    if (currentMode === 'SYSTEM' && engineSel.value === 'free') {
      sonioxWarning.style.display = 'block';
      // Auto-switch to Soniox
      engineSel.value = 'soniox';
      chrome.storage.local.set({ sttEngine: 'soniox' });
      setTimeout(() => { sonioxWarning.style.display = 'none'; }, 3000);
    } else {
      sonioxWarning.style.display = 'none';
    }
  }

  // ─── Swap Languages ───
  document.getElementById('swap-btn').addEventListener('click', () => {
    const tmp = sourceLangSel.value;
    sourceLangSel.value = targetLangSel.value;
    targetLangSel.value = tmp;
    chrome.storage.local.set({ sourceLang: sourceLangSel.value, targetLang: targetLangSel.value });
  });

  // ─── Language Changes ───
  sourceLangSel.addEventListener('change', () => {
    chrome.storage.local.set({ sourceLang: sourceLangSel.value });
  });

  targetLangSel.addEventListener('change', () => {
    chrome.storage.local.set({ targetLang: targetLangSel.value });
  });

  // ─── Start / Stop ───
  startBtn.addEventListener('click', async () => {
    if (isRunning) {
      // Stop
      chrome.runtime.sendMessage({ type: 'STOP_KEEP_OVERLAY' });
      isRunning = false;
      startBtn.textContent = 'Start Translating';
      startBtn.classList.remove('active');
      chrome.storage.session.set({ isActive: false });
      return;
    }

    // Start
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const config = {
      type: 'START',
      mode: currentMode,
      engine: engineSel.value,
      sourceLang: sourceLangSel.value,
      targetLang: targetLangSel.value,
      tabId: tab.id
    };

    chrome.runtime.sendMessage(config);
    isRunning = true;
    startBtn.textContent = 'Stop';
    startBtn.classList.add('active');
    chrome.storage.session.set({ isActive: true });

    // Close popup after starting
    setTimeout(() => window.close(), 300);
  });

  // ─── Settings ───
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
