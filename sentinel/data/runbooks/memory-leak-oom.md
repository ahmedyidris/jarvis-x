# Runbook: Gradual Memory Growth Leading to OOM Kill

**Symptoms:** Memory usage climbs steadily over hours/days rather than
spiking; process is eventually OOM-killed. Often starts right after a
feature flag rollout or a new background job/cron began running.

**Common root causes:**
- Unbounded in-memory cache or list that grows with traffic and never evicts
- A newly enabled feature flag path holds references (event listeners,
  closures) that are never released
- Batch/cron job processing an ever-growing dataset without paging

**Remediation:**
1. Diff memory growth rate against recent feature-flag/deploy timeline
2. Heap-profile the process to find the growing allocation site
3. Disable the suspect flag/feature as a stopgap
4. Add a bounded cache size or explicit eviction policy
