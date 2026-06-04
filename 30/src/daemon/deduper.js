const Levenshtein = require('levenshtein');
const config = require('../config');

class Deduper {
  constructor(db) {
    this.db = db;
  }

  isDuplicate(newContent, type) {
    if (type === 'image') {
      return this._checkImageDuplicate(newContent);
    }
    return this._checkTextDuplicate(newContent);
  }

  _checkTextDuplicate(newText) {
    const recent = this.db.getRecentForDedup(config.DEDUP_RECENT_COUNT);
    const textItems = recent.filter(item => item.type === 'text');

    for (const item of textItems) {
      const similarity = this._calculateSimilarity(newText, item.content);
      if (similarity >= config.DEDUP_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  _checkImageDuplicate(newBase64) {
    return false;
  }

  _calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1;

    const distance = new Levenshtein(str1, str2).distance;
    return 1 - distance / maxLen;
  }
}

module.exports = Deduper;
