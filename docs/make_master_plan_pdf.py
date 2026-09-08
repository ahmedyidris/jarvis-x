"""Build the Jarvis X final plan PDF (docs/JARVIS_X_MASTER_PLAN_v3.pdf).

The PDF is committed, but so is this: a binary in the repo that nobody can
regenerate goes stale silently. Requires reportlab (pip install reportlab).

    python3 docs/make_master_plan_pdf.py

Content is authored for print rather than converted from markdown, so the
typography and table layout are controlled directly.

No Unicode subscripts/superscripts or emoji: ReportLab's built-in fonts use
WinAnsi encoding and render missing glyphs as solid black boxes. Superscripts
use <super> tags; arrows and >= are spelled out.
"""

import os
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "JARVIS_X_MASTER_PLAN_v3.pdf")

INK = colors.HexColor("#12161c")
MUTED = colors.HexColor("#5b6673")
RULE = colors.HexColor("#d4dae1")
BAND = colors.HexColor("#f2f5f8")
GOOD = colors.HexColor("#1c6b45")
BAD = colors.HexColor("#a32b2b")
WARN = colors.HexColor("#8a5a12")
ACCENT = colors.HexColor("#1f4e79")

ss = getSampleStyleSheet()


def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.2, leading=13.4,
                textColor=INK, alignment=TA_LEFT, spaceAfter=5)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "title": style("title", fontName="Helvetica-Bold", fontSize=25, leading=29,
                   spaceAfter=4),
    "subtitle": style("subtitle", fontSize=11.5, leading=16, textColor=MUTED,
                      spaceAfter=16),
    "h1": style("h1", fontName="Helvetica-Bold", fontSize=14.5, leading=18,
                textColor=ACCENT, spaceBefore=17, spaceAfter=7),
    "h2": style("h2", fontName="Helvetica-Bold", fontSize=10.8, leading=14,
                spaceBefore=11, spaceAfter=4),
    "body": style("body"),
    "small": style("small", fontSize=8.2, leading=11.6, textColor=MUTED),
    "cell": style("cell", fontSize=8.1, leading=10.8, spaceAfter=0),
    "cellb": style("cellb", fontSize=8.1, leading=10.8, spaceAfter=0,
                   fontName="Helvetica-Bold"),
    "cellh": style("cellh", fontSize=7.8, leading=10.2, spaceAfter=0,
                   fontName="Helvetica-Bold", textColor=colors.white),
    "verdict": style("verdict", fontSize=10.4, leading=15,
                     fontName="Helvetica-Bold"),
    "coverlab": style("coverlab", fontSize=9, leading=13, textColor=MUTED,
                      alignment=TA_CENTER),
}


def P(text, key="body"):
    return Paragraph(text, S[key])


def bullets(items, key="body"):
    out = []
    for it in items:
        out.append(Paragraph(
            f'<bullet>&bull;</bullet>{it}', ParagraphStyle(
                "b", parent=S[key], leftIndent=11, bulletIndent=2,
                spaceAfter=3.5)))
    return out


def table(header, rows, widths, aligns=None, highlight=None):
    """highlight: {(row_idx, col_idx): color} applied to body cells."""
    data = [[Paragraph(h, S["cellh"]) for h in header]]
    for r_i, row in enumerate(rows):
        cells = []
        for c_i, cell in enumerate(row):
            txt = str(cell)
            # *emphasis* -> bold, anywhere in the cell rather than only when it
            # wraps the whole string, so mid-sentence markers don't leak through
            # as literal asterisks.
            txt = re.sub(r"\*([^*]+)\*", r"<b>\1</b>", txt)
            para = Paragraph(txt, S["cell"])
            if highlight and (r_i, c_i) in highlight:
                plain = txt.replace("<b>", "").replace("</b>", "")
                para = Paragraph(
                    f'<font color="#{highlight[(r_i, c_i)].hexval()[2:]}">'
                    f'<b>{plain}</b></font>', S["cell"])
            cells.append(para)
        data.append(cells)

    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), BAND))
    if aligns:
        for col, al in aligns.items():
            cmds.append(("ALIGN", (col, 1), (col, -1), al))
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle(cmds))
    return t


def callout(text, color=WARN):
    t = Table([[Paragraph(text, S["cell"])]], colWidths=[168 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fbf6ec")),
        ("BOX", (0, 0), (-1, -1), 0.5, color),
        ("LINEBEFORE", (0, 0), (0, -1), 2.6, color),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


story = []
A = story.append

# ------------------------------------------------------------------ cover
A(Spacer(1, 44 * mm))
A(Paragraph("Jarvis X", S["title"]))
A(Paragraph("Master Plan v3 &mdash; with Quantum AI Feasibility Study",
            S["subtitle"]))
A(Table([[""]], colWidths=[168 * mm], rowHeights=[1.4],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)])))
A(Spacer(1, 9 * mm))
A(table(
    ["", ""],
    [["*Date*", "3 September 2026"],
     ["*Supersedes*", "MASTER_PLAN_UPDATED.md (2026-08-12), PLAN.md"],
     ["*Evidence base*", "AS_BUILT.md, QUANTUM_FEASIBILITY.md, "
                         "docs/triage/2026-09-repo-triage.md"],
     ["*Completion*", "*62%* under the runbook's phase weights"],
     ["*Quantum verdict*", "Build as a gated research track; keep out of the "
                           "request path"],
     ["*Reproduce*", "python3 -m quantum.benchmark"]],
    [34 * mm, 134 * mm]))
A(Spacer(1, 10 * mm))
A(callout(
    "<b>Every number in this document was measured, not estimated.</b> The "
    "measuring code is committed in <font face='Courier'>quantum/</font> so "
    "any claim here can be re-run and disputed. Where a figure rests on "
    "judgment rather than an instrument, it says so.", ACCENT))
A(Spacer(1, 6 * mm))
A(Paragraph("Prepared for Ahmed Yidris", S["coverlab"]))
A(PageBreak())

# -------------------------------------------------------- 1. verdict table
A(P("1. Verdict first", "h1"))
A(P("Seven questions, seven measured answers. Section references point into "
    "QUANTUM_FEASIBILITY.md."))
A(Spacer(1, 2))
A(table(
    ["Question", "Answer", "Evidence"],
    [["Can a quantum simulator run locally with no API?",
      "*Yes, comfortably*", "8 qubits in 9 ms, ~0 MB"],
     ["How many qubits fit in a request path?",
      "*About 16*", "16q = 32 ms; 24q = 8.4 s"],
     ["Does the 'LLM -&gt; circuit -&gt; tone' design work?",
      "*No. It computes cos(theta)*",
      "matches closed form to 1.45x10<super>-16</super>"],
     ["Does a real trainable VQC beat what ships today?",
      "*No. 0.273 vs 0.500*", "head-to-head, section 4"],
     ["Is the blocker qubits, features, or data?",
      "*Data. 64 queries*", "0.595 train / 0.273 test"],
     ["Should it enter the request path now?",
      "*No. 889x slower, less accurate*", "head-to-head, section 4"],
     ["Is it worth building anyway?",
      "*Yes, as a gated track*", "section 6"]],
    [64 * mm, 50 * mm, 54 * mm],
    highlight={(0, 1): GOOD, (2, 1): BAD, (3, 1): BAD, (5, 1): BAD,
               (6, 1): GOOD}))

# ------------------------------------------------------------- 2. hardware
A(P("2. Hardware &mdash; settled from the repo's own record", "h1"))
A(P("The runbook called this open across four candidate machines. The repo "
    "answers it: <font face='Courier'>MASTER_PLAN_UPDATED.md:45</font>, "
    "sourced from <font face='Courier'>WEEK_1_COMPLETE.md</font>, records a "
    "verified profile."))
A(Spacer(1, 2))
A(table(
    ["Property", "Value", "Source"],
    [["Machine", "Asus Chromebook", "WEEK_1_COMPLETE.md"],
     ["CPU", "Intel i5-1135G7, 8 vCPU", "same"],
     ["RAM", "*14 GB*", "corroborated by JARVIS X v2.pdf diagnostics"],
     ["GPU", "none", "same"],
     ["OS", "Crostini, Debian 12, kernel 6.6.119", "same"],
     ["Ollama", "0.32.9, qwen2.5:7b + 3b", "same"]],
    [30 * mm, 68 * mm, 70 * mm]))
A(Spacer(1, 4))
A(callout(
    "<b>The 7.7 GB figure described a different machine.</b> "
    "<font face='Courier'>00-repo-spec.md</font> documents a Lenovo Y50-70, "
    "not the dev box. That single mismatch generated most of the "
    "four-machine confusion. Model sizing should assume <b>14 GB, no "
    "GPU</b>. This does not overturn the runbook's verdict on local coding "
    "models: 7B-14B at long context remains out of reach on CPU, and the "
    "RTX 3060 12 GB is still the unlock."))

# --------------------------------------------------------- 3. completion
A(PageBreak())
A(P("3. Completion: 62%", "h1"))
A(P("One number, derived from the runbook's phase weights. <b>The weights are "
    "the runbook's; the per-phase scores are judgment anchored to cited "
    "evidence, not measurements</b> &mdash; so 62% is a defensible estimate, "
    "not a reading off an instrument."))
A(Spacer(1, 2))
A(table(
    ["Phase", "Weight", "Score", "Contrib.", "Basis"],
    [["Planning", "15", "90%", "13.5",
      "CONSTITUTION, 4 decision records, AS_BUILT, this plan, triage: all current"],
     ["Setup", "10", "85%", "8.5",
      "Toolchain, Ollama + 4 models, Piper/Kokoro voices, Docker healthy, CI green"],
     ["Build", "45", "60%", "27.0",
      "Verified: path jail, validation 23/23, data layer, scheduler, i18n/a11y, "
      "voice routing, model-gateway 47/47, jj CLI, FastAPI app, TTS engine. "
      "Stubbed: Electron (3 files), jj status"],
     ["Test", "20", "45%", "9.0",
      "13/19 JS files pass but <b>6 unmeasured</b>; test-guard and test-shell "
      "have <b>zero assertions</b>; Python suites need deps; E2E is one script"],
     ["Delivery", "10", "40%", "4.0",
      "Docker works; .deb ships an empty /opt/jarvis-x; remote access is "
      "git-only; web/ builds"],
     ["*Total*", "*100*", "", "*62.0%*", ""]],
    [21 * mm, 15 * mm, 14 * mm, 18 * mm, 100 * mm],
    aligns={1: "CENTER", 2: "CENTER", 3: "CENTER"}))
A(Spacer(1, 4))
A(P("Why not 91%", "h2"))
A(P("That figure was <font face='Courier'>scripts/status.sh</font>'s 22/24 "
    "milestones &mdash; and <b>17 of its 24 checks are bare file-existence "
    "tests</b>. One of them passed happily while "
    "<font face='Courier'>code/shell.js</font> held the jail escape fixed in "
    "PR #2. It measured file presence, not function."))
A(Spacer(1, 3))
A(P("The four historical figures were measuring four different things:"))
A(Spacer(1, 2))
A(table(
    ["Figure", "What it actually measured"],
    [["91% (22/24)", "status.sh milestones, 17 of which are file-existence checks"],
     ["49/49", "status.sh <b>checks</b>. The doc calling them 'unit tests' is wrong"],
     ["11/11", "the JS suite <b>when it had 11 test files</b>. It now has 19"],
     ["47/47", "packages/model-gateway's own suite only"]],
    [30 * mm, 138 * mm]))
A(Spacer(1, 4))
A(P("<b>Biggest uncertainty:</b> Build and Test. Six subsystems (Ollama "
    "vision, three voice paths, Kokoro, live data) are <i>unmeasured</i> "
    "rather than known-broken. If they pass on the real machine, Test rises "
    "materially and the total lands nearer 70%.", "body"))

# ------------------------------------------------- 4. quantum feasibility
A(PageBreak())
A(P("4. Quantum AI feasibility", "h1"))

A(P("4.1 The hardware envelope", "h2"))
A(P("Each qubit doubles the state vector, so cost is exponential and the wall "
    "arrives abruptly. Between 20 and 24 qubits, latency grows 42x and memory "
    "16x. No configuration or threading trick changes the shape of this "
    "curve &mdash; it is what simulating 2<super>n</super> amplitudes costs."))
A(Spacer(1, 2))
A(table(
    ["Qubits", "State vector", "Latency", "Peak memory", "Usable where"],
    [["2", "4", "3.9 ms", "~0 MB", "anywhere"],
     ["4", "16", "5.7 ms", "~0 MB", "anywhere"],
     ["8", "256", "9.3 ms", "~0 MB", "*request path*"],
     ["12", "4,096", "14.4 ms", "0.2 MB", "*request path*"],
     ["16", "65,536", "31.9 ms", "3.2 MB", "*request path, at the edge*"],
     ["18", "262,144", "69.7 ms", "12.6 MB", "background only"],
     ["20", "1,048,576", "199.6 ms", "50.4 MB", "background only"],
     ["22", "4,194,304", "1,123 ms", "201 MB", "batch / offline"],
     ["24", "16,777,216", "8,355 ms", "805 MB", "*unusable*"]],
    [18 * mm, 30 * mm, 24 * mm, 27 * mm, 69 * mm],
    aligns={0: "CENTER", 1: "RIGHT", 2: "RIGHT", 3: "RIGHT"},
    highlight={(8, 4): BAD, (2, 4): GOOD, (3, 4): GOOD}))
A(Spacer(1, 4))
A(callout(
    "<b>Measured in a cloud container</b> (4 x Xeon @ 2.10 GHz, 15 GB), "
    "<b>not on the Chromebook</b>. The <i>shape</i> of the curve transfers "
    "&mdash; it is set by 2<super>n</super>, not by the CPU &mdash; but "
    "absolute milliseconds do not. Expect the Chromebook to be slower, which "
    "<i>tightens</i> the 16-qubit ceiling rather than loosening it."))

A(P("4.2 Why the proposed design does not work", "h2"))
A(P("The circulating design has an LLM emit two numbers, feeds them as "
    "rotation angles into a 2-qubit circuit, and thresholds the measurement "
    "to pick a response tone. The circuit has <b>no trainable "
    "parameters</b>, so it has a closed form:"))
A(Spacer(1, 2))
A(table(
    ["urgency", "complexity", "qubit 0", "cos(u)", "qubit 1", "cos(u)cos(c)"],
    [["0.500", "1.000", "0.877583", "0.877583", "0.474160", "0.474160"],
     ["1.000", "2.000", "0.540302", "0.540302", "-0.224845", "-0.224845"],
     ["2.000", "0.300", "-0.416147", "-0.416147", "-0.397560", "-0.397560"],
     ["3.140", "3.140", "-0.999999", "-0.999999", "0.999997", "0.999997"]],
    [22 * mm, 26 * mm, 28 * mm, 28 * mm, 30 * mm, 34 * mm],
    aligns={0: "RIGHT", 1: "RIGHT", 2: "RIGHT", 3: "RIGHT", 4: "RIGHT",
            5: "RIGHT"}))
A(Spacer(1, 4))
A(P("<b>Maximum deviation: 1.45 x 10<super>-16</super></b> &mdash; "
    "floating-point noise. It also returned <b>one distinct result across 200 "
    "identical calls</b>: fully deterministic, no sampling, no superposition "
    "exploited, nothing an <font face='Courier'>if</font> statement could not "
    "do more cheaply. This finding is pinned as an executable test "
    "(<font face='Courier'>test_naive_circuit_is_just_cosine</font>) so the "
    "pattern cannot quietly return."))

A(PageBreak())
A(P("4.3 The feature-budget trap, and the way out", "h2"))
A(P("<font face='Courier'>AngleEmbedding</font> spends <b>one qubit per "
    "feature</b>, capping you at ~16 features in a request path &mdash; "
    "hopeless for text, where the seed dataset alone has a 142-word "
    "vocabulary. At 8 dimensions, <b>134 of 142 vocabulary words collide</b>, "
    "so that path does not merely underperform: it destroys the input."))
A(Spacer(1, 2))
A(table(
    ["Feature dimensions", "8", "16", "32", "64", "128", "256", "512"],
    [["Classical test accuracy", "0.273", "0.227", "0.273", "0.364",
      "*0.409*", "0.364", "0.318"],
     ["Hash collisions (142 words)", "134", "126", "111", "88", "58", "32",
      "19"]],
    [52 * mm, 16 * mm, 16 * mm, 16 * mm, 16 * mm, 17 * mm, 17 * mm, 17 * mm],
    aligns={i: "CENTER" for i in range(1, 8)}))
A(Spacer(1, 4))
A(P("<font face='Courier'>AmplitudeEmbedding</font> answers this: it packs "
    "2<super>n</super> features into n qubits, so 8 qubits carry <b>256</b> "
    "features rather than 8. The quantum feature budget is therefore "
    "<i>not</i> the blocker &mdash; which is what makes the next result "
    "meaningful."))

A(P("4.4 The head-to-head", "h2"))
A(P("Task: route a query to one of four data-provider families. The baseline "
    "is <font face='Courier'>resolveQuery()</font> from "
    "<font face='Courier'>code/agent-data-integration.js</font> &mdash; "
    "<b>the code that ships today</b>. Both learned models consume identical "
    "features. 64 queries, 42 train / 22 test. Accuracy is split by query "
    "kind because the aggregate hides the story."))
A(Spacer(1, 2))
A(table(
    ["Model", "Acc.", "on kw", "on para", "Train", "Inference", "Params"],
    [["*keyword matcher (ships today)*", "*0.500*", "*1.000*", "0.000", "--",
      "*0.005 ms*", "0"],
     ["classical softmax (256 feats)", "0.364", "0.364", "*0.364*", "0.04 s",
      "0.012 ms", "1,028"],
     ["quantum VQC (8q/2L, amplitude)", "0.273", "0.273", "0.273", "*142 s*",
      "*10.3 ms*", "48"]],
    [56 * mm, 15 * mm, 15 * mm, 17 * mm, 17 * mm, 24 * mm, 18 * mm],
    aligns={1: "CENTER", 2: "CENTER", 3: "CENTER", 4: "RIGHT", 5: "RIGHT",
            6: "RIGHT"},
    highlight={(2, 4): BAD, (2, 5): BAD}))
A(Spacer(1, 4))
A(P("<b>The quantum classifier loses on every axis at once:</b> less accurate "
    "than a zero-parameter keyword matcher, <b>889x slower</b> per inference "
    "than classical logistic regression, and <b>3,297x slower</b> to train."))
A(Spacer(1, 2))
A(P("It was steel-manned before that conclusion. It got amplitude embedding "
    "(256 features, not 8), backprop gradients instead of parameter-shift "
    "(~100x cheaper), and entangling layers with genuinely trainable weights. "
    "It still lost."))
A(Spacer(1, 3))
A(P("What the split reveals", "h2"))
A(*[]) if False else None
for b in bullets([
    "The keyword matcher is <b>perfect on keyword queries and scores zero on "
    "paraphrases</b> &mdash; it returned null on <b>11 of 11</b>. Its "
    "weakness is real and precisely located.",
    "Both learned models score 0.27-0.36 <i>uniformly</i> across both kinds. "
    "They have not learned the task; they sit near the 0.25 chance line.",
    "The VQC reached <b>0.595 train / 0.273 test</b> &mdash; textbook "
    "overfitting on 42 samples.",
]):
    A(b)
A(Spacer(1, 3))
A(callout(
    "<b>So the binding constraint is training data, not quantum versus "
    "classical.</b> With 64 hand-written queries, no classifier of any kind "
    "beats the keyword matcher. Buying better hardware or adding qubits would "
    "not change this result.", BAD))

# ------------------------------------------- 5. three interpretations
A(PageBreak())
A(P("5. What 'best local quantum AI model' can mean", "h1"))
A(P("Three separate goals get conflated under that phrase, and they have "
    "different verdicts."))
A(Spacer(1, 2))
A(table(
    ["Interpretation", "Verdict"],
    [["*Run QML locally with no API*",
      "<b>Done.</b> PennyLane simulates on CPU, offline, free. Section 4.1 is "
      "the envelope."],
     ["*A quantum model that improves Jarvis today*",
      "<b>Not supported by the data</b> (section 4.4). Revisit when the "
      "dataset is 100x bigger."],
     ["*A 'quantum LLM' replacing Ollama*",
      "<b>Not physically available.</b> A 1B-parameter model needs ~10<super>9"
      "</super> trained parameters; the largest circuits simulable here hold "
      "~48. No hardware, quantum or classical, runs a transformer as a "
      "quantum circuit today."]],
    [62 * mm, 106 * mm]))
A(Spacer(1, 4))
A(P("On the suggested model", "h2"))
A(P("<font face='Courier'>NeuroEquality/neuralquantum-coder</font> <b>does "
    "exist</b> on Ollama. But its published description is a generic coding "
    "assistant &mdash; 'clear, actionable, technically accurate solutions... "
    "performance, security, and best practices' &mdash; with no published "
    "parameter count or base model, reading like a system-prompt wrapper. "
    "Nothing found supports the claim that it reasons about quantum "
    "structures; 'NeuralQuantum' is the vendor's brand. <b>Treat as "
    "unverified:</b> the model card could not be read directly, as egress to "
    "ollama.com and huggingface.co is blocked from the build environment."))

# ------------------------------------------------------ 6. recommendation
A(P("6. Recommendation: build it, gate it, let data promote it", "h1"))
A(P("Not 'do not build this'. The module is committed and working. But it "
    "earns the request path by measurement, not by intent."))
A(Spacer(1, 3))
A(P("Shipped now", "h2"))
for b in bullets([
    "<font face='Courier'>quantum/</font> with a real trainable VQC, both "
    "baselines, and the benchmark harness",
    "31 correctness checks, no accuracy assertions",
    "PennyLane isolated to <font face='Courier'>quantum/requirements.txt</font>; "
    "nothing on the serving path imports it",
    "The cos(theta) finding pinned as an executable regression test",
]):
    A(b)
A(Spacer(1, 3))
A(P("Promotion gate &mdash; all four, or it stays out", "h2"))
A(Spacer(1, 2))
A(table(
    ["#", "Gate"],
    [["1", "Dataset of 500 or more real queries from "
            "<font face='Courier'>logs/queue.jsonl</font>, not hand-written"],
     ["2", "VQC test accuracy <b>beats the keyword matcher</b> on the same split"],
     ["3", "VQC <b>beats classical softmax</b> on identical features"],
     ["4", "p95 inference <b>under 50 ms</b> on Ahmed's actual hardware"]],
    [10 * mm, 158 * mm]))
A(Spacer(1, 3))
A(callout(
    "<b>Gate 3 is the one that matters.</b> If quantum and classical tie, the "
    "answer is classical: same accuracy at 1/889th the cost. A quantum result "
    "without a classical control is unfalsifiable &mdash; you cannot tell "
    "whether the circuit helped or the features were simply learnable.",
    ACCENT))
A(Spacer(1, 4))
A(P("<b>Do not pursue:</b> circuits above 16 qubits for anything user-facing "
    "(4.1), a parameterless circuit in a decision path (4.2), or "
    "<font face='Courier'>AngleEmbedding</font> for text (4.3)."))

# ------------------------------------------------------- 7. conflicts
A(PageBreak())
A(P("7. Where the plan meets the hard constraints", "h1"))
A(Spacer(1, 2))
A(table(
    ["Conflict", "Status"],
    [["*Paper trading*",
      "<b>Ruled 2026-09-04: delete.</b> code/paper-trading.js and "
      "config/trading.json removed; CONSTITUTION.md section IV now forbids "
      "trading of any kind, real or simulated, rather than permitting a "
      "testnet carve-out. Git history retains the code."],
     ["*Remote access via 0.0.0.0*",
      "<b>Rejected.</b> Every binding in the repo is deliberately 127.0.0.1, "
      "port 8000 is already held by the live deployment, and the runbook "
      "forbids exposure. Git stays the sync layer."],
     ["*Local coding models replacing Claude Code*",
      "Unchanged: not viable on CPU. Gemini CLI free tier is the "
      "out-of-limit answer."],
     ["*JX_NET gating*",
      "<b>Ruled 2026-09-04: gate it.</b> Implemented in code/test-net.js; the "
      "network test skips unless JX_NET=1, and jest-runner.js counts skips in "
      "their own column so a skip can never read as a pass."],
     ["*Quantum in the request path*",
      "<b>Rejected on measurement:</b> 889x slower and less accurate than the "
      "shipped keyword matcher. Kept as a gated research track."]],
    [52 * mm, 116 * mm]))

# -------------------------------------------------------- 8. task plan
A(P("8. Re-sequenced work, in 1-3 hour tasks", "h1"))
A(callout(
    "<b>Income work first.</b> Per Ahmed's own operating rules: if "
    "Outlier/Upwork hours are not done this week, they precede everything "
    "below.", WARN))
A(Spacer(1, 4))
A(P("Tier 1 &mdash; buy real information (do these first)", "h2"))
A(Spacer(1, 2))
A(table(
    ["#", "Task", "Hrs", "Why it is first", "Done when"],
    [["1", "*Run the JS suite on the dev machine*", "0.5",
      "Converts 6 unmeasured subsystems into knowns. Highest information per "
      "minute in the plan.", "Output pasted; AS_BUILT updated"],
     ["2", "Confirm hardware with the Session 1 script", "0.25",
      "Closes section 2 empirically", "~/PROFILE.md exists"],
     ["3", "Rule on paper trading and JX_NET", "0.25",
      "Two one-line answers unblock section 7", "Rulings recorded"],
     ["4", "Give test-guard and test-shell real assertions", "1.5",
      "Both have <b>zero</b> assertions and pass unconditionally. test-shell "
      "is the file that would have caught the jail escape.",
      "Both assert; both fail if reverted"]],
    [8 * mm, 44 * mm, 11 * mm, 60 * mm, 45 * mm],
    aligns={0: "CENTER", 2: "CENTER"}))
A(Spacer(1, 5))
A(P("Tier 2 &mdash; close the real gaps", "h2"))
A(Spacer(1, 2))
A(table(
    ["#", "Task", "Hrs", "Why", "Done when"],
    [["5", "Make the .deb ship app.py", "2",
      "Currently installs an empty /opt/jarvis-x; the launcher cannot work",
      "dpkg -i then launch succeeds"],
     ["6", "Decide JX_NET: gate or make offline-capable", "1.5",
      "Makes the suite deterministic offline", "19/19 or an explicit skip contract"],
     ["7", "Real jj status", "2",
      "Prints a hardcoded ready message today; Session 6 wants live quota",
      "Shows per-provider quota and health"],
     ["8", "Per-provider quota counters in SQLite", "3",
      "Session 6 proper: free-tier ceilings with 429 fallback",
      "Counters persist; fallback verified"],
     ["9", "Install Piper voices / Ollama where task 1 showed gaps", "1-2",
      "Turns unmeasured into passing", "Formerly-failing tests pass"]],
    [8 * mm, 44 * mm, 11 * mm, 60 * mm, 45 * mm],
    aligns={0: "CENTER", 2: "CENTER"}))
A(Spacer(1, 5))
A(P("Tier 3 &mdash; extend", "h2"))
A(Spacer(1, 2))
A(table(
    ["#", "Task", "Hrs", "Why", "Done when"],
    [["10", "*Build the 500-query dataset from logs/queue.jsonl*", "2",
      "Quantum gate 1 &mdash; and it improves the <b>classical</b> router "
      "regardless", "quantum/data/ has 500+ real queries"],
     ["11", "Re-run the benchmark on the real dataset", "1",
      "Lets gates 2-4 decide on evidence", "Results appended to the study"],
     ["12", "Electron shell to a launchable app", "3",
      "3 files today", "Window opens, talks to the API"],
     ["13", "E2E flow test", "2.5",
      "One script today", "Ask -&gt; answer -&gt; audio, asserted"]],
    [8 * mm, 44 * mm, 11 * mm, 60 * mm, 45 * mm],
    aligns={0: "CENTER", 2: "CENTER"}))
A(Spacer(1, 4))
A(P("<b>Explicitly not scheduled:</b> local 7B+ coding models, LAN or "
    "internet exposure, a quantum model in the request path, or quantum "
    "circuits above 16 qubits for anything user-facing."))

# --------------------------------------------------------- 9. limits
A(PageBreak())
A(P("9. Known limits of this study", "h1"))
A(P("Stated plainly, so nothing here is over-read."))
A(Spacer(1, 2))
for b in bullets([
    "<b>The dataset is 64 hand-written queries.</b> It is a seed, not a "
    "benchmark. A larger real-traffic dataset could change section 4.4 "
    "&mdash; which is exactly what gate 1 tests.",
    "<b>Hardware numbers come from a cloud container</b>, not the target "
    "machine (section 4.1).",
    "<b>One circuit architecture tested</b> "
    "(StronglyEntanglingLayers, 1-2 layers, 8 qubits). Other ansatze exist; "
    "none was tried.",
    "<b>One task tested</b> (4-way intent routing). QAOA-style optimization "
    "for the scheduler was <i>not</i> measured &mdash; though section 4.1 "
    "caps it at ~16 items, a size classical exact solving handles trivially.",
    "<b>Simulation only.</b> No real quantum hardware, which would need the "
    "cloud APIs this design explicitly avoids.",
    "<b>Not measured:</b> accuracy at the 11-key granularity resolveQuery "
    "actually returns; only the 4-family collapse was tested.",
    "<b>The 62% completion figure blends measurement with judgment</b> "
    "(section 3). The phase weights are the runbook's; the per-phase scores "
    "are reasoned from cited evidence, not read off an instrument.",
]):
    A(b)
A(Spacer(1, 6))
A(P("What would change this plan", "h1"))
A(Spacer(1, 2))
for b in bullets([
    "<b>Task 1's output.</b> If the 6 unmeasured subsystems pass, completion "
    "moves to ~70% and Tier 2 shrinks. If they fail on the real machine too, "
    "they become Tier 1 bugs.",
    "<b>A ruling against paper trading.</b> Deletes two files and needs a "
    "CONSTITUTION amendment.",
    "<b>The RTX 3060 12 GB.</b> Unlocks local 14B coding models <i>and</i> "
    "lifts the quantum ceiling from 16 to 24+ qubits &mdash; the one purchase "
    "that changes two constraints at once.",
    "<b>Task 10's dataset.</b> The single input most likely to overturn the "
    "head-to-head result.",
]):
    A(b)
A(Spacer(1, 8))
A(Table([[""]], colWidths=[168 * mm], rowHeights=[0.7],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), RULE)])))
A(Spacer(1, 3))
A(P("Method follows AS_BUILT.md: every claim cites a command, and anything "
    "unverified is labelled unverified rather than estimated. Superseded "
    "plans keep their history &mdash; MASTER_PLAN_UPDATED.md and PLAN.md are "
    "archived, not deleted.", "small"))


# --------------------------------------------------------------- render
def decorate(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setFont("Helvetica", 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(21 * mm, 12 * mm, "Jarvis X - Master Plan v3")
        canvas.drawRightString(189 * mm, 12 * mm, f"Page {page}")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(21 * mm, 15.5 * mm, 189 * mm, 15.5 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, title="Jarvis X - Master Plan v3",
                      author="Ahmed Yidris", leftMargin=21 * mm,
                      rightMargin=21 * mm, topMargin=18 * mm,
                      bottomMargin=20 * mm)
frame = Frame(21 * mm, 20 * mm, 168 * mm, A4[1] - 38 * mm, id="body")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame],
                                   onPage=decorate)])
doc.build([s for s in story if s is not None])
print(f"wrote {OUT}")
