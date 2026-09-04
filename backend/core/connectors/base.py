"""
Base Connector classes — abstract interfaces for all external data sources.

Connector Hierarchy
───────────────────
BaseConnector (abstract)
├── OAuthConnector      — Google, LinkedIn, Salesforce
├── APIKeyConnector     — HubSpot, SendGrid, Search APIs
├── SessionConnector    — Web scraping (stateful sessions)
└── StatelessConnector  — Simple HTTP fetchers
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────────────


class ConnectorError(Exception):
    """Base exception for connector errors."""
    pass


class AuthenticationError(ConnectorError):
    """Authentication failed or token expired."""
    pass


class RateLimitError(ConnectorError):
    """Rate limit exceeded."""
    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(message)
        self.retry_after = retry_after


class ResourceNotFoundError(ConnectorError):
    """Requested resource not found."""
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Base Connector
# ─────────────────────────────────────────────────────────────────────────────


class BaseConnector(ABC):
    """
    Abstract base class for all connectors.

    Subclasses must implement:
    - connect() — establish connection/authenticate
    - fetch() — retrieve data from the source
    - _transform() — transform raw data to standard format

    The base class handles:
    - Context storage (automatic via store_to_context())
    - Error handling patterns
    - Metadata tracking (timestamps, source info)
    """

    # Override in subclasses
    connector_id: str = "base"
    connector_name: str = "Base Connector"
    connector_type: str = "base"  # oauth, api_key, session, stateless
    supported_resources: List[str] = []

    def __init__(self, user_id: str, config: Optional[Dict[str, Any]] = None):
        """
        Initialize connector for a specific user.

        Args:
            user_id: User ID for context storage
            config: Optional configuration overrides
        """
        self.user_id = user_id
        self._config_overrides = config or {}
        self._user_config: Optional[Dict[str, Any]] = None
        self._connected = False
        self._last_fetch: Optional[datetime] = None

    @property
    def config(self) -> Dict[str, Any]:
        """
        Get merged config: user settings + overrides.

        User settings are loaded from UserSettings, then config overrides are applied.
        Falls back to environment variables if no user setting.
        """
        if self._user_config is None:
            self._load_user_config()
        return {**self._user_config, **self._config_overrides}

    def _load_user_config(self) -> None:
        """Load user-specific config from UserSettings."""
        try:
            from core.settings import UserSettings
            settings = UserSettings()
            self._user_config = settings.get_connector_config(self.user_id, self.connector_id)
        except Exception as e:
            logger.warning(f"Failed to load user config for {self.connector_id}: {e}")
            self._user_config = {}

    @abstractmethod
    def connect(self) -> bool:
        """
        Establish connection or verify authentication.

        Returns:
            True if connected successfully, False otherwise
        """
        pass

    def health_check(self) -> Dict[str, Any]:
        """
        Verify the connector actually works right now, not just that
        credentials are present. Default falls back to connect() - fine for
        connector types where connect() already does a real check (OAuth
        token validity/refresh, an open HTTP session). Override in
        subclasses where connect() only checks that a value is present
        (e.g. an API key) without confirming it's still valid.

        Returns:
            {"ok": bool, "error": str | None}
        """
        try:
            ok = self.connect()
            return {"ok": ok, "error": None if ok else "Not configured"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @abstractmethod
    def fetch(
        self,
        resource: str,
        params: Optional[Dict[str, Any]] = None,
        store: bool = True,
    ) -> Dict[str, Any]:
        """
        Fetch data from the external source.

        Args:
            resource: Resource type to fetch (e.g., "profile", "search", "page")
            params: Resource-specific parameters
            store: Whether to automatically store to context (default True)

        Returns:
            Fetched and transformed data
        """
        pass

    @abstractmethod
    def _transform(self, raw_data: Any, resource: str) -> Dict[str, Any]:
        """
        Transform raw API/scrape response to standard format.

        Args:
            raw_data: Raw response from source
            resource: Resource type (for format selection)

        Returns:
            Standardized data dict
        """
        pass

    def disconnect(self) -> None:
        """Clean up connection resources."""
        self._connected = False

    def is_connected(self) -> bool:
        """Check if connector is authenticated/connected."""
        return self._connected

    def store_to_context(
        self,
        data: Dict[str, Any],
        resource: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Store fetched data to ContextStore with provenance.

        Args:
            data: Data to store
            resource: Resource type
            metadata: Additional metadata

        Returns:
            Context key where data was stored
        """
        from core.context import ContextStore

        ctx = ContextStore()
        return ctx.store_from_source(
            user_id=self.user_id,
            source=self.connector_id,
            data=data,
            metadata={
                "resource": resource,
                "connector_name": self.connector_name,
                "fetched_at": datetime.utcnow().isoformat(),
                **(metadata or {}),
            },
        )

    def get_cached(
        self,
        resource: str,
        max_age_seconds: int = 3600,
    ) -> Optional[Dict[str, Any]]:
        """
        Get cached data from context if fresh enough.

        Args:
            resource: Resource type
            max_age_seconds: Maximum age of cached data

        Returns:
            Cached data if fresh, None otherwise
        """
        from core.context import ContextStore

        ctx = ContextStore()
        index = ctx.get(self.user_id, "external", f"{self.connector_id}:index", default=[])

        for entry in index:
            if entry.get("metadata", {}).get("resource") == resource:
                # Check age
                stored_at = entry.get("stored_at")
                if stored_at:
                    from datetime import datetime
                    age = (datetime.utcnow() - datetime.fromisoformat(stored_at)).total_seconds()
                    if age < max_age_seconds:
                        # Return cached data
                        key = entry.get("key")
                        if key:
                            return ctx.get(self.user_id, "external", key)
        return None

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(user_id={self.user_id}, connected={self._connected})>"


# ─────────────────────────────────────────────────────────────────────────────
# OAuth Connector
# ─────────────────────────────────────────────────────────────────────────────


class OAuthConnector(BaseConnector):
    """
    Base class for OAuth-based connectors (Google, LinkedIn, etc.).

    Handles:
    - OAuth token storage/retrieval
    - Token refresh
    - Authorization URL generation
    """

    connector_type = "oauth"

    def __init__(self, user_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(user_id, config)
        self.access_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None

    def get_authorization_url(self, redirect_uri: str, scopes: List[str]) -> str:
        """
        Generate OAuth authorization URL.

        Args:
            redirect_uri: Where to redirect after auth
            scopes: OAuth scopes to request

        Returns:
            Authorization URL
        """
        raise NotImplementedError("Subclass must implement get_authorization_url()")

    def exchange_code(self, code: str, redirect_uri: str) -> Dict[str, Any]:
        """
        Exchange authorization code for tokens.

        Args:
            code: Authorization code from callback
            redirect_uri: Must match original redirect_uri

        Returns:
            Token response dict
        """
        raise NotImplementedError("Subclass must implement exchange_code()")

    def refresh_access_token(self) -> bool:
        """
        Refresh the access token using refresh token.

        Returns:
            True if refresh successful
        """
        raise NotImplementedError("Subclass must implement refresh_access_token()")

    def _load_tokens(self) -> bool:
        """Load stored tokens from context."""
        from core.context import ContextStore

        ctx = ContextStore()
        tokens = ctx.get(self.user_id, "connectors", f"{self.connector_id}:tokens")

        if tokens:
            self.access_token = tokens.get("access_token")
            self.refresh_token = tokens.get("refresh_token")
            expires_at = tokens.get("expires_at")
            if expires_at:
                self.token_expires_at = datetime.fromisoformat(expires_at)
            return True
        return False

    def _save_tokens(self) -> None:
        """Save tokens to context."""
        from core.context import ContextStore

        ctx = ContextStore()
        ctx.set(
            self.user_id,
            agent_id="connectors",
            key=f"{self.connector_id}:tokens",
            value={
                "access_token": self.access_token,
                "refresh_token": self.refresh_token,
                "expires_at": self.token_expires_at.isoformat() if self.token_expires_at else None,
            },
        )

    def connect(self) -> bool:
        """Check if we have valid tokens."""
        if not self._load_tokens():
            return False

        if not self.access_token:
            return False

        # Check if token expired
        if self.token_expires_at and datetime.utcnow() >= self.token_expires_at:
            if self.refresh_token:
                return self.refresh_access_token()
            return False

        self._connected = True
        return True


# ─────────────────────────────────────────────────────────────────────────────
# API Key Connector
# ─────────────────────────────────────────────────────────────────────────────


class APIKeyConnector(BaseConnector):
    """
    Base class for API key-based connectors (HubSpot, SendGrid, etc.).

    API keys are typically stored in environment variables, not per-user.
    """

    connector_type = "api_key"
    env_var_name: str = ""  # Override in subclass

    def __init__(self, user_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(user_id, config)
        self.api_key: Optional[str] = None

    def connect(self) -> bool:
        """Load API key from environment."""
        import os

        self.api_key = self.config.get("api_key") or os.environ.get(self.env_var_name)

        if self.api_key:
            self._connected = True
            return True
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Session Connector (for web scraping)
# ─────────────────────────────────────────────────────────────────────────────


class SessionConnector(BaseConnector):
    """
    Base class for session-based connectors (web scraping).

    Maintains HTTP session with cookies for stateful scraping.
    """

    connector_type = "session"

    def __init__(self, user_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(user_id, config)
        self._session = None

    def connect(self) -> bool:
        """Initialize HTTP session with user settings."""
        import requests

        self._session = requests.Session()

        # Load user settings for scraping config
        user_agent = self.config.get("user_agent") or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )

        # Set default headers
        self._session.headers.update({
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        })

        # Configure proxy if set in user settings
        proxy_url = self.config.get("proxy_url")
        if proxy_url:
            self._session.proxies = {
                "http": proxy_url,
                "https": proxy_url,
            }
            logger.info(f"Using proxy for scraping: {proxy_url[:20]}...")

        self._connected = True
        return True

    def disconnect(self) -> None:
        """Close the session."""
        if self._session:
            self._session.close()
            self._session = None
        super().disconnect()

    @property
    def session(self):
        """Get the requests session, connecting if needed."""
        if not self._session:
            self.connect()
        return self._session
