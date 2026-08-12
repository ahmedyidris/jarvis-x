# Runbook: 502s After Certificate Rotation

**Symptoms:** Gateway/load-balancer returns 502/503 across multiple or
all regions shortly after a certificate rotation or renewal job ran.
Upstream services are healthy; the failure is at the TLS termination layer.

**Common root causes:**
- New certificate missing intermediate chain, rejected by some clients/LBs
- Certificate rotated on some nodes but not others (partial rollout)
- Old cert expired before the new one propagated (renewal ran too late)

**Remediation:**
1. Check cert expiry/validity and chain completeness on all affected nodes
2. Confirm rotation reached 100% of LB/edge nodes, not a partial subset
3. Roll back to the previous valid cert if rotation is the trigger
4. Move renewal earlier in the expiry window to avoid race conditions
