---
title: commodities_macro vertical
week: 3
llm-invents-content: false
voice: en_us_kokoro
---

# commodities_macro

Same economic-facts-shaped rule as [[economic-facts]]. Covers 5 core commodities and 2 US macro data releases.

- **Generator:** `automation/phase-b/commodities_macro_generator.py`
- **Duration:** 25s (fixed)
- **Current facts (sourced 2026-08-16):** crude oil (WTI/Brent), natural gas (Henry Hub), copper, gold, wheat, US jobs report, US inflation (CPI)
- **Deliberately excludes** a Fed funds rate/FOMC fact — [[economic-facts]] already carries the most recent one (July 29, 2026 hold); duplicating it would produce two videos from one event.
- **Known issues:** none found — spot-checked for numeric fidelity to source on 2026-08-16 while building [[geopolitical-risk]]; all 7 facts here checked out clean.

See [[geopolitical-risk]] for the vertical where this fidelity check actually caught a problem.
