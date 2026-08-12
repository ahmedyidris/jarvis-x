#!/usr/bin/env python3
"""
HERMES CORE — Week 2 Foundation
- Accepts questions via CLI
- Routes to qwen2.5 (local)
- Stores state in SQLite (restart-safe)
- Returns responses
"""

import sqlite3
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Setup
DB_PATH = Path.home() / ".hermes" / "state.db"
DB_PATH.parent.mkdir(exist_ok=True)

class HermesCore:
    def __init__(self):
        self.db = sqlite3.connect(str(DB_PATH))
        self.db.row_factory = sqlite3.Row
        self.init_db()
    
    def init_db(self):
        """Create tables if they don't exist"""
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                user_input TEXT NOT NULL,
                response TEXT NOT NULL,
                model TEXT NOT NULL,
                latency_ms INTEGER
            )
        """)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        self.db.commit()
    
    def ask(self, question, model="qwen2.5:7b"):
        """Send question to qwen2.5, get response, store in DB"""
        print(f"[Hermes] Querying {model}...")
        
        try:
            # Call Ollama via curl (direct API call)
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
            
            # Store in SQLite
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
            
            print(f"[{latency_ms}ms] {model}")
            return response
            
        except subprocess.TimeoutExpired:
            return "Error: Query timeout (120s)"
        except Exception as e:
            return f"Error: {str(e)}"
    
    def recall(self, limit=5):
        """Get recent conversations from SQLite"""
        rows = self.db.execute("""
            SELECT timestamp, user_input, response, model, latency_ms
            FROM conversations
            ORDER BY id DESC
            LIMIT ?
        """, (limit,)).fetchall()
        
        return [dict(row) for row in rows]
    
    def status(self):
        """Show Hermes status"""
        count = self.db.execute("SELECT COUNT(*) as c FROM conversations").fetchone()["c"]
        
        return {
            "status": "online",
            "version": "Hermes Core v1",
            "conversations": count,
            "db_path": str(DB_PATH),
            "models_available": ["qwen2.5:7b", "qwen2.5:3b"]
        }
    
    def close(self):
        self.db.close()

def main():
    hermes = HermesCore()
    
    if len(sys.argv) < 2:
        print("Usage: hermes.py '<question>' [model]")
        print("       hermes.py --status")
        print("       hermes.py --recall [limit]")
        print("")
        print(f"Database: {DB_PATH}")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "--status":
        print(json.dumps(hermes.status(), indent=2))
    
    elif cmd == "--recall":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        conversations = hermes.recall(limit)
        for conv in conversations:
            print(f"\n[{conv['timestamp']}] ({conv['model']}, {conv['latency_ms']}ms)")
            print(f"Q: {conv['user_input']}")
            print(f"A: {conv['response'][:100]}..." if len(conv['response']) > 100 else f"A: {conv['response']}")
    
    else:
        # Treat as question
        question = cmd
        model = sys.argv[2] if len(sys.argv) > 2 else "qwen2.5:7b"
        response = hermes.ask(question, model)
        print(f"\n{response}\n")
    
    hermes.close()

if __name__ == "__main__":
    main()
