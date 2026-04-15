/**
 * AnTalk Extension — Service Worker (Background)
 * Central router: manages tabCapture, offscreen document, and message routing.
 */

let activeTabId = null;

// ─── Ensure content script is injected (always re-inject to get latest version) ───
async function ensureContentScript(tabId) {
  // Always inject — this ensures the latest version runs even after extension reload.
  // The content script's guard (checks for existing element) prevents duplicates.
  try {
    console.log('[AnTalk SW] Injecting content script into tab', tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/overlay.js']
    });
    await new Promise(r => setTimeout(r, 400));
  } catch (e) {
    console.warn('[AnTalk SW] Injection failed:', e.message);
    // Try PING as fallback — maybe it's already loaded
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log('[AnTalk SW] Content script was already loaded');
    } catch (e2) {
      console.error('[AnTalk SW] Content script not available');
    }
  }
}

// ─── Send message to content script with retries ───
async function sendToTab(tabId, msg, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      console.log('[AnTalk SW] Message sent to tab:', msg.type);
      return true;
    } catch (e) {
      console.log(`[AnTalk SW] Retry ${i + 1}/${retries} for ${msg.type}`);
      await new Promise(r => setTimeout(r, 400));
    }
  }
  console.error('[AnTalk SW] Failed to send to tab after retries:', msg.type);
  return false;
}

// ─── Offscreen Document Lifecycle ───
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Audio capture and speech recognition for real-time translation'
  });
  // Wait for offscreen to initialize
  await new Promise(r => setTimeout(r, 300));
}

async function closeOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    console.warn('[AnTalk SW] closeOffscreen error:', e);
  }
}

// ─── Message Router ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ignore messages that are meant for other contexts (avoid loops)
  if (msg.type === 'START_STT' || msg.type === 'STOP_STT' || msg.type === 'UPDATE_CONFIG') {
    // These are sent TO the offscreen doc — don't handle in SW
    return false;
  }
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  handleMessage(msg, sender).then(sendResponse).catch(err => {
    console.error('[AnTalk SW]', err);
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'START':
      return handleStart(msg);

    case 'STOP':
      return handleStop(true); // hide overlay

    case 'STOP_KEEP_OVERLAY':
      return handleStop(false); // keep overlay visible

    case 'SWITCH_MODE':
      await handleStop();
      const settings = await chrome.storage.local.get(['sttEngine', 'sourceLang', 'targetLang']);
      return handleStart({
        mode: msg.mode,
        engine: settings.sttEngine || 'free',
        sourceLang: settings.sourceLang || 'en',
        targetLang: settings.targetLang || 'vi',
        tabId: activeTabId
      });

    case 'LANG_CHANGED':
      forwardToOffscreen({
        type: 'UPDATE_CONFIG',
        sourceLang: msg.sourceLang,
        targetLang: msg.targetLang
      });
      return { ok: true };

    case 'OPEN_SETTINGS':
      chrome.runtime.openOptionsPage();
      return { ok: true };

    case 'TOGGLE_DISPLAY_MODE':
      // Forward to content script to switch between panel and subtitle mode
      if (activeTabId) {
        await chrome.tabs.sendMessage(activeTabId, {
          type: 'SET_DISPLAY_MODE',
          mode: msg.mode
        });
        chrome.storage.local.set({ antalkDisplayMode: msg.mode });
      }
      return { ok: true };

    // ─── Forward from offscreen → content script ───
    case 'STT_PARTIAL':
    case 'STT_FINAL':
    case 'TRANSLATION':
    case 'STATUS':
    case 'ERROR':
    case 'DISPLAY_MODE_CHANGED':
      if (activeTabId) {
        try {
          await chrome.tabs.sendMessage(activeTabId, msg);
        } catch (e) {
          console.warn('[AnTalk SW] Failed to send to tab:', e.message);
        }
      }
      return { ok: true };

    default:
      return { ok: true };
  }
}

// ─── Send message specifically to offscreen document ───
function forwardToOffscreen(msg) {
  try {
    chrome.runtime.sendMessage(msg);
  } catch (e) {
    console.warn('[AnTalk SW] Failed to send to offscreen:', e);
  }
}

// ─── Start Translation Session ───
async function handleStart(config) {
  activeTabId = config.tabId;
  console.log('[AnTalk SW] Starting:', config.mode, config.engine, 'tab:', config.tabId);

  // Save state (use local storage — session storage not available in content scripts)
  chrome.storage.session.set({ isActive: true, activeTabId });
  chrome.storage.local.set({
    antalkActive: true,
    antalkMode: config.mode,
    antalkEngine: config.mode === 'SYSTEM' ? 'soniox' : config.engine
  });

  // 1. Ensure content script is injected
  await ensureContentScript(config.tabId);

  // 2. Show overlay FIRST so user gets immediate feedback
  const displaySettings = await chrome.storage.local.get(['antalkDisplayMode']);
  await sendToTab(config.tabId, {
    type: 'SHOW_OVERLAY',
    mode: config.mode,
    engine: config.mode === 'SYSTEM' ? 'soniox' : config.engine,
    displayMode: config.displayMode || displaySettings.antalkDisplayMode || 'panel'
  });

  // 3. Read API key from storage (SW has full access)
  let sonioxApiKey = '';
  try {
    const stored = await chrome.storage.local.get(['sonioxApiKey']);
    sonioxApiKey = stored.sonioxApiKey || '';
  } catch (e) {
    console.warn('[AnTalk SW] Could not read API key:', e);
  }

  // 4. Ensure offscreen document exists
  await ensureOffscreen();

  // 5. Start STT — wrapped in try/catch so errors show in overlay
  try {
    if (config.mode === 'SYSTEM') {
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: config.tabId
      });
      console.log('[AnTalk SW] Got streamId for tab capture');

      forwardToOffscreen({
        type: 'START_STT',
        streamId,
        mode: 'SYSTEM',
        engine: 'soniox',
        apiKey: sonioxApiKey,
        sourceLang: config.sourceLang,
        targetLang: config.targetLang
      });
    } else {
      forwardToOffscreen({
        type: 'START_STT',
        mode: 'MIC',
        engine: config.engine,
        apiKey: sonioxApiKey,
        sourceLang: config.sourceLang,
        targetLang: config.targetLang
      });
    }
  } catch (err) {
    console.error('[AnTalk SW] STT start failed:', err);
    // Broadcast error so overlay iframe and content script both receive it
    forwardToOffscreen({ type: 'ERROR', message: 'Failed to start: ' + err.message });
  }

  return { ok: true };
}

// ─── Stop Translation Session ───
async function handleStop(hideOverlay = true) {
  console.log('[AnTalk SW] Stopping session, hideOverlay:', hideOverlay);

  forwardToOffscreen({ type: 'STOP_STT' });

  if (activeTabId && hideOverlay) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'HIDE_OVERLAY' });
    } catch (e) {}
  }

  chrome.storage.session.set({ isActive: false });
  chrome.storage.local.set({ antalkActive: false });
  await closeOffscreen();
  activeTabId = null;

  return { ok: true };
}

// ─── Handle tab closure ───
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    handleStop();
  }
});
