"""Optional, single-process Nominatim gateway for submitted city claims."""

import asyncio
import os
from collections import OrderedDict
from time import monotonic

import httpx
from fastapi import HTTPException

MAX_CACHE_ENTRIES = 1000
REQUEST_SPACING = 1.1


class Geocoder:
    def __init__(self, client):
        self.client = client
        self.endpoint = os.getenv("TRENDPROOF_NOMINATIM_UPSTREAM", "").strip()
        self.contact = os.getenv("TRENDPROOF_GEOCODER_CONTACT", "").strip()
        self.lock = asyncio.Lock()
        self.cache = OrderedDict()
        self.next_request = 0.0

    async def search(self, query):
        if not self.endpoint or not self.contact:
            raise HTTPException(503, "The live city lookup is unconfigured.")

        query = " ".join(query.split())
        if len(query) < 2:
            raise HTTPException(422, "Enter a city name.")
        key = query.casefold()
        async with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            delay = self.next_request - monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self.next_request = monotonic() + REQUEST_SPACING
            try:
                response = await self.client.get(
                    self.endpoint,
                    params={
                        "q": query,
                        "format": "jsonv2",
                        "limit": 6,
                        "addressdetails": 1,
                        "layer": "address",
                        "accept-language": "en",
                    },
                    headers={
                        "User-Agent": f"TrendProof/1.0 ({self.contact})",
                        "Accept": "application/json",
                    },
                )
                response.raise_for_status()
                results = response.json()
                if not isinstance(results, list):
                    raise ValueError("Unexpected geocoding response")
            except (httpx.HTTPError, ValueError) as exc:
                raise HTTPException(502, "The live city lookup is unavailable.") from exc
            self.cache[key] = results
            if len(self.cache) > MAX_CACHE_ENTRIES:
                self.cache.popitem(last=False)
            return results
