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
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            client_id
        )
        return {
            "google_id": idinfo["sub"],
            "email": idinfo["email"],
            "name": idinfo.get("name", ""),
            "avatar_url": idinfo.get("picture", None),
        }
    except Exception as e:
        logger.error(f"Token verification failed. client_id={client_id!r} token_len={len(token) if token else 0} error={e!r}")
        raise ValueError(f"Invalid Google token: {e}")


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
