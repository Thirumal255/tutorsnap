import os
import jwt
import logging
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv(override=True)

from database import get_db
from models import User


def verify_google_token(token: str) -> dict:
    # Support multiple client IDs so both web and mobile tokens are accepted.
    # GOOGLE_CLIENT_IDS = comma-separated list (preferred).
    # Falls back to GOOGLE_CLIENT_ID for backward compatibility.
    raw = os.getenv("GOOGLE_CLIENT_IDS", os.getenv("GOOGLE_CLIENT_ID", ""))
    client_ids = [c.strip() for c in raw.split(",") if c.strip()]

    if not client_ids:
        raise ValueError("No GOOGLE_CLIENT_ID(S) configured on server")

    last_error: Exception = Exception("No client IDs tried")
    for client_id in client_ids:
        try:
            idinfo = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                client_id,
            )
            return {
                "google_id": idinfo["sub"],
                "email": idinfo["email"],
                "name": idinfo.get("name", ""),
                "avatar_url": idinfo.get("picture", None),
            }
        except Exception as e:
            last_error = e
            continue

    logger.error(
        f"Token verification failed for all client_ids={client_ids!r} "
        f"token_len={len(token) if token else 0} last_error={last_error!r}"
    )
    raise ValueError(f"Invalid Google token: {last_error}")


def create_jwt(user_id: int, email: str, role: str) -> str:
    expiry_hours = int(os.getenv("JWT_EXPIRY_HOURS", 24))
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=expiry_hours),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, os.getenv("JWT_SECRET"), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")


def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.replace("Bearer ", "")

    # Mobile API key — bypass JWT for the Android app running on a trusted device
    mobile_key = os.getenv("MOBILE_API_KEY", "")
    if mobile_key and token == mobile_key:
        mobile_email = os.getenv("MOBILE_API_EMAIL", "")
        user = db.query(User).filter(User.email == mobile_email, User.is_active == True).first()
        if not user:
            raise HTTPException(status_code=401, detail="Mobile API key valid but email not found")
        return user

    try:
        payload = decode_jwt(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = db.query(User).filter(User.id == payload["user_id"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def require_parent(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["parent", "admin"]:
        raise HTTPException(status_code=403, detail="Parent access required")
    return current_user
