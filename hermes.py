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
    
    def ask(self, question, model="qwen2.5:7b"):
        """Query model and store result."""
        logger.info(f"Querying {model}...")
        
        try:
            cmd = [
                "curl", "-s", "http://localhost:11434/api/generate",
                "-d", json.dumps({
                    "model": model,
                    "prompt": question,
                    "stream": False
                })
            ]
            
            start = datetime.now()
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            latency_ms = int((datetime.now() - start).total_seconds() * 1000)
            
            if result.returncode != 0:
                return f"Error: {result.stderr}"
            
            response_data = json.loads(result.stdout)
            response = response_data.get("response", "No response").strip()
            
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
            
        except subprocess.TimeoutExpired:
            return "Error: Query timeout (120s)"
        except Exception as e:
            return f"Error: {str(e)}"
    
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
            
            # Get response
            response = hermes.ask(args.question, model)
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
