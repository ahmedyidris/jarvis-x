# Jarvis X — Design.md

**Status:** v0.1 — generated from the answers below (purpose, aesthetic, layout, bilingual scope) plus repo reconnaissance (CONSTITUTION.md, config/voice.json, existing CLI emoji vocabulary). This is a living document per the "Drift Loop": every time implementation deviates from what's written here, the fix is a new rule added to this file, not a one-off patch. See `BrandGuidelines.md` for color/type tokens referenced below.

## Scope

Jarvis X's **Web UI/PWA** (blueprint Week 7) — not the CLI, not the voice pipeline. This document governs its look and interaction model before any component code is written.

## Answers this design is built on

| Question | Answer |
|---|---|
| Primary job, day one | **Both, equally** — chat is not the whole app; ops (model tier, scheduler, audit log, kill switch, memory) is a first-class panel, not a settings tab |
| Aesthetic | **Sci-fi HUD** (Iron Man / Jarvis reference) — over minimal-SaaS, terminal-hacker, and warm-consumer alternatives |
| Layout | **Persistent sidebar + main chat** — both always visible, over top-status-bar or tabbed-views alternatives |
| Bilingual (EN/AR) | **Yes, from day one** — not a later retrofit; `config/voice.json` already treats EN/AR as parallel routes, the UI should match |
| Accent color | **Resolved (2026-08-13)** — `#2DE2FF` "Arc Cyan," see BrandGuidelines.md's Color section for the final hex and rationale |

## Theme

Dark only for v0.1 (see Brand Guidelines — no light theme yet). This is a deliberate scope cut, not an oversight: a light HUD theme needs its own design pass rather than a mechanical color inversion.

## Layout

```
┌─────────────┬──────────────────────────────────┐
│  SIDEBAR     │  MAIN — CHAT                     │
│  (fixed)     │                                   │
│  • Model tier│  [conversation history]           │
│  • Scheduler │                                   │
│  • Audit log │                                   │
│  • Kill sw.  │                                   │
│  • Memory    │  [input row: text + voice toggle] │
└─────────────┴──────────────────────────────────┘
```

- Sidebar width: fixed, ~280–320px on desktop; collapses to an overlay drawer below a mobile breakpoint (this is the PWA's mobile-install case from the blueprint's platform table — iOS/Android via PWA).
- **RTL mirroring:** when the active language is Arabic, the sidebar flips to the right edge and the whole layout mirrors (`dir="rtl"` at the document root, not per-component flips) — this is a structural requirement, not a CSS afterthought, because the sidebar-left assumption is baked into the layout grid above.
- Kill switch (⛔) is always visible in the sidebar, never nested in a menu — it maps directly to `.jarvis-x-STOP` (repo root) and must be reachable in one tap per the Constitution's "one-tap approval" language.

## Corner radius & shape language

Sharp-to-slightly-rounded (2–4px), not the 12–16px "friendly SaaS" rounding. Panels read as instrument-cluster segments, not cards. Chat bubbles are the one exception — they get slightly more rounding (6–8px) so conversation stays readable as conversation and doesn't feel like a system readout.

## Depth & elevation

No drop shadows. Elevation is communicated through **glow**, not shadow — an active/focused element gets a soft `--accent` outer glow (matches the arc-reactor reference); inactive panels are flat with a 1px `--accent-dim` border. This is the single biggest visual differentiator from a generic SaaS dashboard and should not be diluted by also adding conventional box-shadows "for depth."

## Density

Dense/information-rich — this follows directly from "ops dashboard" being equal-priority with chat. Sidebar panels show live values (current model tier, last scheduler run, last audit entries) at a glance, not behind a click. Generous whitespace is *not* the goal here the way it would be for a marketing site.

## Status & icon system

Per Brand Guidelines' emoji→icon mapping table. Two rules:

1. Every status icon has a **text-equivalent tooltip/label** — not decorative-only, since a HUD that's all-icon becomes unreadable to anyone unfamiliar with the vocabulary (and fails basic a11y).
2. The **blocked/kill-switch state is the one state that never glows** — flat, solid `--error`/`--blocked` red. Everything else in this design language uses glow for "active/good"; blocked is deliberately visually inert so it never reads as just another animated state.

## Motion

Minimal, purposeful:
- Glow pulses gently on "processing" states (🔄 equivalent) — slow (~2s cycle), not a spinner-fast pulse.
- No page-transition animations. Panel content updates in place.
- Voice-active state (🎤/🗣️ equivalent) gets a brighter, faster glow than "processing" so the two are visually distinct at a glance.

## Reference inspirations

- Iron Man / Jarvis HUD (arc-reactor cyan, glow-as-elevation) — primary reference.
- Existing Jarvis X CLI emoji vocabulary — preserved semantically, not visually (see Iconography).
- Explicitly **not** referencing: Linear/Vercel-style minimal SaaS, ChatGPT's warm consumer chrome, or a literal green-phosphor terminal look — these were the alternatives considered and rejected for this project.

## Open items (flag before implementation)

- ~~**Accent color** is unconfirmed~~ — **resolved**, see BrandGuidelines.md (`#2DE2FF`, "Arc Cyan").
- **Arabic dialect for UI copy**: `config/voice.json` currently mixes MSA-adjacent and dialect-specific voices (Jordanian, Emirati) with an unresolved Egyptian-dialect note in `.claude/settings.local.json`'s fetch history. UI copy should default to MSA for written text regardless of which dialect voice is speaking — dialect variation belongs to speech, not to written UI strings.
- **Mobile breakpoint specifics** (exact px, drawer animation) are deferred to the actual implementation plan — this doc fixes the visual language, not every responsive detail.

## Implementation notes (visual pass, 2026-08-13)

The v0.1 visual language above was applied to `web/src/`. What shipped vs. what's still open, for whoever picks this up next:

- **Shipped:** HUD dark palette (final accent wired through), sharp 3-4px corners on panels/controls with 6-8px chat bubbles, glow-not-shadow elevation (slow pulse for "processing," faster/brighter pulse for voice-active, kill-switch stays flat/no-glow), emoji-vocabulary swapped for a `lucide-react` icon set with text-equivalent labels/tooltips, monospace treatment for HUD status values.
- **Deferred:** the actual EN/AR language toggle and translated UI copy. No i18n string table or switcher control exists yet — this is a real feature (string extraction, a translated copy set, wiring `config/voice.json`'s routes to the UI) and was judged too large to fold into a styling pass. What *is* done now so the retrofit is cheap later: layout uses CSS logical properties (`ms-`/`me-`/`ps-`/`pe-`/`border-e` instead of physical `ml-`/`mr-`/`pl-`/`pr-`/`border-r`) so a future `dir="rtl"` on the document root should reflow the sidebar-plus-chat grid correctly without per-component left/right patches. `index.html`'s `dir`/`lang` attributes still need to become dynamic when the toggle is built.
- **Fonts:** no CDN, no embedded font files. `--font-mono` and the Arabic pairing both declare a preference stack (JetBrains Mono / IBM Plex Mono / IBM Plex Sans Arabic first) but fall back to what's actually installed on this machine (`Noto Sans Mono`, `Noto Sans Arabic`, both confirmed present via `fc-list`) — the HUD mono look and the Arabic pairing both render correctly today off system fonts, and will pick up the preferred faces automatically if they're ever installed without a code change.
