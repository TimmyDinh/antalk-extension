/**
 * Translation Module — MyMemory API
 * Free tier: 5000 words/day, no API key needed
 */
class Translator {
  constructor() {
    this.apiUrl = 'https://api.mymemory.translated.net/get';
    this._pending = null;
    this._debounceTimer = null;
    this._cache = new Map();
  }

  /**
   * Translate text from source to target language
   * @param {string} text - Text to translate
   * @param {string} from - Source language code (e.g., 'en')
   * @param {string} to - Target language code (e.g., 'vi')
   * @returns {Promise<string>} Translated text
   */
  async translate(text, from, to) {
    if (!text.trim()) return '';
    if (from === to) return text;

    // Check cache
    const cacheKey = `${from}|${to}|${text}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    // Abort previous request if still pending
    if (this._pending) {
      this._pending.abort();
    }

    const controller = new AbortController();
    this._pending = controller;

    try {
      // MyMemory API has 500-char limit — split long text into chunks
      const MAX_CHARS = 480;
      let translated;
      if (text.length <= MAX_CHARS) {
        translated = await this._fetchTranslation(text, from, to, controller.signal);
      } else {
        const chunks = this._splitIntoChunks(text, MAX_CHARS);
        const results = [];
        for (const chunk of chunks) {
          if (controller.signal.aborted) return null;
          const result = await this._fetchTranslation(chunk, from, to, controller.signal);
          results.push(result);
        }
        translated = results.join(' ');
      }

      // Cache result (limit cache size)
      if (this._cache.size > 200) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      this._cache.set(cacheKey, translated);

      return translated;
    } catch (err) {
      if (err.name === 'AbortError') return null; // Cancelled, not an error
      throw err;
    } finally {
      if (this._pending === controller) {
        this._pending = null;
      }
    }
  }

  /**
   * Split text into chunks at sentence boundaries, each ≤ maxLen chars
   */
  _splitIntoChunks(text, maxLen) {
    const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]?\s*/g) || [text];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > maxLen) {
        // Single sentence too long — split on commas or hard-cut
        if (current) { chunks.push(current.trim()); current = ''; }
        const parts = sentence.match(new RegExp(`.{1,${maxLen}}(?:[,，;；]\\s*|$)`, 'g')) || [sentence];
        for (const part of parts) {
          chunks.push(part.trim());
        }
      } else if ((current + sentence).length > maxLen) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  /**
   * Single API call to MyMemory
   */
  async _fetchTranslation(text, from, to, signal) {
    const params = new URLSearchParams({
      q: text,
      langpair: `${from}|${to}`
    });

    const response = await fetch(`${this.apiUrl}?${params}`, { signal });

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || 'Translation failed');
    }

    return data.responseData.translatedText;
  }

  /**
   * Translate with debounce — waits for user to stop talking
   */
  translateDebounced(text, from, to, callback, delay = 300) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      try {
        const result = await this.translate(text, from, to);
        if (result !== null) {
          callback(result);
        }
      } catch (err) {
        callback(null, err);
      }
    }, delay);
  }
}
