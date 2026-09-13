"""
UserSettings — encrypted per-user settings storage.

Provides secure storage for:
- API keys (OpenAI, Anthropic, search APIs)
- OAuth tokens (Google, LinkedIn)
- Connector configuration (proxy, rate limits)

All sensitive values are encrypted at rest using Fernet symmetric encryption.

Usage:
    from core.settings import UserSettings

    settings = UserSettings()

    # Store a setting (encrypted)
    settings.set(user_id, "ai", "openai_key", "sk-xxx...")

    # Retrieve (decrypted)
    key = settings.get(user_id, "ai", "openai_key")

    # List settings (values masked)
    all_settings = settings.list(user_id)

    # Delete
    settings.delete(user_id, "ai", "openai_key")
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from core.crypto import encrypt as _encrypt, decrypt as _decrypt, mask_value as _mask_value

logger = logging.getLogger(__name__)


# Setting definitions with metadata for UI
SETTING_DEFINITIONS = {
    "ai": {
        "label": "AI Providers",
        "description": "Configure your AI provider API keys",
        "icon": "brain",
        "settings": {
            "openai_key": {
                "label": "OpenAI API Key",
                "description": "Your OpenAI API key for GPT models",
                "type": "password",
                "placeholder": "sk-...",
                "required": False,
                "help_url": "https://platform.openai.com/api-keys",
            },
            "anthropic_key": {
                "label": "Anthropic API Key",
                "description": "Your Anthropic API key for Claude models",
                "type": "password",
                "placeholder": "sk-ant-...",
                "required": False,
                "help_url": "https://console.anthropic.com/settings/keys",
            },
            "preferred_model": {
                "label": "Preferred Model",
                "description": "Default model for AI operations",
                "type": "select",
                "options": [
                    {"value": "gpt-4o-mini", "label": "GPT-4o Mini (Fast, Cheap)"},
                    {"value": "gpt-4o", "label": "GPT-4o (Powerful)"},
                    {"value": "claude-3-haiku", "label": "Claude 3 Haiku (Fast)"},
                    {"value": "claude-3-sonnet", "label": "Claude 3 Sonnet (Balanced)"},
                ],
                "default": "gpt-4o-mini",
            },
        },
    },
    "connectors": {
        "label": "Data Connectors",
        "description": "Connect external data sources",
        "icon": "plug",
        "settings": {
            "google_search_key": {
                "label": "Google Search API Key",
                "description": "For web search functionality",
                "type": "password",
                "placeholder": "AIza...",
                "help_url": "https://developers.google.com/custom-search/v1/introduction",
                "icon": "google",
            },
            "google_search_cx": {
                "label": "Google Search Engine ID",
                "description": "Your custom search engine ID",
                "type": "text",
                "placeholder": "xxx:yyy",
                "icon": "google",
            },
            "bing_search_key": {
                "label": "Bing Search API Key",
                "description": "Alternative to Google search",
                "type": "password",
                "placeholder": "",
                "help_url": "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api",
                "icon": "bing",
            },
            "hubspot_key": {
                "label": "HubSpot API Key",
                "description": "For CRM data integration",
                "type": "password",
                "placeholder": "pat-...",
                "help_url": "https://developers.hubspot.com/docs/api/private-apps",
                "icon": "hubspot",
            },
        },
    },
    "scraping": {
        "label": "Web Scraping",
        "description": "Configure web scraping behavior",
        "icon": "globe",
        "settings": {
            "proxy_url": {
                "label": "Proxy URL",
                "description": "HTTP proxy for scraping (optional)",
                "type": "text",
                "placeholder": "http://user:pass@proxy:port",
            },
            "rate_limit": {
                "label": "Rate Limit",
                "description": "Max requests per minute",
                "type": "number",
                "default": 30,
                "min": 1,
                "max": 100,
            },
            "user_agent": {
                "label": "User Agent",
                "description": "Browser user agent string",
                "type": "text",
                "placeholder": "Mozilla/5.0...",
                "default": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        },
    },
    "oauth": {
        "label": "Connected Accounts",
        "description": "OAuth-connected services",
        "icon": "link",
        "settings": {
            "google_business": {
                "label": "Google Business Profile",
                "description": "Access your business reviews and insights",
                "type": "oauth",
                "provider": "google_business",
                "icon": "google",
            },
            "linkedin": {
                "label": "LinkedIn",
                "description": "Access company and people data",
                "type": "oauth",
                "provider": "linkedin",
                "icon": "linkedin",
            },
        },
    },
    "preferences": {
        "label": "Preferences",
        "description": "Personalize how Enable talks to you",
        "icon": "sliders",
        "settings": {
            "response_language_level": {
                "label": "Response language level",
                "description": "How much business/technical jargon the AI uses in what it writes for you",
                "type": "segmented",
                "options": [
                    {"value": "simple", "label": "Simple"},
                    {"value": "moderate", "label": "Moderate"},
                    {"value": "professional", "label": "Professional"},
                ],
                "default": "moderate",
            },
        },
    },
}

# Instruction block appended to every user-facing-prose system prompt, keyed
# by response_language_level (see RESPONSE_LANGUAGE_LEVEL_PROMPTS usage in
# app.py's chat/content-generation endpoints). Kept alongside the setting
# definition above so the two never drift apart.
RESPONSE_LANGUAGE_LEVEL_PROMPTS = {
    "simple": (
        "Explain everything in plain, everyday language. Avoid business/technical "
        "jargon entirely (say 'starter/sample data', never 'seed data'; say 'find "
        "and download', never 'scrape'). Assume the reader runs a small business "
        "with no technical or corporate background."
    ),
    "moderate": (
        "Use clear, plain business language. Avoid unexplained jargon; if a "
        "technical term is unavoidable, briefly explain it in the same sentence."
    ),
    "professional": (
        "Standard business and technical terminology is fine without extra explanation."
    ),
}


def get_response_language_instruction(user_id: str) -> str:
    """
    The instruction block to append to a user-facing-prose system prompt,
    based on the caller's saved response-language-level preference.

    Every prompt-construction point that produces prose the user reads
    (chat replies, generated content/emails, proactive-suggestion text)
    should call this and append the result to its system prompt - see
    docs/todo.md's "Plain-language setting" section for the full list of
    call sites this was wired into.
    """
    level = get_user_setting(user_id, "preferences", "response_language_level", "moderate")
    return RESPONSE_LANGUAGE_LEVEL_PROMPTS.get(level, RESPONSE_LANGUAGE_LEVEL_PROMPTS["moderate"])


class UserSettings:
    """
    Encrypted per-user settings storage.

    Thread-safe: all state in PostgreSQL.
    """

    def set(
        self,
        user_id: str,
        category: str,
        key: str,
        value: Any,
    ) -> None:
        """
        Store a setting (encrypted).

        Args:
            user_id: User ID
            category: Setting category (ai, connectors, scraping, oauth)
            key: Setting key
            value: Setting value (will be JSON serialized and encrypted)
        """
        from core.database import db
        from core.models import UserSettingModel

        # Serialize and encrypt
        json_value = json.dumps(value)
        encrypted = _encrypt(json_value)

        # Upsert
        existing = UserSettingModel.query.filter_by(
            user_id=user_id, category=category, key=key
        ).first()

        if existing:
            existing.value_encrypted = encrypted
            existing.updated_at = datetime.utcnow()
        else:
            setting = UserSettingModel(
                user_id=user_id,
                category=category,
                key=key,
                value_encrypted=encrypted,
            )
            db.session.add(setting)

        db.session.commit()
        logger.info(f"Saved setting {category}/{key} for user {user_id}")

    def get(
        self,
        user_id: str,
        category: str,
        key: str,
        default: Any = None,
    ) -> Any:
        """
        Retrieve a setting (decrypted).

        Args:
            user_id: User ID
            category: Setting category
            key: Setting key
            default: Default value if not found

        Returns:
            Decrypted setting value
        """
        from core.models import UserSettingModel

        setting = UserSettingModel.query.filter_by(
            user_id=user_id, category=category, key=key
        ).first()

        if not setting:
            return default

        try:
            decrypted = _decrypt(setting.value_encrypted)
            return json.loads(decrypted)
        except Exception as e:
            logger.error(f"Failed to decrypt setting {category}/{key}: {e}")
            return default

    def list(
        self,
        user_id: str,
        category: Optional[str] = None,
        include_values: bool = False,
    ) -> Dict[str, Any]:
        """
        List settings with metadata for UI.

        Args:
            user_id: User ID
            category: Optional category filter
            include_values: If True, include masked values

        Returns:
            Dict with categories, settings, and metadata
        """
        from core.models import UserSettingModel

        # Get user's saved settings
        query = UserSettingModel.query.filter_by(user_id=user_id)
        if category:
            query = query.filter_by(category=category)

        saved = {(s.category, s.key): s for s in query.all()}

        # Build response with definitions
        result = {}

        for cat_id, cat_def in SETTING_DEFINITIONS.items():
            if category and cat_id != category:
                continue

            cat_result = {
                "label": cat_def["label"],
                "description": cat_def["description"],
                "icon": cat_def.get("icon"),
                "settings": {},
            }

            for key, setting_def in cat_def["settings"].items():
                setting_result = {
                    **setting_def,
                    "configured": (cat_id, key) in saved,
                }

                if include_values and (cat_id, key) in saved:
                    try:
                        decrypted = _decrypt(saved[(cat_id, key)].value_encrypted)
                        value = json.loads(decrypted)
                        # Mask sensitive values
                        if setting_def.get("type") == "password":
                            setting_result["value"] = _mask_value(str(value))
                            setting_result["value_set"] = True
                        else:
                            setting_result["value"] = value
                    except Exception:
                        setting_result["value"] = None

                cat_result["settings"][key] = setting_result

            result[cat_id] = cat_result

        return result

    def delete(
        self,
        user_id: str,
        category: str,
        key: str,
    ) -> bool:
        """
        Delete a setting.

        Returns:
            True if deleted, False if not found
        """
        from core.database import db
        from core.models import UserSettingModel

        deleted = UserSettingModel.query.filter_by(
            user_id=user_id, category=category, key=key
        ).delete()

        db.session.commit()

        if deleted:
            logger.info(f"Deleted setting {category}/{key} for user {user_id}")

        return deleted > 0

    def get_connector_config(self, user_id: str, connector_id: str) -> Dict[str, Any]:
        """
        Get all settings relevant to a specific connector.

        Connectors call this to get user's configuration.
        """
        config = {}

        # AI settings (for LLM-using connectors)
        config["openai_key"] = self.get(user_id, "ai", "openai_key")
        config["anthropic_key"] = self.get(user_id, "ai", "anthropic_key")
        config["preferred_model"] = self.get(user_id, "ai", "preferred_model", "gpt-4o-mini")

        # Scraping settings
        if connector_id == "web_scraper":
            config["proxy_url"] = self.get(user_id, "scraping", "proxy_url")
            config["rate_limit"] = self.get(user_id, "scraping", "rate_limit", 30)
            config["user_agent"] = self.get(user_id, "scraping", "user_agent")

        # Search settings
        if connector_id == "web_search":
            config["google_search_key"] = self.get(user_id, "connectors", "google_search_key")
            config["google_search_cx"] = self.get(user_id, "connectors", "google_search_cx")
            config["bing_search_key"] = self.get(user_id, "connectors", "bing_search_key")

        # OAuth tokens
        if connector_id in ("google_business", "linkedin"):
            tokens = self.get(user_id, "oauth", f"{connector_id}_tokens")
            if tokens:
                config["access_token"] = tokens.get("access_token")
                config["refresh_token"] = tokens.get("refresh_token")

        return config


# Export for convenience
def get_user_setting(user_id: str, category: str, key: str, default: Any = None) -> Any:
    """Shortcut to get a single setting."""
    return UserSettings().get(user_id, category, key, default)


def get_setting_definitions() -> Dict[str, Any]:
    """Get setting definitions for UI rendering."""
    return SETTING_DEFINITIONS
