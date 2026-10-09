import base64
import hashlib
import hmac
import json
import secrets
import time
import bcrypt

from fastapi import HTTPException, status

from app.core.config import get_settings


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    result = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${result.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    if encoded.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            return bcrypt.checkpw(password.encode(), encoded.encode())
        except (ValueError, TypeError):
            return False
    try:
        scheme, salt_hex, digest = encoded.split("$")
        if scheme != "scrypt":
            return False
        calculated = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(calculated.hex(), digest)
    except (ValueError, TypeError):
        return False


def signing_key() -> bytes:
    settings = get_settings()
    if settings.jwt_secret:
        return settings.jwt_secret.encode()
    if settings.env.lower() in {"production", "prod"}:
        raise RuntimeError("SYNAPSE_JWT_SECRET is required in production")
    # Local development convenience only: a process restart invalidates dev tokens.
    if not hasattr(signing_key, "_development_secret"):
        signing_key._development_secret = secrets.token_bytes(32)  # type: ignore[attr-defined]
    return signing_key._development_secret  # type: ignore[attr-defined]


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def issue_token(user_id: int, version: int) -> str:
    settings = get_settings()
    now = int(time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({"sub": str(user_id), "ver": version, "iat": now,
                               "exp": now + settings.jwt_ttl_minutes * 60,
                               "jti": secrets.token_urlsafe(16)}, separators=(",", ":")).encode())
    body = f"{header}.{payload}"
    return f"{body}.{_b64(hmac.new(signing_key(), body.encode(), hashlib.sha256).digest())}"


def decode_token(token: str) -> dict:
    try:
        head, payload, signature = token.split(".")
        body = f"{head}.{payload}"
        expected = _b64(hmac.new(signing_key(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims.get("exp", 0) <= int(time.time()):
            raise ValueError("expired")
        return claims
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "AUTHENTICATION_REQUIRED"}) from exc
