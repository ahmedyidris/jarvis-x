# Runbook: Database Connection Pool Exhaustion

**Symptoms:** Elevated 5xx errors, request latency spikes, logs show
`TimeoutError: connection pool exhausted` or `too many connections`.
Often follows a deploy that changed connection-per-worker settings or
introduced a connection leak (missing `close()`/`release()` on an
exception path).

**Common root causes:**
- A new code path opens a DB connection but doesn't release it on error
- Pool size not scaled after a worker-count or traffic increase
- A slow query holding connections open longer than usual, backing up the pool

**Remediation:**
1. Check pool metrics (active/idle/waiting) around the time of the spike
2. Correlate with the most recent deploy — look for new query paths or
   changed pool config
3. Roll back the suspect deploy or bump pool size as a stopgap
4. Add a leak check (connections held > N seconds) to catch recurrences
