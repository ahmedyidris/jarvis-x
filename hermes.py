#!/usr/bin/env python3
"""
HERMES CORE (Week 2) + ROUTER (Week 3)
Updated CLI with --tier, --voice, --speak flags
"""

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
        parts = []
        rules_path = Path(__file__).parent / "memory" / "rules.md"
        if rules_path.exists():
            rules = rules_path.read_text().strip()
            if rules:
                parts.append(f"CONTEXT (authoritative facts about the user and this system):\n{rules}")

        history = [r for r in reversed(self.recall(limit=turns * 2))
                   if not r["response"].startswith("[BACKEND FAILURE]")][-turns:]
        if history:
            lines = "\n".join(f"User: {h['user_input']}\nYou: {h['response']}" for h in history)
            parts.append(f"RECENT CONVERSATION:\n{lines}")

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
    parser.add_argument('--tier', choices=['local', 'quality'], default='local',
                       help='Model tier: local (fast) or quality (natural)')
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
