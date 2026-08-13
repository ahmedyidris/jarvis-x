# Stage 01 — Source Content

Layer 2 contract for the content-sourcing stage of the Phase B video
pipeline. This is the stage that decides what a video will *say* before any
rendering happens. Two verticals live here today, each with its own rules
(see `content_generator.py` and `economic_facts_generator.py` at the
`automation/phase-b/` root — the code itself is unchanged by the ICM
restructure, only its output path moved to be under this stage).

## Vertical: letters (Week 1)

**Inputs:** a single uppercase letter (CLI arg to `content_generator.py`).

**Process:** `content_generator.py` prompts the local Ollama `qwen2.5:3b`
model (via its HTTP API, `http://127.0.0.1:11434/api/generate`) to invent
kid-friendly content for that letter — an example word, a short narration
script, on-screen text, and an image prompt. One stricter retry is attempted
if the first response doesn't parse as valid JSON with all required fields.

**Rule:** LLM-invented content is fine here. There is no factual-accuracy
constraint — this is children's educational content (e.g. "A is for
Apple!"), not a claim about the world that needs sourcing. Kid-friendly tone
is the only content requirement (see the prompt in
`_build_prompt()`: "1-2 short, kid-friendly sentences a narrator would
speak aloud").

**Outputs:** `output/letters/letter_<LETTER>.json`, schema:
```
{"letter", "example_word", "narration_script", "on_screen_text",
 "image_prompt", "duration_seconds"}
```
(`duration_seconds` is fixed at 15 for this vertical.)

## Vertical: economic_facts (Week 2)

**Inputs:** a hardcoded Python list, `SOURCED_FACTS`, inside
`economic_facts_generator.py` — each entry already has `topic`,
`headline_fact`, `source_name`, `source_url`.

**THE HARD RULE (verbatim from the code that enforces it — do not
paraphrase this away in future dispatches):**

From `economic_facts_generator.py`'s module docstring:

> UNLIKE Week 1's content_generator.py, the local qwen2.5:3b model is NEVER
> the source of the facts themselves — it only turns an already-sourced,
> human-verified fact into narration/caption text. This split exists on
> purpose (explicit decision with the actual user): a local LLM must never
> be allowed to invent an "economic fact" and have it presented as true.
>
> Pipeline, in order:
>   1. Real, current facts are found via the WebSearch tool (done once, by
>      hand, in the agent session that authored SOURCED_FACTS below...).
>      Each fact carries a real source_name + source_url that was actually
>      returned by a search, not paraphrased or invented.
>   2. Those sourced facts are hardcoded here as SOURCED_FACTS. This script
>      does NOT call WebSearch itself (it's a library tool available to the
>      agent, not a Python API) — it consumes the output of that research
>      step, which is the whole point of the human/agent-in-the-loop design.
>   3. ONLY THEN is qwen2.5:3b ... prompted to write
>      narration_script/on_screen_text/image_prompt AROUND the given fact —
>      explicitly instructed not to add any claim, number, or detail not
>      present in the fact/source it's given.
>   4. Every output JSON keeps source_name/source_url so the fact stays
>      traceable back to where it was found.
>
> If a topic's search didn't turn up a real, current, verifiable fact, it is
> skipped entirely rather than filled in with an invented "fact".

And from the in-prompt instruction sent to the model itself
(`_build_prompt()`):

> CRITICAL RULE: Do not invent, add, or imply any fact, number, date, or
> claim that is not already stated in the fact below. Do not speculate about
> causes, future outcomes, or related events unless they are explicitly
> present in the fact text. If you are unsure whether something is stated
> below, leave it out.

**Retry budget and the one permitted non-invented fallback:**
`MAX_ATTEMPTS = 3` attempts against Ollama per fact. `narration_script` and
`on_screen_text` — the two fields that actually carry the sourced fact to
the viewer — must come from the model; if every attempt fails to produce
them, `generate_economic_content()` raises `ValueError` rather than
guessing (never silently degrades). `image_prompt` is the ONE field allowed
a deterministic, non-LLM fallback (`_fallback_image_prompt()`) if the model
keeps omitting just that key — because it is purely cosmetic (an unused,
future image-gen hint) and the fallback "invents no claim, just a generic
illustration direction" (verbatim comment in the code, `CORE_LLM_FIELDS`
block). This was observed empirically: qwen2.5:3b occasionally emits
well-formed JSON that's simply missing the `image_prompt` key outright,
stochastically, not from truncation.

**New vertical checklist**, if adding a third one under this stage: decide
up front whether it is letters-shaped (LLM may invent) or
economic-facts-shaped (LLM may only script around a pre-sourced, traceable
fact) — do not default to "LLM invents" without an explicit decision, per
the precedent set by economic_facts.

**Outputs:** `output/economic_facts/econ_<slug>.json`, schema:
```
{"topic", "headline_fact", "source_name", "source_url",
 "narration_script", "on_screen_text", "image_prompt", "duration_seconds"}
```
(`duration_seconds` fixed at 25 for this vertical — denser than letters'
15s, per `economic_facts_generator.py`'s `DURATION_SECONDS` comment: "still
a short-form vertical video... comfortably fits a fact + 2-4 sentences of
narration without feeling rushed or dragging.")

## Directory layout
```
stages/01_source_content/
  CONTEXT.md          # this file
  output/
    letters/*.json
    economic_facts/*.json
```
Both `letters/` and `economic_facts/` under `output/` are git-tracked (this
is sourced *content*, not a regenerable render — see
`automation/phase-b/.gitignore`, which only ignores stage 02's render
output).
