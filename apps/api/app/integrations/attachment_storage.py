"""Local and S3-compatible attachment storage adapters."""

from __future__ import annotations

import os
import re
import stat
import time
import uuid
from pathlib import Path
from tempfile import SpooledTemporaryFile
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings
from app.services.attachment_storage import (
    AttachmentObjectInventory,
    AttachmentObjectMissing,
    AttachmentStorageRouter,
    AttachmentStorageScope,
    AttachmentStoreCleanupFailed,
    AttachmentStoreUnavailable,
)


_STORAGE_KEY = re.compile(r"^[a-f0-9]{32}$")


class LocalAttachmentStore:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()

    def put(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
        payload: bytes,
        media_type: str,
    ) -> None:
        del scope, media_type
        path = self.path_for_key(storage_key)
        temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path.write_bytes(payload)
            os.replace(temporary_path, path)
        except OSError as exc:
            self._cleanup_upload_path(temporary_path)
            raise AttachmentStoreUnavailable() from exc

    def open(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
    ) -> BinaryIO:
        del scope
        path = self.path_for_key(storage_key)
        try:
            if not path.is_file():
                raise AttachmentObjectMissing()
            return path.open("rb")
        except FileNotFoundError as exc:
            raise AttachmentObjectMissing() from exc
        except OSError as exc:
            raise AttachmentStoreUnavailable() from exc

    def delete(self, storage_key: str, scope: AttachmentStorageScope) -> None:
        del scope
        path = self.path_for_key(storage_key)
        self._unlink_storage_file(path)
        try:
            path.parent.rmdir()
        except OSError:
            pass

    def size(self, storage_key: str, scope: AttachmentStorageScope) -> int:
        del scope
        path = self.path_for_key(storage_key)
        try:
            file_stat = path.stat()
        except FileNotFoundError as exc:
            raise AttachmentObjectMissing() from exc
        except OSError as exc:
            raise AttachmentStoreUnavailable() from exc
        if not stat.S_ISREG(file_stat.st_mode):
            raise AttachmentObjectMissing()
        return file_stat.st_size

    def path_for_key(self, storage_key: str) -> Path:
        if not isinstance(storage_key, str) or not _STORAGE_KEY.fullmatch(storage_key):
            raise RuntimeError("Invalid persisted attachment storage key")
        path = (self.root / storage_key[:2] / storage_key[2:]).resolve()
        if self.root not in path.parents:
            raise RuntimeError("Attachment path escaped configured storage root")
        return path

    @staticmethod
    def _cleanup_upload_path(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    @staticmethod
    def _unlink_storage_file(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError as initial_error:
            last_error = initial_error
        except OSError as exc:
            raise AttachmentStoreCleanupFailed() from exc

        for delay in (0.01, 0.05, 0.1):
            try:
                path.stat()
            except FileNotFoundError:
                return
            except OSError as exc:
                raise AttachmentStoreCleanupFailed() from exc

            time.sleep(delay)
            try:
                path.unlink(missing_ok=True)
            except FileNotFoundError:
                return
            except PermissionError as exc:
                last_error = exc
            except OSError as exc:
                raise AttachmentStoreCleanupFailed() from exc
            else:
                return

        try:
            path.stat()
        except FileNotFoundError:
            return
        except OSError as exc:
            raise AttachmentStoreCleanupFailed() from exc
        raise AttachmentStoreCleanupFailed() from last_error


class S3AttachmentStore:
    def __init__(self, *, bucket: str, client) -> None:
        self.bucket = bucket
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> S3AttachmentStore:
        endpoint_url = settings.attachments_s3_endpoint_url
        bucket = settings.attachments_s3_bucket
        access_key = settings.attachments_s3_access_key_id
        secret_key = settings.attachments_s3_secret_access_key
        if not endpoint_url or not bucket or not access_key or not secret_key:
            raise AttachmentStoreUnavailable()
        try:
            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                region_name=settings.attachments_s3_region,
                aws_access_key_id=access_key.get_secret_value(),
                aws_secret_access_key=secret_key.get_secret_value(),
                config=Config(
                    signature_version="s3v4",
                    s3={
                        "addressing_style": (
                            "path" if settings.attachments_s3_force_path_style else "auto"
                        )
                    },
                    connect_timeout=5,
                    read_timeout=60,
                    retries={"max_attempts": 2},
                ),
            )
        except BotoCoreError as exc:
            raise AttachmentStoreUnavailable() from exc
        return cls(bucket=bucket, client=client)

    def put(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
        payload: bytes,
        media_type: str,
    ) -> None:
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=self._object_key(storage_key, scope),
                Body=payload,
                ContentType=media_type,
            )
        except (BotoCoreError, ClientError) as exc:
            raise AttachmentStoreUnavailable() from exc

    def open(
        self,
        storage_key: str,
        scope: AttachmentStorageScope,
    ):
        spool = SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        body = None
        try:
            response = self.client.get_object(
                Bucket=self.bucket,
                Key=self._object_key(storage_key, scope),
            )
            body = response["Body"]
            expected_size = response.get("ContentLength")
            actual_size = 0
            while chunk := body.read(64 * 1024):
                spool.write(chunk)
                actual_size += len(chunk)
            if expected_size is not None and actual_size != expected_size:
                raise AttachmentStoreUnavailable()
            spool.seek(0)
            return spool
        except ClientError as exc:
            spool.close()
            if self._is_missing_object(exc):
                raise AttachmentObjectMissing() from exc
            raise AttachmentStoreUnavailable() from exc
        except BotoCoreError as exc:
            spool.close()
            raise AttachmentStoreUnavailable() from exc
        except (AttachmentObjectMissing, AttachmentStoreUnavailable):
            spool.close()
            raise
        except OSError as exc:
            spool.close()
            raise AttachmentStoreUnavailable() from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except (BotoCoreError, ClientError, OSError):
                    pass

    def delete(self, storage_key: str, scope: AttachmentStorageScope) -> None:
        try:
            self.client.delete_object(
                Bucket=self.bucket,
                Key=self._object_key(storage_key, scope),
            )
        except (BotoCoreError, ClientError) as exc:
            raise AttachmentStoreUnavailable() from exc

    def size(self, storage_key: str, scope: AttachmentStorageScope) -> int:
        try:
            response = self.client.head_object(
                Bucket=self.bucket,
                Key=self._object_key(storage_key, scope),
            )
        except ClientError as exc:
            if self._is_missing_object(exc):
                raise AttachmentObjectMissing() from exc
            raise AttachmentStoreUnavailable() from exc
        except BotoCoreError as exc:
            raise AttachmentStoreUnavailable() from exc
        return int(response["ContentLength"])

    def count_orphan_objects(
        self,
        tenant_id: int,
        tracked_objects: set[tuple[str, AttachmentStorageScope]],
    ) -> int:
        expected_keys = {
            self._object_key(storage_key, scope)
            for storage_key, scope in tracked_objects
        }
        prefix = self._tenant_prefix(tenant_id)
        count = 0
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for item in page.get("Contents", ()):
                    object_key = item.get("Key")
                    if (
                        isinstance(object_key, str)
                        and object_key.startswith(prefix)
                        and object_key not in expected_keys
                    ):
                        count += 1
        except (BotoCoreError, ClientError) as exc:
            raise AttachmentStoreUnavailable() from exc
        return count

    @staticmethod
    def _object_key(storage_key: str, scope: AttachmentStorageScope) -> str:
        if not isinstance(storage_key, str) or not _STORAGE_KEY.fullmatch(storage_key):
            raise RuntimeError("Invalid persisted attachment storage key")
        if (
            type(scope.tenant_id) is not int
            or scope.tenant_id < 1
            or type(scope.workspace_id) is not int
            or scope.workspace_id < 1
        ):
            raise RuntimeError("Invalid persisted attachment storage scope")
        if scope.scope_kind == "personal":
            if type(scope.owner_user_id) is not int or scope.owner_user_id < 1:
                raise RuntimeError("Personal attachment owner is required")
            owner_path = f"personal/{scope.owner_user_id}"
        elif scope.scope_kind == "workspace" and scope.owner_user_id is None:
            owner_path = "workspace-shared"
        else:
            raise RuntimeError("Invalid persisted attachment storage scope")
        return (
            f"{S3AttachmentStore._tenant_prefix(scope.tenant_id)}"
            f"workspaces/{scope.workspace_id}/{owner_path}/{storage_key}"
        )

    @staticmethod
    def _tenant_prefix(tenant_id: int) -> str:
        if type(tenant_id) is not int or tenant_id < 1:
            raise RuntimeError("Invalid persisted attachment storage scope")
        return f"synapse/attachments/v1/tenants/{tenant_id}/"

    @staticmethod
    def _is_missing_object(error: ClientError) -> bool:
        response = error.response
        error_code = response.get("Error", {}).get("Code")
        status_code = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return status_code == 404 and error_code in {"NoSuchKey", "NotFound", "404"}


def create_attachment_storage(settings: Settings) -> AttachmentStorageRouter:
    local = LocalAttachmentStore(settings.attachments_storage_path)
    access_key = settings.attachments_s3_access_key_id
    secret_key = settings.attachments_s3_secret_access_key
    s3_configured = all(
        (
            settings.attachments_s3_endpoint_url,
            settings.attachments_s3_bucket,
            access_key,
            secret_key,
        )
    )
    s3 = S3AttachmentStore.from_settings(settings) if s3_configured else None
    if settings.attachments_storage_backend == "s3" and s3 is None:
        raise AttachmentStoreUnavailable()
    return AttachmentStorageRouter(
        local=local,
        s3=s3,
        default_backend=settings.attachments_storage_backend,
    )
