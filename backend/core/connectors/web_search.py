"""
Web Search Connector — search engine API integration.

Supports multiple search providers:
- Google Custom Search API
- Bing Search API
- SerpAPI (Google, Bing, etc.)

Usage:
    from core.connectors import get_connector

    # Using Google Custom Search
    search = get_connector("web_search", user_id="user123", config={
        "provider": "google",
        "api_key": "...",
        "cx": "..."  # Custom Search Engine ID
    })

    if search.connect():
        results = search.fetch("search", params={"query": "competitor analysis"})
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from core.connectors.base import APIKeyConnector, ConnectorError
from core.connectors.registry import register_connector

logger = logging.getLogger(__name__)


@register_connector
class WebSearchConnector(APIKeyConnector):
    """
    Web search connector supporting multiple providers.

    Environment variables:
    - GOOGLE_SEARCH_API_KEY: Google Custom Search API key
    - GOOGLE_SEARCH_CX: Google Custom Search Engine ID
    - BING_SEARCH_API_KEY: Bing Search API key
    - SERPAPI_API_KEY: SerpAPI key
    """

    connector_id = "web_search"
    connector_name = "Web Search"
    supported_resources = ["search", "news", "images"]

    PROVIDERS = {
        "google": {
            "base_url": "https://www.googleapis.com/customsearch/v1",
            "env_key": "GOOGLE_SEARCH_API_KEY",
            "env_cx": "GOOGLE_SEARCH_CX",
        },
        "bing": {
            "base_url": "https://api.bing.microsoft.com/v7.0/search",
            "env_key": "BING_SEARCH_API_KEY",
        },
        "serpapi": {
            "base_url": "https://serpapi.com/search",
            "env_key": "SERPAPI_API_KEY",
        },
    }

    def __init__(self, user_id: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(user_id, config)
        self.provider = config.get("provider", "google") if config else "google"
        self.cx: Optional[str] = None  # Google Custom Search Engine ID

    def connect(self) -> bool:
        """Load API credentials from UserSettings, config, or environment."""
        provider_config = self.PROVIDERS.get(self.provider)
        if not provider_config:
            raise ConnectorError(f"Unknown provider: {self.provider}")

        env_key = provider_config["env_key"]

        # Priority: config override > user settings > environment variable
        if self.provider == "google":
            self.api_key = (
                self._config_overrides.get("api_key")
                or self.config.get("google_search_key")
                or os.environ.get(env_key)
            )
            self.cx = (
                self._config_overrides.get("cx")
                or self.config.get("google_search_cx")
                or os.environ.get("GOOGLE_SEARCH_CX")
            )
            if not self.cx:
                logger.warning("Google Custom Search requires google_search_cx in settings")
                return False
        elif self.provider == "bing":
            self.api_key = (
                self._config_overrides.get("api_key")
                or self.config.get("bing_search_key")
                or os.environ.get(env_key)
            )
        else:
            self.api_key = self._config_overrides.get("api_key") or os.environ.get(env_key)

        if not self.api_key:
            logger.warning(f"No API key for {self.provider} search - configure in Settings")
            return False

        self._connected = True
        return True

    def health_check(self) -> Dict[str, Any]:
        """
        connect() only checks that an API key string is present, so a
        revoked/invalid key or a wrong Custom Search Engine ID would still
        report "connected". Issue one real, minimal search to confirm the
        credentials actually work against the live API.
        """
        if not self.connect():
            return {"ok": False, "error": "Not configured - add an API key in Settings"}

        try:
            if self.provider == "google":
                self._search_google("test", "search", num_results=1, page=1)
            elif self.provider == "bing":
                self._search_bing("test", "search", num_results=1, page=1)
            elif self.provider == "serpapi":
                self._search_serpapi("test", "search", num_results=1, page=1)
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def fetch(
        self,
        resource: str,
        params: Optional[Dict[str, Any]] = None,
        store: bool = True,
    ) -> Dict[str, Any]:
        """
        Perform a search.

        Args:
            resource: Search type (search, news, images)
            params: Must include 'query', may include 'num_results', 'page'
        """
        if not self.is_connected():
            if not self.connect():
                raise ConnectorError(f"Not connected to {self.provider} search")

        params = params or {}
        query = params.get("query")

        if not query:
            raise ConnectorError("Query is required")

        num_results = params.get("num_results", 10)
        page = params.get("page", 1)

        try:
            if self.provider == "google":
                raw_data = self._search_google(query, resource, num_results, page)
            elif self.provider == "bing":
                raw_data = self._search_bing(query, resource, num_results, page)
            elif self.provider == "serpapi":
                raw_data = self._search_serpapi(query, resource, num_results, page)
            else:
                raise ConnectorError(f"Provider not implemented: {self.provider}")

            data = self._transform(raw_data, resource)

            if store:
                self.store_to_context(
                    data,
                    resource,
                    metadata={"query": query, "provider": self.provider},
                )

            return data

        except Exception as e:
            logger.error(f"Search failed: {e}")
            raise ConnectorError(f"Search failed: {e}")

    def _search_google(
        self,
        query: str,
        resource: str,
        num_results: int,
        page: int,
    ) -> Dict[str, Any]:
        """Search using Google Custom Search API."""
        import requests

        params = {
            "key": self.api_key,
            "cx": self.cx,
            "q": query,
            "num": min(num_results, 10),  # Google max is 10
            "start": (page - 1) * 10 + 1,
        }

        if resource == "images":
            params["searchType"] = "image"
        elif resource == "news":
            params["q"] = f"{query} news"

        response = requests.get(
            self.PROVIDERS["google"]["base_url"],
            params=params,
            timeout=30,
        )

        if response.status_code != 200:
            raise ConnectorError(f"Google search error: {response.text}")

        data = response.json()

        return {
            "query": query,
            "provider": "google",
            "total_results": int(data.get("searchInformation", {}).get("totalResults", 0)),
            "results": [
                {
                    "title": item.get("title"),
                    "url": item.get("link"),
                    "snippet": item.get("snippet"),
                    "display_url": item.get("displayLink"),
                }
                for item in data.get("items", [])
            ],
        }

    def _search_bing(
        self,
        query: str,
        resource: str,
        num_results: int,
        page: int,
    ) -> Dict[str, Any]:
        """Search using Bing Search API."""
        import requests

        headers = {"Ocp-Apim-Subscription-Key": self.api_key}

        params = {
            "q": query,
            "count": min(num_results, 50),
            "offset": (page - 1) * num_results,
            "mkt": "en-US",
        }

        # Select endpoint based on resource
        if resource == "news":
            url = "https://api.bing.microsoft.com/v7.0/news/search"
        elif resource == "images":
            url = "https://api.bing.microsoft.com/v7.0/images/search"
        else:
            url = self.PROVIDERS["bing"]["base_url"]

        response = requests.get(url, headers=headers, params=params, timeout=30)

        if response.status_code != 200:
            raise ConnectorError(f"Bing search error: {response.text}")

        data = response.json()

        # Parse based on resource type
        if resource == "news":
            items = data.get("value", [])
            results = [
                {
                    "title": item.get("name"),
                    "url": item.get("url"),
                    "snippet": item.get("description"),
                    "published": item.get("datePublished"),
                    "source": item.get("provider", [{}])[0].get("name"),
                }
                for item in items
            ]
        elif resource == "images":
            items = data.get("value", [])
            results = [
                {
                    "title": item.get("name"),
                    "url": item.get("contentUrl"),
                    "thumbnail": item.get("thumbnailUrl"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                }
                for item in items
            ]
        else:
            items = data.get("webPages", {}).get("value", [])
            results = [
                {
                    "title": item.get("name"),
                    "url": item.get("url"),
                    "snippet": item.get("snippet"),
                    "display_url": item.get("displayUrl"),
                }
                for item in items
            ]

        return {
            "query": query,
            "provider": "bing",
            "total_results": data.get("webPages", {}).get("totalEstimatedMatches", len(results)),
            "results": results,
        }

    def _search_serpapi(
        self,
        query: str,
        resource: str,
        num_results: int,
        page: int,
    ) -> Dict[str, Any]:
        """Search using SerpAPI."""
        import requests

        params = {
            "api_key": self.api_key,
            "q": query,
            "num": num_results,
            "start": (page - 1) * num_results,
            "engine": "google",
        }

        if resource == "news":
            params["tbm"] = "nws"
        elif resource == "images":
            params["tbm"] = "isch"

        response = requests.get(
            self.PROVIDERS["serpapi"]["base_url"],
            params=params,
            timeout=30,
        )

        if response.status_code != 200:
            raise ConnectorError(f"SerpAPI error: {response.text}")

        data = response.json()

        # Parse organic results
        results = []
        for item in data.get("organic_results", []):
            results.append({
                "title": item.get("title"),
                "url": item.get("link"),
                "snippet": item.get("snippet"),
                "position": item.get("position"),
            })

        return {
            "query": query,
            "provider": "serpapi",
            "total_results": data.get("search_information", {}).get("total_results", len(results)),
            "results": results,
        }

    def _transform(self, raw_data: Any, resource: str) -> Dict[str, Any]:
        """Transform to standard format."""
        return {
            "resource_type": resource,
            "searched_at": datetime.utcnow().isoformat(),
            "connector": self.connector_id,
            **raw_data,
        }
