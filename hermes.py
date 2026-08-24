#!/usr/bin/env python3
"""
HERMES CORE (Week 2) + ROUTER (Week 3)
Updated CLI with --tier, --voice, --speak flags
"""

import os
import sqlite3
import json
import subprocess
import sys
import argparse
import logging
from datetime import datetime
from pathlib import Path

# Import router
sys.path.insert(0, str(Path(__file__).parent / "code"))
from router import Router

logging.basicConfig(level=logging.INFO, format='[%(name)s] %(message)s')
logger = logging.getLogger('Hermes')


class HermesBackendError(Exception):
    """The LLM backend (Ollama) itself failed or was unreachable -- distinct
    from a normal (if terse) answer. Callers that only check for a truthy
    string can't tell those apart otherwise (REMAINING_WORK.md P6): a caller
    checking just the HTTP status code, or just `if response`, saw the same
    shape for "backend is down" as for "model answered oddly"."""

# Setup
DB_PATH = Path.home() / ".hermes" / "state.db"
DB_PATH.parent.mkdir(exist_ok=True)
AUDIO_DIR = DB_PATH.parent / "audio"
AUDIO_DIR.mkdir(exist_ok=True)

router = Router()

class HermesCore:
    def __init__(self):
        self.db = sqlite3.connect(str(DB_PATH))
        self.db.row_factory = sqlite3.Row
        self.init_db()
    
    def init_db(self):
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                user_input TEXT NOT NULL,
                response TEXT NOT NULL,
                model TEXT NOT NULL,
                latency_ms INTEGER,
                voice_id TEXT,
                audio_path TEXT
            )
        """)
        self.db.commit()
    
    PROJECT_TERMS = (
        "jarvis", "hermes", "vertical", "dashboard", "pipeline", "electron",
        "ollama", "piper", "whisper", "agent", "audit", "kill switch",
        "this system", "this project", "you built", "we built", "your code",
    )

    REPO_TERMS = (
        "file", "module", "which code", "where is", "where does", "what does",
        "handles", "implemented", "function", "script", ".js", ".py", "repo",
        "codebase", "directory", "folder",
    )

    @staticmethod
    def _module_index():
        """One line per module, from its own opening docstring/comment.

        Generated from the filesystem, never hand-maintained, so it cannot
        drift the way a written description would. Cached on disk and
        rebuilt when any source file is newer than the cache.
        """
        # Files that open with requires/constants rather than a docstring:
        # the extractor falls through to the first inline comment, which
        # describes one line of setup, not the module. guard.js came out as
        # "Ensure logs directory exists" -- so asked which file handles the
        # kill switch, the model had nothing pointing at guard.js and
        # answered with the sentinel file instead. 2 of 50 need this.
        OVERRIDES = {
            "code/guard.js": "kill switch (.jarvis-x-STOP) + append-only action audit log; every action routes through guard()",
            "code/paper-trading.js": "paper trading simulator -- simulated only, no real money anywhere in this system",
            # Named stop.js and sitting next to every kill-switch question,
            # but extracted as "if (cmd === 'off') {" -- a strong wrong
            # attractor with no description to contradict it.
            "code/stop.js": "CLI to toggle the kill switch on/off; the switch itself is enforced in guard.js",
        }
        root = Path(__file__).parent
        cache = root / "logs" / ".module-index.txt"
        sources = sorted(
            [f for f in (root / "code").glob("*.js") if not f.name.startswith("test-")]
            + list((root / "code").glob("*.py"))
            + [root / "hermes.py", root / "app.py"]
        )
        sources = [f for f in sources if f.exists()]
        newest = max((f.stat().st_mtime for f in sources), default=0)
        try:
            if cache.exists() and cache.stat().st_mtime >= newest:
                return cache.read_text().strip()
        except OSError:
            pass

        lines = []
        for f in sources:
            desc = ""
            try:
                for ln in f.read_text(errors="ignore").splitlines()[:12]:
                    t = ln.strip().lstrip('#/*" ').strip()
                    # Skip shebangs, imports, and the bare filename echoed
                    # back as a title -- none of those describe anything.
                    if (not t or t.startswith(("!", "import ", "from ", "const ", "require"))
                            or t.lower().startswith(f.name.lower())):
                        continue
                    if len(t) > 12:
                        # A one-line module docstring closes on the same line,
                        # leaving a trailing quote in the description.
                        desc = t.rstrip('"\' ').strip()[:90]
                        break
            except OSError:
                continue
            rel = f.relative_to(root)
            desc = OVERRIDES.get(str(rel), desc)
            lines.append(f"{rel}: {desc}" if desc else str(rel))

        out = "\n".join(lines)
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(out)
        except OSError:
            pass
        return out

    @staticmethod
    def _is_repo_question(question):
        q = question.lower()
        return any(t in q for t in HermesCore.REPO_TERMS)

    @staticmethod
    def _is_project_question(question):
        q = question.lower()
        return any(t in q for t in HermesCore.PROJECT_TERMS)

    def build_context(self, question, turns=3):
        """Prepend durable rules + recent turns to the question.

        Hermes wrote every exchange to `conversations` from day one and never
        read one back -- ask() sent the bare question, so it could not resolve
        a follow-up like "what about in Arabic?". recall() already fetched
        history; nothing fed it to the model.

        Rules come from memory/rules.md, the SAME file code/memory.js uses, so
        there is one source of durable truth rather than two that drift. That
        file's contract carries over: human-written, authoritative, and Hermes
        never writes it. The orphaned `memory` key/value table in state.db is
        from an abandoned attempt and stays unused.

        `turns` is small on purpose: this is CPU-only inference at ~9s cold,
        and every line of context is more tokens to chew through. Backend
        failures are skipped -- replaying "[BACKEND FAILURE]" as dialogue
        teaches the model to imitate it.
        """
        # rules.md grew to ~45 lines and pushed a warm query from 2.7s to
        # 30s -- every line is re-processed on CPU each time. Comment lines
        # and section headers carry no information the model needs, so strip
        # them and keep the bullets. Set JX_FULL_RULES=1 to send the whole
        # file when a question genuinely needs the detail.
        parts = []
        rules_path = Path(__file__).parent / "memory" / "rules.md"
        if rules_path.exists():
            raw = rules_path.read_text()
            # Even bullets-only left a warm query at 11s vs a 2.7s baseline:
            # ~30 lines of project detail re-tokenized for "what is 2+2". The
            # first three bullets (machine, paths, no-trading) are cheap and
            # always relevant; the rest is project detail only worth sending
            # when the question is actually about the project.
            bullets = [ln for ln in raw.splitlines() if ln.strip().startswith("-")]
            if os.environ.get("JX_FULL_RULES") == "1":
                rules = raw.strip()
            elif self._is_project_question(question):
                rules = "\n".join(bullets).strip()
            else:
                rules = "\n".join(bullets[:3]).strip()
            if rules:
                parts.append(f"CONTEXT (authoritative facts about the user and this system):\n{rules}")

        # First attempt fed architecture.md's headings here. That is
        # structural ("three separate systems, one repo") and answers "how is
        # this organized", not "which file does X" -- asked which file handles
        # the kill switch, the model returned the sentinel FILE
        # (.jarvis-x-STOP) rather than the module that checks it
        # (code/guard.js), and took 24s to do it. What answers that question
        # is one line per module saying what the module does, which is
        # exactly what each file's opening docstring already contains.
        if self._is_repo_question(question):
            index = self._module_index()
            if index:
                parts.append("MODULES (file -> what it does):\n" + index)

        history = [r for r in reversed(self.recall(limit=turns * 2))
                   if not r["response"].startswith("[BACKEND FAILURE]")][-turns:]
        if history:
            lines = "\n".join(f"User: {h['user_input']}\nYou: {h['response']}" for h in history)
            # Labelled untrusted for the same reason code/memory.js splits
            # rules.md from observed.jsonl: without it a model treats its own
            # past output as established fact. Observed directly -- Hermes
            # answered the kill-switch question wrongly once, then repeated
            # that answer on every retry even after the correct information
            # was added to its context. A wrong answer became self-
            # reinforcing evidence.
            # First wording told the model its earlier replies "may be WRONG"
            # and that a conflict meant "your earlier reply was a mistake".
            # That over-corrected: asked "what is 2+2?", it spent 15s
            # apologising for an unrelated earlier answer about guard.js
            # instead of answering. The label needs to stop history being
            # treated as fact WITHOUT inviting the model to re-litigate it.
            parts.append(
                "EARLIER IN THIS CONVERSATION (for reference only -- use it to "
                "resolve what the user means by 'it' or 'that'. Do not comment "
                "on it, correct it, or apologise for it. If it disagrees with "
                "CONTEXT or MODULES above, silently follow those):\n" + lines)

        parts.append(f"Answer completely but concisely -- no padding.\n\nUser: {question}")
        return "\n\n".join(parts)

    def ask(self, question, model="qwen2.5:7b", context=True, turns=3):
        """Query model and store result.

        Raises HermesBackendError if Ollama itself failed or was unreachable
        (curl non-zero exit, timeout, or an unparseable/malformed response) --
        this is a hard backend failure, not an ordinary answer, so it must
        not come back as a plain string a caller could mistake for one.
        """
        logger.info(f"Querying {model}...")
        start = datetime.now()

        try:
            cmd = [
                # -s: no progress meter in stderr. -S: still show curl's own
                # error text even with -s. Bare -s alone (the original bug)
                # silenced both; bare -S alone (the first attempted fix)
                # showed the error but left the progress-meter table mixed
                # into stderr ahead of it. -sS is the combination that
                # actually gives just the error text.
                "curl", "-sS", "http://localhost:11434/api/generate",
                "-d", json.dumps({
                    "model": model,
                    "prompt": self.build_context(question, turns) if context else question,
                    "stream": False
                })
            ]
            if str(model).startswith("registry:"):
                # Registry lives in JS (one source of truth for providers);
                # Hermes already shells out for Ollama, so one more
                # subprocess is consistent and avoids a second Python
                # implementation that would drift.
                cmd = ["node", str(Path(__file__).parent / "code" / "providers" / "cli.js"),
                       model.split(":", 1)[1],
                       self.build_context(question, turns) if context else question]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)

            if result.returncode != 0:
                msg = result.stderr.strip() or f"curl exited {result.returncode} with no stderr"
                self._record_failure(question, model, latency_ms, msg)
                raise HermesBackendError(msg)

            response_data = json.loads(result.stdout)
            response = response_data.get("response", "No response").strip()

        except subprocess.TimeoutExpired:
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)
            self._record_failure(question, model, latency_ms, "Query timeout (120s)")
            raise HermesBackendError("Query timeout (120s)")
        except json.JSONDecodeError as e:
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)
            msg = f"Ollama returned unparseable response: {e}"
            self._record_failure(question, model, latency_ms, msg)
            raise HermesBackendError(msg)

        self.db.execute("""
            INSERT INTO conversations (timestamp, user_input, response, model, latency_ms)
            VALUES (?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            question,
            response,
            model,
            latency_ms
        ))
        self.db.commit()

        logger.info(f"[{latency_ms}ms] {model}")
        return response

    def _record_failure(self, question, model, latency_ms, reason):
        """Log a failed ask() to the same conversations table as a real
        answer, so a hard backend failure still leaves an audit-log trace
        (REMAINING_WORK.md P6 addendum: previously the early-return on
        failure skipped the INSERT entirely, so `~/.hermes/state.db` had no
        row at all for a failed call -- neither an HTTP-level nor an
        audit-log-level trace)."""
        logger.error(f"Backend failure querying {model}: {reason}")
        self.db.execute("""
            INSERT INTO conversations (timestamp, user_input, response, model, latency_ms)
            VALUES (?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            question,
            f"[BACKEND FAILURE] {reason}",
            model,
            latency_ms
        ))
        self.db.commit()
    
    def speak(self, text, voice_id, output_path=None):
        """Synthesize speech."""
        try:
            from code.tts_engine import get_engine
            engine = get_engine()
            
            audio_bytes, mime = engine.synthesize(text, voice_id)
            
            if output_path is None:
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                output_path = AUDIO_DIR / f"hermes-{voice_id}-{ts}.wav"
            
            with open(output_path, 'wb') as f:
                f.write(audio_bytes)
            
            logger.info(f"Audio: {output_path}")
            return str(output_path)
        
        except Exception as e:
            logger.error(f"TTS failed: {e}")
            return None
    
    def recall(self, limit=5):
        rows = self.db.execute("""
            SELECT timestamp, user_input, response, model, latency_ms, voice_id
            FROM conversations
            ORDER BY id DESC
            LIMIT ?
        """, (limit,)).fetchall()
        
        return [dict(row) for row in rows]
    
    def status(self):
        count = self.db.execute("SELECT COUNT(*) as c FROM conversations").fetchone()["c"]
        return {
            "status": "online",
            "version": "Hermes v2 (Core + Router)",
            "conversations": count,
            "db_path": str(DB_PATH),
            "available_tiers": list(router.valid_tiers)
        }
    
    def close(self):
        self.db.close()

def main():
    parser = argparse.ArgumentParser(
        description="Hermes: Local AI assistant with smart routing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  hermes "What is 2+2?"                           # local tier, text only
  hermes "Explain photosynthesis" --tier quality  # quality tier, text
  hermes "Hello" --speak                          # local + audio
  hermes "Hi" --tier quality --speak              # quality tier + audio
  hermes --status                                 # system status
  hermes --recall 10                              # last 10 conversations
        """
    )
    
    parser.add_argument('question', nargs='?', default=None, help='Question to ask')
    # Was a hardcoded list, so tiers added to router.py were unreachable
    # from the CLI. Read them from the router instead.
    parser.add_argument('--tier', choices=router.valid_tiers, default='local',
                       help='Model tier. local/quality run on this machine; '
                            'fast/smart/frontier route through cloud providers '
                            '(prompt leaves the machine), falling back to local.')
    parser.add_argument('--voice', type=str, default=None,
                       help='Voice ID (overrides tier default)')
    parser.add_argument('--model', type=str, default=None,
                       help='Explicit model (overrides tier default)')
    parser.add_argument('--speak', action='store_true',
                       help='Synthesize audio response')
    parser.add_argument('--status', action='store_true',
                       help='Show system status')
    parser.add_argument('--recall', type=int, nargs='?', const=5,
                       help='Show last N conversations (default: 5)')
    
    args = parser.parse_args()
    hermes = HermesCore()
    
    try:
        if args.status:
            print(json.dumps(hermes.status(), indent=2))
        
        elif args.recall is not None:
            conversations = hermes.recall(args.recall)
            for conv in conversations:
                print(f"\n[{conv['timestamp']}] ({conv['model']})")
                print(f"Q: {conv['user_input']}")
                print(f"A: {conv['response'][:80]}..." if len(conv['response']) > 80 else f"A: {conv['response']}")
        
        elif args.question:
            # Resolve tier → (model, voice)
            model, voice = router.resolve(args.tier, voice_override=args.voice, 
                                         model_override=args.model)
            
            # Get response. Catch broadly, not just HermesBackendError --
            # any exception here (including one this function didn't
            # anticipate) means no real answer was produced, and the CLI
            # should print a clean message and exit non-zero rather than an
            # unhandled traceback (matches the old behavior of returning an
            # "Error: ..." string, but distinguishable from a real answer).
            try:
                response = hermes.ask(args.question, model)
            except Exception as e:
                print(f"\nError: {e}\n", file=sys.stderr)
                sys.exit(1)
            print(f"\n{response}\n")
            
            # Synthesize if requested
            if args.speak:
                audio_path = hermes.speak(response, voice)
                if audio_path:
                    print(f"Audio saved: {audio_path}")
        
        else:
            parser.print_help()
    
    finally:
        hermes.close()

if __name__ == "__main__":
    main()
