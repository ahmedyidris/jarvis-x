# Jarvis X — Brand Guidelines

**Status:** v0.2 — accent color finalized (see Color section); everything else is still the v0.1 first pass informed by CONSTITUTION.md, config/voice.json, and the existing CLI's visual vocabulary.

## Positioning

> "Jarvis X is a locally-first, autonomous personal AI assistant" — CONSTITUTION.md

Not a consumer chatbot skin. The brand has to carry three things at once:

- **Sovereign / local-first** — nothing here should read like a SaaS dashboard phoning home.
- **Calm authority** — the Constitution's own tone: formal, rule-governed, auditable. "Governed by written rules only."
- **Human-in-the-loop, visibly** — approval gates and the kill switch are core to what this product *is*, not an afterthought buried in settings.

## Voice & Tone

- Direct, technical, unembellished. No exclamation-point enthusiasm.
- States what it did and why it's blocked, not what it's excited to help with.
- Bilingual as a first-class citizen, not a translated afterthought (see Bilingual section).

## Color

Dark-first, sci-fi HUD direction (Iron Man / Jarvis reference, chosen over minimal-SaaS / terminal-hacker / warm-consumer alternatives).

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0A0E14` | Page background — near-black, not pure black (avoids OLED smear, keeps glow effects visible) |
| `--bg-panel` | `#111823` | Sidebar / card surfaces, one step up from base |
| `--accent` | **`#2DE2FF`** (Arc Cyan) — **final, confirmed** | Primary accent — arc-reactor cyan. See rationale below. |
| `--accent-dim` | `#0E7490` | Accent at rest / inactive glow, panel hairline borders |
| `--text-primary` | `#E6F1FF` | Primary text on dark |
| `--text-secondary` | `#7A8899` | Secondary/meta text |
| `--success` | `#34D399` | Maps to existing CLI ✅ |
| `--warning` | `#FBBF24` | Maps to existing CLI ⚠️ |
| `--error` | `#F87171` | Maps to existing CLI ❌ |
| `--blocked` | `#EF4444` (solid, no glow) | Kill-switch / ⛔ — deliberately the one color with no glow effect, so "blocked" never looks decorative |

**Accent decision (closed 2026-08-13):** `#2DE2FF` — "Arc Cyan." Confirmed as the final pick, refined from the `#22D3EE` placeholder rather than reusing it as-is: `#22D3EE` is Tailwind's stock `cyan-400`, which shows up as-is across a lot of generic SaaS/AI-tool branding, and Brand Guidelines' own positioning explicitly rejects reading as "SaaS dashboard phoning home." `#2DE2FF` sits in the same arc-reactor-cyan family (the aesthetic direction was never in question) but is pulled slightly more electric/saturated so it reads as a chosen brand color rather than a framework default. Contrast-checked at 12.37:1 against `--bg-base` and 11.4:1 against `--bg-panel` (WCAG AAA territory, well past the 4.5:1 floor), and 12.37:1 for `--bg-base`-on-`--accent` button fills. `--accent-dim` (`#0E7490`) is kept as-is — it was already doing its job as a hairline/rest-state tone and didn't need to move with the accent refinement.

Light theme is out of scope for v0.1 — the HUD aesthetic is dark-native; a light variant would need its own pass, not a mechanical inversion.

## Typography

Bilingual (English + Arabic — see `config/voice.json`'s `en`/`ar` voice routes) is a **day-one requirement**, not deferred.

- **Latin UI text:** a technical/geometric sans — e.g. Inter or IBM Plex Sans — for readability at dashboard density.
- **Latin monospace (HUD accents, status values, logs):** JetBrains Mono or IBM Plex Mono — echoes the CLI's REPL heritage (`jj>` prompt).
- **Arabic:** IBM Plex Sans Arabic or Noto Sans Arabic, paired at matching optical weight to the Latin sans — chosen specifically because both ship as part of a family designed for Latin/Arabic pairing (avoids the common mismatch where the Arabic face looks like an unrelated afterthought font).
- No monospace-Arabic equivalent is being specified — Arabic HUD/status text renders in the paired sans, not forced into a Latin-style monospace grid.

## Iconography

The CLI already has a consistent **emoji-as-status-vocabulary** (found in `code/jarvis-x.js`, `voice.js`, `guard.js`, `market-brief.js`, `models.js`):

| Emoji | Meaning | Dashboard equivalent |
|---|---|---|
| ✅ | success / available | `--success` badge |
| ❌ | error | `--error` badge |
| ⏳ | pending | pulsing `--accent-dim` |
| ⛔ | kill-switch / blocked | `--blocked`, no glow (see above) |
| 🎤 / 🗣️ | voice in / out | mic / speaker icon, active state glows `--accent` |
| 🔄 | processing | spinner, `--accent` |
| ⚠️ | warning | `--warning` badge |
| 📊 | market brief / data | chart icon |
| 🤖 | system identity | wordmark position (no logo yet — see below) |

**Decision:** the dashboard translates this emoji vocabulary into a matching icon set (e.g. Lucide/Phosphor icons) rather than rendering literal emoji in the UI — keeps semantics consistent with the CLI while looking native to a HUD rather than a chat app.

## Logo

None exists. Out of scope for this pass — the dashboard ships with a wordmark ("JARVIS X" in the monospace face) until a mark is designed. Do not commission or generate a placeholder logo as part of this work.
