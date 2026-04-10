/**
 * AnTalk Extension — Content Script
 * Injects a draggable, resizable iframe overlay AND a subtitle overlay on videos.
 */
(function () {
  'use strict';

  // If wrapper already exists, just show it and exit
  const existing = document.getElementById('antalk-ext-wrapper');
  if (existing) {
    existing.style.setProperty('display', 'block', 'important');
    console.log('[AnTalk] Wrapper exists, showing it');
    return;
  }

  // ─── State ───
  let subtitleMode = false;
  let videoEl = null;
  let subtitleContainer = null;
  let subtitleOriginal = null;
  let subtitleTranslated = null;
  let resizeObserver = null;
  let mutationObserver = null;
  let clearTimer = null;

  // ─── Create wrapper div (handles drag + resize) — Floating Panel ───
  const wrapper = document.createElement('div');
  wrapper.id = 'antalk-ext-wrapper';
  wrapper.setAttribute('style', [
    'display: none !important',
    'position: fixed !important',
    'bottom: 12px !important',
    'right: 16px !important',
    'width: 700px !important',
    'height: 280px !important',
    'min-width: 400px !important',
    'min-height: 180px !important',
    'max-width: calc(100vw - 20px) !important',
    'max-height: calc(100vh - 20px) !important',
    'z-index: 2147483647 !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: none !important',
    'background: transparent !important',
    'pointer-events: auto !important',
    'opacity: 1 !important',
    'visibility: visible !important',
    'top: auto !important',
    'left: auto !important',
    'transform: none !important',
    'resize: both !important',
    'overflow: hidden !important',
    'border-radius: 12px !important',
    'box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important'
  ].join('; '));

  // ─── Create iframe inside wrapper ───
  const iframe = document.createElement('iframe');
  iframe.id = 'antalk-ext-frame';
  iframe.src = chrome.runtime.getURL('overlay/overlay.html');
  iframe.allow = 'microphone';
  iframe.setAttribute('style', [
    'width: 100% !important',
    'height: 100% !important',
    'border: none !important',
    'border-radius: 12px !important',
    'display: block !important',
    'margin: 0 !important',
    'padding: 0 !important'
  ].join('; '));

  wrapper.appendChild(iframe);
  document.documentElement.appendChild(wrapper);
  console.log('[AnTalk] iframe wrapper injected');

  // ═══════════════════════════════════════════════════════════════
  // ─── Subtitle Mode — Video Detection & Overlay ───
  // ═══════════════════════════════════════════════════════════════

  function findPrimaryVideo() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    let best = null;
    let bestScore = 0;

    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      const visible = rect.width > 0 && rect.height > 0;

      let score = area;
      if (!v.paused) score += 1000000;
      if (visible) score += 500000;

      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  function findVideoContainer(video) {
    // Walk up to find a positioned container or the video's parent
    let el = video.parentElement;
    while (el && el !== document.body) {
      const pos = getComputedStyle(el).position;
      if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') {
        return el;
      }
      el = el.parentElement;
    }
    // Fallback: make the video's direct parent relative
    const parent = video.parentElement;
    if (parent) {
      parent.style.setProperty('position', 'relative', 'important');
    }
    return parent;
  }

  function createSubtitleDOM() {
    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'antalk-subtitle-container';
    subtitleContainer.setAttribute('style', [
      'position: absolute !important',
      'bottom: 10% !important',
      'left: 50% !important',
      'transform: translateX(-50%) !important',
      'width: auto !important',
      'max-width: 80% !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important',
      'padding: 8px 20px !important',
      'background: rgba(0, 0, 0, 0.75) !important',
      'border-radius: 6px !important',
      'text-align: center !important',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
      'line-height: normal !important',
      'box-sizing: border-box !important',
      'display: none !important',
      'transition: opacity 0.3s ease !important',
      'opacity: 1 !important'
    ].join('; '));

    subtitleOriginal = document.createElement('div');
    subtitleOriginal.id = 'antalk-subtitle-original';
    subtitleOriginal.setAttribute('style', [
      'font-size: 13px !important',
      'color: rgba(255, 255, 255, 0.55) !important',
      'line-height: 1.4 !important',
      'margin-bottom: 2px !important',
      'white-space: pre-wrap !important',
      'word-wrap: break-word !important'
    ].join('; '));

    subtitleTranslated = document.createElement('div');
    subtitleTranslated.id = 'antalk-subtitle-translated';
    subtitleTranslated.setAttribute('style', [
      'font-size: 20px !important',
      'color: #ffffff !important',
      'font-weight: 500 !important',
      'line-height: 1.4 !important',
      'white-space: pre-wrap !important',
      'word-wrap: break-word !important',
      'text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9) !important'
    ].join('; '));

    subtitleContainer.appendChild(subtitleOriginal);
    subtitleContainer.appendChild(subtitleTranslated);
  }

  function attachSubtitle(video) {
    if (!video) return false;

    videoEl = video;
    const container = findVideoContainer(video);
    if (!container) return false;

    // Remove existing subtitle if any
    cleanupSubtitleDOM();

    // Create and insert
    createSubtitleDOM();
    container.appendChild(subtitleContainer);

    // Set up observers
    resizeObserver = new ResizeObserver(() => repositionSubtitle());
    resizeObserver.observe(video);

    console.log('[AnTalk] Subtitle attached to video');
    return true;
  }

  function repositionSubtitle() {
    if (!videoEl || !subtitleContainer || !subtitleContainer.parentElement) return;

    const videoRect = videoEl.getBoundingClientRect();
    const parentRect = subtitleContainer.parentElement.getBoundingClientRect();

    // Position relative to parent container
    const bottomOffset = parentRect.bottom - videoRect.bottom;
    const leftOffset = videoRect.left - parentRect.left;
    const videoBottom = bottomOffset + (videoRect.height * 0.08);

    subtitleContainer.style.setProperty('bottom', videoBottom + 'px', 'important');
    // Keep centered within video width
    subtitleContainer.style.setProperty('left', (leftOffset + videoRect.width / 2) + 'px', 'important');
    subtitleContainer.style.setProperty('max-width', (videoRect.width * 0.8) + 'px', 'important');
  }

  function updateSubtitleText(original, translated) {
    if (!subtitleContainer || !subtitleOriginal || !subtitleTranslated) return;

    subtitleOriginal.textContent = original || '';
    subtitleTranslated.textContent = translated || '';
    subtitleContainer.style.setProperty('display', 'block', 'important');
    subtitleContainer.style.setProperty('opacity', '1', 'important');

    // Auto-clear after 7 seconds of no new text
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (subtitleContainer) {
        subtitleContainer.style.setProperty('opacity', '0', 'important');
        setTimeout(() => {
          if (subtitleContainer) {
            subtitleContainer.style.setProperty('display', 'none', 'important');
          }
        }, 300);
      }
    }, 7000);
  }

  function updateSubtitlePartial(text) {
    if (!subtitleContainer || !subtitleOriginal) return;

    const lines = text.split('\n');
    subtitleOriginal.textContent = lines[lines.length - 1] || text;
    subtitleOriginal.style.setProperty('color', 'rgba(255, 255, 255, 0.35)', 'important');
    subtitleTranslated.textContent = '';
    subtitleContainer.style.setProperty('display', 'block', 'important');
    subtitleContainer.style.setProperty('opacity', '1', 'important');

    if (clearTimer) clearTimeout(clearTimer);
  }

  function clearSubtitlePartialStyle() {
    if (subtitleOriginal) {
      subtitleOriginal.style.setProperty('color', 'rgba(255, 255, 255, 0.55)', 'important');
    }
  }

  function cleanupSubtitleDOM() {
    if (subtitleContainer && subtitleContainer.parentElement) {
      subtitleContainer.parentElement.removeChild(subtitleContainer);
    }
    subtitleContainer = null;
    subtitleOriginal = null;
    subtitleTranslated = null;
  }

  function cleanupSubtitle() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    cleanupSubtitleDOM();
    videoEl = null;
  }

  function enableSubtitleMode() {
    const video = findPrimaryVideo();
    if (!video) {
      console.warn('[AnTalk] No video found, staying in panel mode');
      return false;
    }

    subtitleMode = true;
    hideFrame(); // hide floating panel
    const attached = attachSubtitle(video);
    if (!attached) {
      subtitleMode = false;
      showFrame();
      return false;
    }

    // Watch for video removal/replacement
    mutationObserver = new MutationObserver(() => {
      if (videoEl && !document.contains(videoEl)) {
        console.log('[AnTalk] Video removed, re-detecting...');
        const newVideo = findPrimaryVideo();
        if (newVideo) {
          attachSubtitle(newVideo);
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    chrome.storage.local.set({ antalkDisplayMode: 'subtitle' });
    console.log('[AnTalk] Subtitle mode enabled');
    return true;
  }

  function disableSubtitleMode() {
    subtitleMode = false;
    cleanupSubtitle();
    showFrame(); // show floating panel
    chrome.storage.local.set({ antalkDisplayMode: 'panel' });
    console.log('[AnTalk] Subtitle mode disabled, back to panel');
  }

  // ─── Fullscreen handler ───
  function onFullscreenChange() {
    if (!subtitleMode || !videoEl) return;
    // Re-attach after a brief delay for DOM to settle
    setTimeout(() => {
      const video = findPrimaryVideo();
      if (video) {
        attachSubtitle(video);
        repositionSubtitle();
      }
    }, 200);
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // ═══════════════════════════════════════════════════════════════
  // ─── Floating Panel — Show / Hide ───
  // ═══════════════════════════════════════════════════════════════

  function showFrame() {
    wrapper.style.setProperty('display', 'block', 'important');
    console.log('[AnTalk] overlay shown');
  }

  function hideFrame() {
    wrapper.style.setProperty('display', 'none', 'important');
  }

  // ─── Drag via toolbar ───
  let isDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;

  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.antalk) return;

    switch (e.data.antalk) {
      case 'HIDE':
        hideFrame();
        break;

      case 'DRAG_START': {
        isDragging = true;
        const rect = wrapper.getBoundingClientRect();
        dragOffsetX = e.data.clientX - rect.left;
        dragOffsetY = e.data.clientY - rect.top;
        iframe.style.setProperty('pointer-events', 'none', 'important');
        break;
      }
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;
    wrapper.style.setProperty('left', x + 'px', 'important');
    wrapper.style.setProperty('top', y + 'px', 'important');
    wrapper.style.setProperty('right', 'auto', 'important');
    wrapper.style.setProperty('bottom', 'auto', 'important');
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      iframe.style.setProperty('pointer-events', 'auto', 'important');
    }
  });

  // ─── Listen for messages from service worker ───
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ ok: true }); return; }

    if (msg.type === 'SHOW_OVERLAY') {
      // Check display mode preference
      chrome.storage.local.get(['antalkDisplayMode'], (data) => {
        if (data.antalkDisplayMode === 'subtitle') {
          const success = enableSubtitleMode();
          if (!success) showFrame(); // fallback to panel if no video
        } else {
          showFrame();
        }
      });
    }

    if (msg.type === 'HIDE_OVERLAY') {
      hideFrame();
      if (subtitleMode) {
        cleanupSubtitle();
        subtitleMode = false;
      }
    }

    // Toggle display mode from overlay CC button
    if (msg.type === 'SET_DISPLAY_MODE') {
      if (msg.mode === 'subtitle') {
        const success = enableSubtitleMode();
        if (!success) {
          // Notify overlay that subtitle mode failed (no video)
          try {
            chrome.runtime.sendMessage({ type: 'DISPLAY_MODE_CHANGED', mode: 'panel' });
          } catch (e) {}
        } else {
          try {
            chrome.runtime.sendMessage({ type: 'DISPLAY_MODE_CHANGED', mode: 'subtitle' });
          } catch (e) {}
        }
      } else {
        disableSubtitleMode();
        try {
          chrome.runtime.sendMessage({ type: 'DISPLAY_MODE_CHANGED', mode: 'panel' });
        } catch (e) {}
      }
    }

    // Subtitle mode: render translations directly in content script
    if (subtitleMode) {
      if (msg.type === 'TRANSLATION') {
        clearSubtitlePartialStyle();
        updateSubtitleText(msg.original, msg.translated);
      }
      if (msg.type === 'STT_PARTIAL') {
        updateSubtitlePartial(msg.text);
      }
      if (msg.type === 'STT_FINAL') {
        clearSubtitlePartialStyle();
      }
    }
  });

  // ─── Auto-show if session is active ───
  try {
    chrome.storage.local.get(['antalkActive', 'antalkDisplayMode'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data && data.antalkActive) {
        console.log('[AnTalk] Session active, showing overlay');
        if (data.antalkDisplayMode === 'subtitle') {
          const success = enableSubtitleMode();
          if (!success) showFrame();
        } else {
          showFrame();
        }
      }
    });
  } catch (e) {}
})();
