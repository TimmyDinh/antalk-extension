/**
 * AnTalk Extension — Content Script
 * Injects a draggable, resizable iframe overlay.
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

  // ─── Create wrapper div (handles drag + resize) ───
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

  // ─── Show / Hide ───
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
        // Disable iframe pointer events during drag so mousemove works on parent
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
    if (msg.type === 'SHOW_OVERLAY') showFrame();
    if (msg.type === 'HIDE_OVERLAY') hideFrame();
  });

  // ─── Auto-show if session is active ───
  try {
    chrome.storage.local.get(['antalkActive'], (data) => {
      if (chrome.runtime.lastError) return;
      if (data && data.antalkActive) {
        console.log('[AnTalk] Session active, showing overlay');
        showFrame();
      }
    });
  } catch (e) {}
})();
