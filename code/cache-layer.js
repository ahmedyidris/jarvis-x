class CacheLayer {
  constructor(options = {}) {
    this.memoryStore = new Map();
    this.defaultTTL = options.defaultTTL || 300000;
    this.stats = { hits: 0, misses: 0 };
  }
  async get(key) {
    const entry = this.memoryStore.get(key);
    if (!entry) { this.stats.misses++; return null; }
    const age = Date.now() - entry.createdAt;
    if (age > entry.ttl) { this.memoryStore.delete(key); this.stats.misses++; return null; }
    this.stats.hits++;
    return { value: entry.value, age, staleness: age > (entry.ttl * 0.8) ? 'stale' : 'fresh' };
  }
  async set(key, value, ttl = this.defaultTTL) {
    this.memoryStore.set(key, { value, createdAt: Date.now(), ttl });
  }
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return { ...this.stats, hitRate: total ? (this.stats.hits / total * 100).toFixed(2) + '%' : 'N/A' };
  }
}
module.exports = CacheLayer;
