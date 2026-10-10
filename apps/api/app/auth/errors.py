import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError, HTTPException
from fastapi.responses import JSONResponse

from app.services.errors import (
    BadRequestError,
    ConflictError,
    DomainValidationError,
    ForbiddenError,
    NotFoundError,
    ServiceError,
)


def problem(status_code: int, code: str, detail: str | None = None, errors=None, request_id: str | None = None):
    title = {400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
             409: "Conflict", 422: "Unprocessable Content"}.get(status_code, "Error")
    payload = {"type": f"https://synapse.invalid/problems/{code.lower()}", "title": title,
               "status": status_code, "code": code, "detail": detail or title,
               "request_id": request_id or f"req_{uuid.uuid4().hex}"}
    if errors is not None:
        payload["errors"] = errors
    return JSONResponse(payload, status_code=status_code, media_type="application/problem+json")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_problem(request: Request, exc: HTTPException):
        data = exc.detail if isinstance(exc.detail, dict) else {}
        return problem(exc.status_code, data.get("code", "REQUEST_ERROR"),
                       data.get("detail") or (exc.detail if isinstance(exc.detail, str) else None),
                       request_id=getattr(request.state, "request_id", None))

    @app.exception_handler(RequestValidationError)
    async def validation_problem(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(part) for part in e["loc"] if part != "body"),
                   "code": "INVALID_VALUE", "message": e["msg"]} for e in exc.errors()]
        return problem(422, "VALIDATION_ERROR", "Request validation failed", errors,
                       getattr(request.state, "request_id", None))

    @app.exception_handler(ServiceError)
    async def service_problem(request: Request, exc: ServiceError):
        status_by_type = {
            BadRequestError: 400,
            NotFoundError: 404,
            ForbiddenError: 403,
            DomainValidationError: 422,
            ConflictError: 409,
        }
        status_code = next(
            (status for error_type, status in status_by_type.items() if isinstance(exc, error_type)),
            500,
        )
        return problem(
            status_code,
            exc.code,
            str(exc) or None,
            request_id=getattr(request.state, "request_id", None),
        )

    @app.exception_handler(Exception)
    async def internal_problem(request: Request, exc: Exception):
        # Keep unexpected failures in the same wire format without exposing internals.
        return problem(500, "INTERNAL_ERROR", "Internal server error",
                       request_id=getattr(request.state, "request_id", None))
