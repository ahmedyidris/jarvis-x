const BaseProvider = require('./base-provider');

class EnergyProvider extends BaseProvider {
  constructor() {
    super('energy', { rateLimit: { requests: 120, window: 3600000 } });
    this.baseUrl = process.env.ENERGY_API_URL || 'https://www.eia.gov/opendata/qb.php';
  }

  async fetch(key) {
    await this.checkRateLimit();
    
    const mockResponses = {
      'crude-oil-wti': { name: 'WTI Crude Oil', price: 78.45, unit: 'USD/barrel', change: 0.35, source: 'EIA', timestamp: new Date().toISOString() },
      'crude-oil-brent': { name: 'Brent Crude Oil', price: 81.2, unit: 'USD/barrel', change: 0.45, source: 'EIA', timestamp: new Date().toISOString() },
      'gold': { name: 'Gold', price: 2045, unit: 'USD/oz', change: -5, source: 'USGS', timestamp: new Date().toISOString() },
      'natural-gas': { name: 'Natural Gas', price: 2.82, unit: 'USD/MMBtu', change: 0.02, source: 'EIA', timestamp: new Date().toISOString() },
      'coal': { name: 'Coal', price: 185, unit: 'USD/ton', change: -2, source: 'EIA', timestamp: new Date().toISOString() }
    };

    if (!mockResponses[key]) throw new Error(`Unknown energy key: ${key}`);
    
    this.logRequest(key, 'FETCH', mockResponses[key]);
    return mockResponses[key];
  }
}

module.exports = EnergyProvider;
