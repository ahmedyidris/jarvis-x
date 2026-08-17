---
title: geopolitical_risk vertical
week: 4
llm-invents-content: false
voice: en_us_kokoro
---

# geopolitical_risk

Same economic-facts-shaped rule as [[economic-facts]] and [[commodities-macro]]. Covers 5 geopolitical flashpoints.

- **Generator:** `automation/phase-b/geopolitical_risk_generator.py`
- **Duration:** 25s (fixed)
- **Current facts (sourced 2026-08-16):** Red Sea/Houthi shipping attacks, Taiwan Strait tensions, US-China trade tariffs, Suez Canal traffic, South China Sea tensions
- **Deliberately avoids overlap** with [[commodities-macro]]'s oil fact (Iran/Hormuz) and wheat fact (Black Sea/Ukraine grain) — this vertical's Red Sea fact is a distinct direct-attack event.

## Known issue: numeric-fidelity gap in the shared pattern

2 of the first 5 LLM-scripted outputs here invented a specific number not present in the sourced fact — a fabricated "40%" (Suez Canal traffic; source only said "60% below 2023" and "16.7% year-over-year," never 40%) and a fabricated "29.5%" (US-China tariffs; source said "close to 30%"). Despite the prompt's explicit anti-invention instruction, the LLM still did this in 2/5 cases.

The shared retry/validation logic (used by all three fact-constrained verticals) checks JSON shape and non-empty fields — **it does not check numeric fidelity to the source fact.** This class of error passes silently.

Caught only by manually reading every generated JSON against its source before shipping; both hand-corrected. Retroactively checked [[economic-facts]] and [[commodities-macro]]'s already-shipped content the same way — both came back clean.

**Standing rule until this is automated:** manually spot-check every new vertical's generated output against its source fact before treating a batch as done. See [[add-a-phase-b-vertical]] step 5.
