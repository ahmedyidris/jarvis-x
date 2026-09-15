#!/usr/bin/env python3
"""Regenerate fixtures/numeric-fidelity-cases.json from the ORIGINAL checker.

WHY THIS SCRIPT EXISTS RATHER THAN A HAND-WRITTEN FIXTURE. The expectations
here are not opinions about what numeric fidelity should do — they are what
`automation/phase-b/content_generator.py`'s check_numeric_fidelity() actually
does, recorded so a second implementation (code/content-fidelity.js) can be
held to it. Hand-editing an expectation would turn a spec into a
rationalisation of whatever the code happens to do today.

So: add a CASE below, run this, and commit the regenerated JSON. If a case's
expectation CHANGES when you regenerate, that is a behaviour change in the
Python checker and wants explaining in the commit message, not absorbing.

    python3 scripts/gen-fidelity-fixture.py
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'automation', 'phase-b'))
from content_generator import check_numeric_fidelity as chk  # noqa: E402

# (name, source_fact, [generated_texts])
CASES = [
    ("a genuinely invented number is flagged",
     "Inflation cooled to 2.4% in August.", ["Inflation cooled to 2.4%, the lowest in 40 months."]),
    ("a faithful restatement is clean",
     "Inflation cooled to 2.4% in August.", ["August inflation came in at 2.4%."]),
    ("trailing sentence punctuation is not a new number",
     "A loaf costs EGP 24.00", ["A loaf costs EGP 24.00."]),
    ("insignificant trailing zeros match",
     "A loaf costs EGP 24.00", ["A loaf costs EGP 24."]),
    ("thousands separators match",
     "Output reached 1200 barrels", ["Output reached 1,200 barrels"]),
    ("percent is significant: bare 40 does not satisfy 40%",
     "Shipping fell 40 vessels", ["Shipping fell 40%"]),
    ("a range written with the unit once",
     "The band is 3.5% to 3.75%", ["The band is 3.5-3.75%"]),
    ("percent spelled out matches the symbol",
     "The band is 3.5% to 3.75%", ["The band is 3.5 to 3.75 percent"]),
    ("a number word matches its digit",
     "Three ships were hit", ["3 ships were hit"]),
    ("a digit matches its number word",
     "3 ships were hit", ["Three ships were hit"]),
    ("multiple generated texts are all checked",
     "Gold hit 2400", ["Gold hit 2400", "Gold hit 2500"]),
    ("THE KNOWN LIMIT: a garbled restatement of a real number is NOT caught",
     "A 90-day pause prevents tariffs rising to 125%",
     ["A 90-day pause on tariffs from 125% to 125%"]),
    ("no numbers anywhere is clean",
     "Shipping attacks continued", ["Shipping attacks continued in the region"]),
    ("a number in the source but absent from the text is not a suspect",
     "Gold hit 2400 and silver 30", ["Gold hit 2400"]),
    ("percentage points spelled out",
     "Rates rose 2 percentage points", ["Rates rose 2%"]),
    ("a decimal invented from a whole number is flagged",
     "Gold hit 2400", ["Gold hit 2400.5"]),
    # Added 2026-09-15 after the first real end-to-end run: a numbered outline
    # was refused because its list markers tokenized as invented numbers.
    ("numbered list markers are structure, not claims",
     "CPI rose 2.4% in August.", ["1) the number 2.4%\n2) what it means"]),
    ("markdown-style numbered markers too",
     "CPI rose 2.4% in August.", ["1. the number 2.4%\n2. what it means"]),
    ("a YEAR at the start of a line is still a claim, not a marker",
     "CPI rose 2.4% in August.", ["2021. was the last time it was this low"]),
    ("a number mid-sentence is untouched by the list rule",
     "CPI rose 2.4% in August.", ["it rose 2.4% (the 3rd month running)"]),
]

WHY = (
    "Ground truth for numeric fidelity, shared by TWO implementations so they cannot "
    "drift apart. Generated from automation/phase-b/content_generator.py's "
    "check_numeric_fidelity() — the original, whose every rule documents a false positive "
    "that once made the enforcer refuse to ship correct content. code/content-fidelity.js "
    "is a port and must agree on every case here. Regenerate with "
    "scripts/gen-fidelity-fixture.py, never by hand: hand-editing an expectation turns a "
    "spec into a rationalisation of whatever the code now does."
)

def main():
    doc = {
        "_why": WHY,
        "cases": [
            {"name": n, "source": s, "generated": g, "suspects": chk(s, *g)}
            for n, s, g in CASES
        ],
    }
    out = os.path.join(REPO, 'fixtures', 'numeric-fidelity-cases.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f"{len(doc['cases'])} cases -> {out}")

if __name__ == '__main__':
    main()
