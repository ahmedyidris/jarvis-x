/**
 * Agent loop with real data
 * Wraps agent.js logic, injects data layer
 */

const AgentDataIntegration = require('./agent-data-integration');
const AccessibilityIntegration = require('./accessibility-integration');

class AgentWithData {
  constructor() {
    this.dataIntegration = new AgentDataIntegration();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await AccessibilityIntegration.init();
    this.initialized = true;
    console.log('[Agent] Ready with data integration');
  }

  /**
   * Process user query and return data-driven response
   */
  async processQuery(userQuery) {
    await this.init();

    // 1. Resolve query to data key
    const response = await this.dataIntegration.buildResponse(userQuery);

    // 2. Log to audit trail (implicit in buildResponse → getDataWithContext)

    // 3. Return formatted response
    return {
      userQuery,
      response: response.text,
      metadata: {
        source: response.source,
        cacheHit: response.cacheHit,
        latency: response.latency,
        staleness: response.staleness
      }
    };
  }

  async getStats() {
    return this.dataIntegration.getStats();
  }
}

module.exports = AgentWithData;
