from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.user import User
from app.auth.security import decode_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db)) -> User:
    token = credentials.credentials if credentials else request.cookies.get("synapse_session")
    if not token:
        raise HTTPException(401, detail={"code": "AUTHENTICATION_REQUIRED"})
    claims = decode_token(token)
    try:
        user_id = int(claims["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(401, detail={"code": "AUTHENTICATION_REQUIRED"}) from exc
    user = db.get(User, user_id)
    if not user or user.del_flag or user.status != "active" or user.token_version != claims.get("ver"):
        raise HTTPException(401, detail={"code": "AUTHENTICATION_REQUIRED"})
    return user


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if user.platform_role != "platform_admin":
        raise HTTPException(403, detail={"code": "FORBIDDEN"})
    return user
