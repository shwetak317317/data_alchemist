"""
JWT authentication dependencies for FastAPI.

Usage in routers:
    from app.core.auth_deps import get_current_user, require_role

    @router.get("/items")
    def list_items(current_user = Depends(get_current_user)):
        ...  # current_user.email, current_user.org_id, current_user.role

    @router.delete("/{id}")
    def delete_item(current_user = Depends(require_role(["admin"]))):
        ...
"""
import hashlib
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.core.config import settings

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 24

_bearer = HTTPBearer(auto_error=False)


def _jwt_secret() -> str:
    return hashlib.sha256(settings.encryption_key.encode()).hexdigest()


@dataclass
class CurrentUser:
    email: str
    name: str
    org_id: str
    role: str


def create_access_token(email: str, name: str, org_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": email,
        "name": name,
        "org_id": org_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_ALGORITHM)


def decode_token(token: str) -> Optional[CurrentUser]:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[_ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            return None
        return CurrentUser(
            email=email,
            name=payload.get("name", email),
            org_id=payload.get("org_id", "default"),
            role=payload.get("role", "viewer"),
        )
    except JWTError:
        return None


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> CurrentUser:
    """Require a valid Bearer token. Raises 401 if absent or invalid."""
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = decode_token(creds.credentials)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[CurrentUser]:
    """Return user if token is present and valid, None otherwise (no 401)."""
    if not creds or not creds.credentials:
        return None
    return decode_token(creds.credentials)


def require_role(allowed_roles: list[str]):
    """Dependency factory: require user to have one of the listed roles."""
    def _check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not permitted. Required: {allowed_roles}",
            )
        return current_user
    return _check


def assert_connection_access(connection_org_id: str, current_user: CurrentUser) -> None:
    """Raise 403 if the current user's org does not match the connection's org."""
    # 'default' is the pre-migration-19 sentinel for connections that existed before
    # org_id was introduced. Any authenticated user may access them — they are not
    # scoped to a specific organisation yet. Demo connections also use 'default'.
    if not connection_org_id or connection_org_id == "default":
        return
    if current_user.org_id != connection_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: this connection belongs to a different organisation.",
        )
