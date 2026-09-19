#!/usr/bin/env python3
"""
Week 3: Smart Router
Maps tier → (model, voice), with Kokoro→Piper fallback on error.
Tier: local (fast) vs. quality (natural).
"""

import logging
import json
from pathlib import Path

logger = logging.getLogger('Router')

config_path = Path(__file__).parent.parent / 'config' / 'routing.json'
with open(config_path, 'r') as f:
    _routing = json.load(f)

# Tier definitions
TIERS = _routing.get("py_tiers", {})
FALLBACK_CHAINS = _routing.get("py_fallbacks", {})

class Router:
    """Resolve tier → (model, voice) with fallback logic."""
    
    def __init__(self):
        self.valid_tiers = list(TIERS.keys())
    
    def resolve(self, tier: str = "local", voice_override: str | None = None, 
                model_override: str | None = None) -> tuple[str, str]:
        if tier not in self.valid_tiers:
            raise ValueError(f"Invalid tier '{tier}'. Valid: {self.valid_tiers}")
        
        tier_config = TIERS[tier]
        
        model = model_override or tier_config["model"]
        voice = voice_override or tier_config["voice"]
        
        logger.info(f"Router: tier={tier}, model={model}, voice={voice}")
        return model, voice
    
    def get_fallback_voice(self, voice_id: str) -> str | None:
        return FALLBACK_CHAINS.get(voice_id)
    
    def local_tiers(self) -> list:
        return [t for t, cfg in TIERS.items() if not cfg.get("remote")]

    def list_tiers(self) -> dict:
        return TIERS

if __name__ == "__main__":
    router = Router()
    print("Available tiers:")
    for tier, cfg in router.list_tiers().items():
        print(f"  {tier:10} → model={cfg['model']:15} voice={cfg['voice']}")
