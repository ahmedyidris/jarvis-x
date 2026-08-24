#!/usr/bin/env python3
"""
Week 3: Smart Router
Maps tier → (model, voice), with Kokoro→Piper fallback on error.
Tier: local (fast) vs. quality (natural).
"""

import logging
from typing import Tuple, Optional
from pathlib import Path

logger = logging.getLogger('Router')

# Tier definitions
# local/quality are LOCAL Ollama tiers and stay that way -- they are a
# user-facing toggle in the dashboard sidebar, and silently redirecting
# either to a cloud provider would send conversation context off-machine
# without the user choosing that. The three cloud tiers below are additive
# and opt-in, routed through code/providers/registry.js.
TIERS = {
    "local": {
        "model": "qwen2.5:3b",
        "voice": "en_us_piper"
    },
    "quality": {
        "model": "qwen2.5:7b",
        "voice": "en_us_kokoro"
    },
    # Remote. Each falls back to Ollama if its providers are unavailable or
    # out of quota, so these never hard-fail -- but when they DO reach a
    # cloud provider, the prompt (including rules and conversation history)
    # leaves this machine.
    "fast": {
        "model": "registry:fast",
        "voice": "en_us_piper",
        "remote": True
    },
    "smart": {
        "model": "registry:smart",
        "voice": "en_us_piper",
        "remote": True
    },
    "frontier": {
        "model": "registry:quality",
        "voice": "en_us_piper",
        "remote": True
    }
}

# Fallback chains (if Kokoro fails, try Piper for that language)
FALLBACK_CHAINS = {
    "en_us_kokoro": "en_us_piper",
    "en_gb_kokoro": "en_gb_piper",
}

class Router:
    """Resolve tier → (model, voice) with fallback logic."""
    
    def __init__(self):
        self.valid_tiers = list(TIERS.keys())
    
    def resolve(self, tier: str = "local", voice_override: Optional[str] = None, 
                model_override: Optional[str] = None) -> Tuple[str, str]:
        """
        Resolve (model, voice) from tier + overrides.
        
        Args:
            tier: "local" or "quality"
            voice_override: explicit voice ID (wins over tier default)
            model_override: explicit model name (wins over tier default)
        
        Returns:
            (model_name, voice_id)
        
        Raises:
            ValueError: invalid tier
        """
        if tier not in self.valid_tiers:
            raise ValueError(f"Invalid tier '{tier}'. Valid: {self.valid_tiers}")
        
        tier_config = TIERS[tier]
        
        model = model_override or tier_config["model"]
        voice = voice_override or tier_config["voice"]
        
        logger.info(f"Router: tier={tier}, model={model}, voice={voice}")
        return model, voice
    
    def get_fallback_voice(self, voice_id: str) -> Optional[str]:
        """Get fallback voice if primary fails (e.g., Kokoro→Piper)."""
        return FALLBACK_CHAINS.get(voice_id)
    
    def local_tiers(self) -> list:
        """Tiers that never leave the machine.

        app.py exposes this to the dashboard rather than valid_tiers: the
        sidebar renders one button per tier, and a cloud tier appearing
        there would look identical to a local one while sending the prompt
        (rules, conversation history, module index) to a third party. Cloud
        tiers stay CLI-only until the UI can label them as such.
        """
        return [t for t, cfg in TIERS.items() if not cfg.get("remote")]

    def list_tiers(self) -> dict:
        """List all tiers and their defaults."""
        return TIERS

if __name__ == "__main__":
    # Test
    router = Router()
    
    print("Available tiers:")
    for tier, cfg in router.list_tiers().items():
        print(f"  {tier:10} → model={cfg['model']:15} voice={cfg['voice']}")
    
    print("\nTest resolve:")
    model, voice = router.resolve("local")
    print(f"  local        → {model}, {voice}")
    
    model, voice = router.resolve("quality", voice_override="ar_msa_piper")
    print(f"  quality + ar → {model}, {voice}")
    
    fb = router.get_fallback_voice("en_us_kokoro")
    print(f"\nFallback for en_us_kokoro: {fb}")
