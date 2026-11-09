"""Storage seam for attachment use cases."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable


StorageBackend = Literal["local", "s3"]


@dataclass(frozen=True)
class AttachmentStorageScope:
    tenant_id: int
    workspace_id: int
    scope_kind: Literal["workspace", "personal"]
    owner_user_id: int | None


class AttachmentBody(Protocol):
    def read(self, amount: int = -1) -> bytes: ...

    def close(self) -> None: ...


class AttachmentObjectStore(Protocol):
    def put(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
        payload: bytes,
        media_type: str,
    ) -> None: ...

    def open(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
    ) -> AttachmentBody: ...

    def delete(self, storage_key: str, scope: AttachmentStorageScope) -> None: ...

    def size(self, storage_key: str, scope: AttachmentStorageScope) -> int: ...


@runtime_checkable
class AttachmentObjectInventory(Protocol):
    def count_orphan_objects(
        self,
        tenant_id: int,
        tracked_objects: set[tuple[str, AttachmentStorageScope]],
    ) -> int: ...


class AttachmentStoreError(Exception):
    """Base class for storage adapter failures."""


class AttachmentObjectMissing(AttachmentStoreError):
    """The metadata references an object that is no longer present."""


class AttachmentStoreUnavailable(AttachmentStoreError):
    """The configured storage backend cannot complete an operation."""


class AttachmentStoreCleanupFailed(AttachmentStoreError):
    """A local object could not be removed during a delete operation."""


class AttachmentStorageRouter:
    """Route each object to its persisted backend and choose new-write storage."""

    def __init__(
        self,
        *,
        local: AttachmentObjectStore,
        s3: AttachmentObjectStore | None,
        default_backend: StorageBackend,
    ) -> None:
        self.local = local
        self.s3 = s3
        self.default_backend = default_backend

    def store_for(self, backend: str) -> AttachmentObjectStore:
        if backend == "local":
            return self.local
        if backend == "s3" and self.s3 is not None:
            return self.s3
        raise AttachmentStoreUnavailable()

    def alternate_store_for(self, backend: str) -> AttachmentObjectStore | None:
        if backend == "local":
            return self.s3
        if backend == "s3":
            return self.local
        raise AttachmentStoreUnavailable()
