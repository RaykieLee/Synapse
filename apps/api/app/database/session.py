from functools import lru_cache
from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    url = get_settings().database_url
    is_sqlite = make_url(url).get_backend_name() == "sqlite"
    options: dict[str, object] = {"pool_pre_ping": True}
    if is_sqlite:
        options["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **options)
    if is_sqlite:
        # SQLite declares foreign keys but leaves enforcement disabled on each
        # connection by default. Register on the Engine so pooled and newly
        # opened FastAPI connections all enforce the declared constraints.
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    return engine


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that scopes one synchronous session to a request."""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
