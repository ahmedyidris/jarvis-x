# ERRORS — Systematic Failures

## Pattern 1: Model Availability
Proposed actions for unavailable models (Hermes, DeepSeek, Claude).
Fix: Updated Guidelines.md to list ONLY qwen2.5:7b, qwen2.5:3b.

## Pattern 2: JSON Formatting
Newlines inside JSON strings not escaped; guard() rejected valid operations.
Fix: Added reEscape() in lib.js.

## Pattern 3: Router Tier Confusion
Hard tier proposals sometimes routed to local 3b instead of 7b.
Fix: Clarified tier selection in Guidelines.md.
