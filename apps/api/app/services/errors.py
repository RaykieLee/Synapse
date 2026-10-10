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


class ConflictError(ServiceError):
    code = "CONFLICT"
