#!/bin/bash
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json
rows=[json.loads(l) for l in open('logs/proposals.jsonl') if l.strip()]
g=[r for r in rows if 'correct' in r]
ok=sum(1 for r in g if r['correct'])
print(f"graded {len(g)}/{len(rows)} proposals | correct {ok}/{len(g)}" +
      (f" = {ok/len(g):.0%}" if g else ""))
PY
