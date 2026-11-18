"""Cliente HTTP respetuoso: robots.txt, límite por dominio, reintentos con backoff, caché condicional
(ETag / Last-Modified), presupuesto de consultas y tiempo máximo de ejecución."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from urllib import robotparser
from urllib.parse import urlparse

import requests

from .config import USER_AGENT
from .util import domain_of

log = logging.getLogger("radar.http")

# Dominios donde NO se intenta extraer contenido (requieren sesión, prohíben scraping o bloquean bots).
NO_FETCH_DOMAINS = {
    "facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com",
    "whatsapp.com", "wa.me", "t.me", "youtube.com", "youtu.be", "threads.net",
}


class BudgetExceeded(Exception):
    pass


@dataclass
class FetchResult:
    url: str
    final_url: str
    status: int
    content: bytes = b""
    content_type: str = ""
    headers: dict = field(default_factory=dict)
    elapsed_ms: int = 0
    error: str = ""
    not_modified: bool = False
    from_robots_block: bool = False

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and not self.error

    @property
    def text(self) -> str:
        enc = "utf-8"
        ct = self.content_type.lower()
        if "charset=" in ct:
            enc = ct.split("charset=")[-1].split(";")[0].strip() or "utf-8"
        try:
            return self.content.decode(enc, errors="replace")
        except LookupError:
            return self.content.decode("utf-8", errors="replace")

    @property
    def is_pdf(self) -> bool:
        return "pdf" in self.content_type.lower() or self.final_url.lower().split("?")[0].endswith(".pdf")


class PoliteSession:
    def __init__(self, cache: dict | None = None, max_fetches: int = 300, deadline: float | None = None,
                 min_interval: float = 1.2, timeout: float = 20.0, max_bytes: int = 6_000_000):
        self.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept-Language": "es-CO,es;q=0.9,en;q=0.5",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,application/pdf,*/*;q=0.8",
        })
        self.cache = cache if cache is not None else {}
        self.max_fetches = max_fetches
        self.deadline = deadline
        self.min_interval = min_interval
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.count = 0
        self.robots_blocked = 0
        self._lock = threading.Lock()
        self._domain_locks: dict[str, threading.Lock] = {}
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self._crawl_delay: dict[str, float] = {}

    # ------------------------------------------------------------------ helpers
    def time_left(self) -> float:
        if self.deadline is None:
            return float("inf")
        return self.deadline - time.monotonic()

    def budget_left(self) -> int:
        return self.max_fetches - self.count

    def _domain_lock(self, host: str) -> threading.Lock:
        with self._lock:
            if host not in self._domain_locks:
                self._domain_locks[host] = threading.Lock()
            return self._domain_locks[host]

    def _wait_turn(self, host: str) -> None:
        interval = max(self.min_interval, self._crawl_delay.get(host, 0.0))
        last = self._last_hit.get(host, 0.0)
        wait = last + interval - time.monotonic()
        if wait > 0:
            time.sleep(min(wait, 10))
        self._last_hit[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        """Consulta robots.txt (una vez por dominio y ejecución)."""
        p = urlparse(url)
        host = p.hostname or ""
        if not host:
            return False
        base = domain_of(url)
        if any(base == d or base.endswith("." + d) for d in NO_FETCH_DOMAINS):
            return False
        key = f"{p.scheme}://{host}"
        if key not in self._robots:
            rp = robotparser.RobotFileParser()
            try:
                resp = self.session.get(key + "/robots.txt", timeout=10, allow_redirects=True)
                if resp.status_code in (401, 403):
                    rp.disallow_all = True
                elif resp.status_code >= 400:
                    rp.allow_all = True
                else:
                    rp.parse(resp.text.splitlines())
                    delay = rp.crawl_delay(USER_AGENT) or rp.crawl_delay("*")
                    if delay:
                        self._crawl_delay[host] = min(float(delay), 15.0)
            except requests.RequestException:
                rp = None  # robots inaccesible: se asume permitido, con el límite de cortesía normal
            self._robots[key] = rp
        rp = self._robots[key]
        if rp is None:
            return True
        try:
            return rp.can_fetch(USER_AGENT, url)
        except Exception:  # noqa: BLE001 - robotparser puede fallar con reglas raras
            return True

    # ------------------------------------------------------------------ fetch
    def get(self, url: str, *, conditional: bool = False, retries: int = 2, accept: str | None = None,
            check_robots: bool = True, method: str = "GET") -> FetchResult:
        if self.time_left() <= 0:
            raise BudgetExceeded("tiempo máximo de ejecución alcanzado")
        with self._lock:
            if self.count >= self.max_fetches:
                raise BudgetExceeded("presupuesto de consultas agotado")
            self.count += 1
        if check_robots and not self.allowed(url):
            with self._lock:
                self.robots_blocked += 1
            return FetchResult(url, url, 0, error="bloqueado por robots.txt o fuente no permitida",
                               from_robots_block=True)

        host = urlparse(url).hostname or ""
        headers = {}
        if accept:
            headers["Accept"] = accept
        cached = self.cache.get(url) if conditional else None
        if cached:
            if cached.get("etag"):
                headers["If-None-Match"] = cached["etag"]
            if cached.get("last_modified"):
                headers["If-Modified-Since"] = cached["last_modified"]

        attempt = 0
        last_error = ""
        while True:
            attempt += 1
            lock = self._domain_lock(host)
            start = time.monotonic()
            try:
                with lock:
                    self._wait_turn(host)
                    resp = self.session.request(method, url, headers=headers, timeout=self.timeout,
                                                allow_redirects=True, stream=True)
                    content = b""
                    if method == "GET":
                        chunks = []
                        size = 0
                        for chunk in resp.iter_content(65536):
                            chunks.append(chunk)
                            size += len(chunk)
                            if size > self.max_bytes:
                                break
                        content = b"".join(chunks)
                    resp.close()
                elapsed = int((time.monotonic() - start) * 1000)
            except requests.RequestException as exc:
                last_error = f"{type(exc).__name__}: {str(exc)[:160]}"
                if attempt <= retries and self.time_left() > 30:
                    time.sleep(min(2 ** attempt, 8))
                    continue
                return FetchResult(url, url, 0, error=last_error, elapsed_ms=int((time.monotonic() - start) * 1000))

            status = resp.status_code
            if status in (429, 500, 502, 503, 504) and attempt <= retries and self.time_left() > 30:
                retry_after = resp.headers.get("Retry-After", "")
                delay = float(retry_after) if retry_after.isdigit() else 2 ** attempt * 1.5
                time.sleep(min(delay, 20))
                continue
            result = FetchResult(
                url=url, final_url=resp.url, status=status, content=content,
                content_type=resp.headers.get("Content-Type", ""), headers=dict(resp.headers),
                elapsed_ms=elapsed, not_modified=(status == 304),
            )
            if status >= 400:
                result.error = f"HTTP {status}"
            if conditional and status == 200:
                self.cache[url] = {
                    "etag": resp.headers.get("ETag", ""),
                    "last_modified": resp.headers.get("Last-Modified", ""),
                }
            return result
