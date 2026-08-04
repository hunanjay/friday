import hashlib
import logging
import os
import time

import jwt
from fastapi import Header, HTTPException
from starlette.concurrency import run_in_threadpool
from supabase import create_client

from app.core.config import settings

logger = logging.getLogger(__name__)

supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
supabase_admin = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
_jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")
_AUTH_CACHE_TTL_SECONDS = 60
_AUTH_CACHE_MAX_ENTRIES = 1024
_auth_cache: dict[bytes, tuple[float, str]] = {}


def _auth_cache_key(token: str) -> bytes:
    # Do not retain raw bearer tokens in process memory beyond the request.
    return hashlib.sha256(token.encode()).digest()


def _get_cached_user(token: str) -> str | None:
    key = _auth_cache_key(token)
    entry = _auth_cache.get(key)
    if not entry:
        return None
    expires_at, user_id = entry
    if expires_at <= time.monotonic():
        _auth_cache.pop(key, None)
        return None
    return user_id


def _cache_user(token: str, user_id: str) -> None:
    ttl = _AUTH_CACHE_TTL_SECONDS
    try:
        payload = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        token_expires_in = float(payload.get("exp", 0)) - time.time()
        ttl = min(ttl, max(0, token_expires_in))
    except Exception:
        # The token has already been validated remotely; a missing exp claim
        # only means we use the short cache TTL.
        pass
    if ttl <= 0:
        return

    now = time.monotonic()
    if len(_auth_cache) >= _AUTH_CACHE_MAX_ENTRIES:
        expired = [key for key, (expires_at, _) in _auth_cache.items() if expires_at <= now]
        for key in expired:
            _auth_cache.pop(key, None)
        if len(_auth_cache) >= _AUTH_CACHE_MAX_ENTRIES:
            oldest_key = min(_auth_cache, key=lambda key: _auth_cache[key][0])
            _auth_cache.pop(oldest_key, None)
    _auth_cache[_auth_cache_key(token)] = (now + ttl, user_id)


async def resolve_user_id(token: str) -> str | None:
    """Resolves a Supabase session JWT to a user id, or None if invalid."""
    if _jwt_secret:
        try:
            payload = jwt.decode(
                token,
                _jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
            return payload.get("sub")
        except Exception as e:
            logger.warning("Local JWT verification failed: %s, falling back to remote", e)
            pass

    cached_user_id = _get_cached_user(token)
    if cached_user_id:
        return cached_user_id

    try:
        user = await run_in_threadpool(supabase.auth.get_user, token)
    except Exception:
        user = None
    user_id = user.user.id if user else None
    if user_id:
        _cache_user(token, user_id)
    return user_id


async def get_user_id(authorization: str = Header(...)) -> str:
    """FastAPI dependency: resolves caller's user id from JWT Bearer token."""
    token = authorization.removeprefix("Bearer ").strip()
    user_id = await resolve_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user_id
