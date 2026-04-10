/**
 * AnTalk Extension — Settings Page
 */
(function () {
  'use strict';

  // Close button
  document.getElementById('close-btn').addEventListener('click', () => {
    // Try multiple close methods
    try { chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.remove(tab.id); }); } catch (e) {}
    try { window.close(); } catch (e) {}
    // Fallback: go back
    try { history.back(); } catch (e) {}
  });

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

  const engineSel = document.getElementById('engine');
  const sonioxKey = document.getElementById('soniox-key');
  const sourceLangSel = document.getElementById('source-lang');
  const targetLangSel = document.getElementById('target-lang');
  const ttsEnabledSel = document.getElementById('tts-enabled');
  const ttsSpeedSlider = document.getElementById('tts-speed');
  const speedVal = document.getElementById('speed-val');
  const saveBtn = document.getElementById('save-btn');
  const savedMsg = document.getElementById('saved-msg');

  // Populate language dropdowns
  LANGUAGES.forEach(lang => {
    sourceLangSel.add(new Option(lang.label, lang.code));
    targetLangSel.add(new Option(lang.label, lang.code));
  });

  // Load settings
  chrome.storage.local.get(
    ['sttEngine', 'sonioxApiKey', 'sourceLang', 'targetLang', 'ttsEnabled', 'ttsSpeed'],
    (data) => {
      engineSel.value = data.sttEngine || 'free';
      sonioxKey.value = data.sonioxApiKey || '';
      sourceLangSel.value = data.sourceLang || 'en';
      targetLangSel.value = data.targetLang || 'vi';
      ttsEnabledSel.value = data.ttsEnabled !== false ? 'true' : 'false';
      ttsSpeedSlider.value = data.ttsSpeed || 1.0;
      speedVal.textContent = ttsSpeedSlider.value;
    }
  );

  // Speed slider
  ttsSpeedSlider.addEventListener('input', () => {
    speedVal.textContent = ttsSpeedSlider.value;
  });

  // Save
  saveBtn.addEventListener('click', () => {
    const settings = {
      sttEngine: engineSel.value,
      sonioxApiKey: sonioxKey.value.trim(),
      sourceLang: sourceLangSel.value,
      targetLang: targetLangSel.value,
      ttsEnabled: ttsEnabledSel.value === 'true',
      ttsSpeed: parseFloat(ttsSpeedSlider.value)
    };

    // Save to both sync (for popup/offscreen) and local (for content script)
    chrome.storage.local.set(settings);
    chrome.storage.local.set(settings, () => {
      savedMsg.classList.add('show');
      setTimeout(() => savedMsg.classList.remove('show'), 2000);

      // Notify running session
      chrome.runtime.sendMessage({
        type: 'SETTINGS_CHANGED',
        ...settings
      });
    });
  });
})();
