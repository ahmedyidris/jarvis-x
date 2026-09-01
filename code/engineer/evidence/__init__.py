"""One module per diagnostic domain. Each exposes a `collect()` function
returning a plain evidence dict. Anything unobservable in this environment
must be reported as an explicit {"unavailable": "<reason>"} value -- never
silently omitted (see the spec's Section 8 platform-limitations rule).
"""
