class Gateway {
  constructor({ tierPolicy, guardCheck, budget, breaker, store, telemetry, providers }) {
    this.tierPolicy = tierPolicy;
    this.guardCheck = guardCheck || (() => ({ blocked: false }));
    this.budget = budget;
    this.breaker = breaker;
    this.store = store;
    this.telemetry = telemetry;
    this.providers = providers;

    if (this.store) {
      try {
        this.breaker.load(this.store.loadBreakerSnapshot());
      } catch (e) {
        console.error('model-gateway: persistence failed (using default breaker state):', e.message);
      }
      try {
        this.budget.load(this.store.loadBudgetSnapshot());
      } catch (e) {
        console.error('model-gateway: persistence failed (using default budget state):', e.message);
      }
    }
  }

  async route(input, tier, options = {}) {
    const tag = options.tag || 'default';
    const startedAt = Date.now();

    const finish = (fields) => {
      const latencyMs = Date.now() - startedAt;
      const record = { tag, tier, latencyMs, ...fields };
      if (this.telemetry) this.telemetry.record(record);
      return { text: null, provider: null, degraded: false, gated: false, blocked: false, cost: 0, ...record };
    };

    const guardResult = await this.guardCheck({ input, tier, tag });
    if (guardResult && guardResult.blocked) {
      return finish({ blocked: true, reason: guardResult.reason, cost: 0 });
    }

    const budgetResult = this.budget.checkAndReserve(tag);
    if (!budgetResult.ok) {
      return finish({ blocked: true, reason: `budget:${budgetResult.reason}`, cost: 0 });
    }

    const { chain, gate } = this.tierPolicy.resolve(tier);
    const available = chain.filter(name => !this.breaker.isOpen(name));

    const errors = [];
    for (let i = 0; i < available.length; i++) {
      const name = available[i];
      const provider = this.providers.get(name);
      try {
        const result = await provider.call(input);
        this.breaker.recordSuccess(name);
        this.budget.recordCall(tag, result.cost || 0);
        this._persist();
        return finish({ text: result.text, provider: name, degraded: i > 0, gated: gate, blocked: false, cost: result.cost || 0 });
      } catch (e) {
        this.breaker.recordFailure(name);
        this._persist();
        errors.push(`${name}: ${e.message}`);
      }
    }

    finish({ provider: null, gated: gate, blocked: false, exhausted: true, cost: 0, reason: errors.join(' | ') });
    throw new Error(`all providers exhausted for tier ${tier} -> ${errors.join(' | ')}`);
  }

  _persist() {
    if (!this.store) return;
    try {
      this.store.saveBreakerSnapshot(this.breaker.snapshot());
      this.store.saveBudgetSnapshot(this.budget.snapshot());
    } catch (e) {
      console.error('model-gateway: persistence failed (call still happened):', e.message);
    }
  }
}

module.exports = { Gateway };
