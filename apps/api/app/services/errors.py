"""Domain exceptions raised by application services."""


class ServiceError(Exception):
    """Base class for business-rule failures."""

    code = "SERVICE_ERROR"


class NotFoundError(ServiceError):
    code = "RESOURCE_NOT_FOUND"


class ForbiddenError(ServiceError):
    code = "FORBIDDEN"


class DomainValidationError(ServiceError):
    code = "VALIDATION_ERROR"


class BadRequestError(ServiceError):
    """A client-selected context or identifier is malformed."""


class ConflictError(ServiceError):
    code = "CONFLICT"


class GoneError(ServiceError):
    """A resource was available but has permanently expired."""
