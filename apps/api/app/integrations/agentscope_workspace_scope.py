"""Tenant/Workspace-scoped local AgentScope workdirs and file operations."""
from __future__ import annotations

import hashlib
import os
import stat
import tarfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, AsyncIterator
from contextvars import ContextVar
from uuid import uuid4

from fastapi import HTTPException

from app.integrations.agentscope_session_scope import current_agentscope_context
from app.tenancy.context import WorkspaceContext


def _scope_prefix(context: WorkspaceContext) -> str:
    return f"synapse-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"


_allowed_mcp_names: ContextVar[frozenset[str] | None] = ContextVar(
    "agentscope_allowed_mcp_names", default=None,
)


class ScopedWorkspace:
    """Workspace facade that gates MCP connection materialization."""

    def __init__(self, workspace: Any, storage: Any, user_id: str) -> None:
        self._workspace = workspace
        self._storage = storage
        self._user_id = user_id
        if not getattr(workspace, "_synapse_mcp_scope_wrapped", False):
            original_declared_specs = workspace._declared_specs

            def scoped_declared_specs(agent_id: str, session_id: str) -> list[Any]:
                specs = original_declared_specs(agent_id, session_id)
                allowed = _allowed_mcp_names.get()
                return specs if allowed is None else [spec for spec in specs if spec.name in allowed]

            workspace._declared_specs = scoped_declared_specs
            workspace._synapse_mcp_scope_wrapped = True

    def __getattr__(self, name: str) -> Any:
        return getattr(self._workspace, name)

    async def list_mcps(self, *, agent_id: str | None = None,
                        session_id: str | None = None) -> list[Any]:
        records = await self._storage.list_mcps(self._user_id)
        enabled = {record.client.name for record in records if record.enabled}
        token = _allowed_mcp_names.set(frozenset(enabled))
        try:
            # Close already-materialized clients whose library entries were
            # disabled or removed before allowing the upstream method to run.
            key = (agent_id or "", session_id or "")
            async with self._workspace._mcp_lock:
                live = self._workspace._mcp_instances.get(key, {})
                for name in list(live):
                    if name not in enabled:
                        client = live.pop(name)
                        await self._workspace._close_mcp_instance(client)
            return await self._workspace.list_mcps(agent_id=agent_id, session_id=session_id)
        finally:
            _allowed_mcp_names.reset(token)

    async def add_mcp(self, mcp_client: Any, *, agent_id: str | None = None,
                      session_id: str | None = None) -> Any:
        record = await self._storage.get_mcp_by_name(self._user_id, mcp_client.name)
        if record is None:
            # The upstream manual-install route calls Workspace.add_mcp before
            # persisting its library record. Persist it in this verified scope
            # first so the connection is never materialized from request-only
            # configuration and subsequent list/delete operations can govern it.
            from agentscope.app.storage import MCPRecord as MCPStorageRecord
            record = MCPStorageRecord(user_id=self._user_id, client=mcp_client)
            await self._storage.upsert_mcp(self._user_id, record)
        if not record.enabled:
            raise ValueError("MCP is not enabled in this Workspace scope")
        if record.client.model_dump(mode="json") != mcp_client.model_dump(mode="json"):
            raise ValueError("MCP connection config does not match the scoped library record")
        return await self._workspace.add_mcp(
            record.client, agent_id=agent_id, session_id=session_id,
        )

    async def list_skills(self, *, agent_id: str | None = None) -> list[Any]:
        # The wrapped LocalWorkspace already uses a tenant/Workspace/actor
        # workdir and a hashed, scoped agent partition.
        return await self._workspace.list_skills(agent_id=agent_id)

    async def add_skill(self, skill_path: str, *, agent_id: str | None = None) -> None:
        # The deprecated route reads a server-local path directly, bypassing
        # the confined workspace backend. Only archive/upload and library
        # installation paths are safe in the embedded service.
        del skill_path, agent_id
        raise HTTPException(status_code=400, detail={"code": "SKILL_PATH_INSTALL_DISABLED"})

    async def add_skill_archive(self, stream: AsyncIterator[bytes], fmt: str,
                                dir_name: str, max_extracted_bytes: int = 500 * 1024 * 1024,
                                *, agent_id: str | None = None) -> None:
        del dir_name  # Skill directory naming comes from SKILL.md front matter.
        if fmt not in {"zip", "tar", "tar.gz"}:
            raise ValueError("Unsupported Skill archive format")
        if not 0 < max_extracted_bytes <= 500 * 1024 * 1024:
            raise ValueError("Skill archive extraction limit is invalid")
        backend = self._workspace._backend
        suffix = ".tar.gz" if fmt == "tar.gz" else f".{fmt}"
        token = uuid4().hex
        staging = os.path.join(self._workspace.workdir, f".skill-staging-{token}")
        archive_path = staging + suffix
        try:
            await backend.write_stream(archive_path, self._limited_archive_stream(stream))
            await backend.exec_shell(["mkdir", "-p", staging])
            if fmt == "zip":
                with zipfile.ZipFile(archive_path) as archive:
                    entries = [(item.filename, item.file_size, item) for item in archive.infolist()]
                    total = sum(size for _, size, _ in entries)
                    if total > max_extracted_bytes:
                        raise ValueError("Skill archive exceeds the extraction limit")
                    seen: set[str] = set()
                    for name, _, item in entries:
                        target = self._skill_archive_target(staging, name, seen)
                        mode = (item.external_attr >> 16) & 0o170000
                        if mode == stat.S_IFLNK:
                            raise ValueError("Skill archives may not contain symbolic links")
                        if item.is_dir():
                            await backend.exec_shell(["mkdir", "-p", target])
                        else:
                            await backend.exec_shell(["mkdir", "-p", os.path.dirname(target)])
                            # ZipExtFile is synchronous (unlike the async
                            # backend stream interface); close it with its
                            # native context manager while _file_chunks
                            # adapts reads to an async iterator.
                            with archive.open(item) as source:
                                await backend.write_stream(target, self._file_chunks(source))
            else:
                with tarfile.open(archive_path, mode="r:*") as archive:
                    entries = archive.getmembers()
                    total = sum(item.size for item in entries if item.isfile())
                    if total > max_extracted_bytes:
                        raise ValueError("Skill archive exceeds the extraction limit")
                    seen = set()
                    for item in entries:
                        target = self._skill_archive_target(staging, item.name, seen)
                        if item.isdir():
                            await backend.exec_shell(["mkdir", "-p", target])
                        elif item.isfile():
                            await backend.exec_shell(["mkdir", "-p", os.path.dirname(target)])
                            source = archive.extractfile(item)
                            if source is None:
                                raise ValueError("Invalid file in Skill archive")
                            with source:
                                await backend.write_stream(target, self._file_chunks(source))
                        else:
                            raise ValueError("Skill archives may contain only regular files and directories")
            skill_root = await self._workspace._find_skill_root(staging)
            # The upstream add_skill path stages a tar under host /tmp and
            # invokes another host-side extraction shim. Install the already
            # validated tree with a same-workdir atomic rename instead.
            partition = await self._workspace._equip_partition(agent_id)
            backend = self._workspace._backend
            target_name = f"skill-{uuid4().hex[:12]}"
            target = backend.join_path(partition, target_name)
            source_path = backend._resolve(skill_root)
            target_path = backend._resolve(target)
            async with self._workspace._skill_lock:
                if await backend.file_exists(target):
                    raise ValueError("Skill installation name collision")
                if os.path.commonpath((backend._root, os.path.realpath(source_path))) != backend._root:
                    raise ValueError("Skill extraction escaped the current workdir")
                if os.path.dirname(target_path) != backend._resolve(partition):
                    raise ValueError("Skill target escaped its agent partition")
                os.rename(source_path, target_path)
        finally:
            await backend.delete_path(staging)
            await backend.delete_path(archive_path)

    @staticmethod
    def _skill_archive_target(staging: str, name: str, seen: set[str]) -> str:
        normalized = name.rstrip("/")
        parts = PurePosixPath(normalized).parts
        if (not normalized or "\\" in normalized or "\x00" in normalized
                or PureWindowsPath(normalized).is_absolute()
                or PurePosixPath(normalized).is_absolute()
                or any(part in {"", ".", ".."} for part in parts)):
            raise ValueError("Skill archive contains an unsafe path")
        key = "/".join(parts)
        if key in seen:
            raise ValueError("Skill archive contains duplicate paths")
        seen.add(key)
        return os.path.join(staging, *parts)

    @staticmethod
    async def _file_chunks(source: Any) -> AsyncIterator[bytes]:
        while chunk := source.read(64 * 1024):
            yield chunk

    @staticmethod
    async def _limited_archive_stream(stream: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
        total = 0
        async for chunk in stream:
            total += len(chunk)
            if total > 500 * 1024 * 1024:
                raise ValueError("Skill archive exceeds the upload limit")
            yield chunk

    async def remove_skill(self, name: str, *, agent_id: str | None = None) -> None:
        await self._workspace.remove_skill(name, agent_id=agent_id)


class ScopedLocalWorkspaceManager:
    """Adapt the pinned LocalWorkspaceManager to collaboration Workspace scope.

    Actor scoping is intentional: local runtime files and files produced by
    personal sessions remain private to the actor even inside a shared
    collaboration Workspace.
    """

    def __init__(self, manager: Any) -> None:
        self._manager = manager
        self._base = os.path.realpath(manager._basedir)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._manager, name)

    async def __aenter__(self) -> "ScopedLocalWorkspaceManager":
        await self._manager.__aenter__()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self._manager.__aexit__(exc_type, exc, tb)

    def _context(self) -> WorkspaceContext:
        context = current_agentscope_context()
        if context is None:
            raise RuntimeError("AgentScope workdir access requires a verified Workspace context")
        return context

    def _workspace_id(self, value: str | None, context: WorkspaceContext) -> str:
        prefix = _scope_prefix(context)
        if value is None or value == "":
            value = "default"
        if value.startswith("synapse-t"):
            if value.startswith(prefix):
                return value
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND"})
        if os.path.isabs(value) or "\\" in value or "/" in value or value in {".", ".."}:
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
        return prefix + value

    def _agent_path_key(self, agent_id: str, context: WorkspaceContext) -> str:
        digest = hashlib.sha256(agent_id.encode("utf-8")).hexdigest()
        return os.path.join(
            f"tenant-{context.tenant_id}",
            f"workspace-{context.workspace_id}",
            f"actor-{context.actor_user_id}",
            f"agent-{digest}",
        )

    def _prepare_parent(self, agent_key: str) -> None:
        current = self._base
        for part in Path(agent_key).parts:
            if part in {"", ".", ".."}:
                raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
            current = os.path.join(current, part)
            if os.path.lexists(current) and os.path.islink(current):
                raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
            os.makedirs(current, exist_ok=True)
            if os.path.commonpath((self._base, os.path.realpath(current))) != self._base:
                raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})

    @staticmethod
    def _assert_no_symlinks(root: str) -> None:
        # LocalWorkspace.initialize reads/writes these fixed paths directly
        # before the guarded backend is installed. Check just those paths here;
        # every later file operation validates its own component chain.
        for relative in (".mcp", "skills", os.path.join("skills", ".seed")):
            current = root
            for part in Path(relative).parts:
                current = os.path.join(current, part)
                if os.path.lexists(current) and os.path.islink(current):
                    raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})

    async def assign_workspace_id(self, *, user_id: str, agent_id: str,
                                  session_id: str) -> str:
        context = self._context()
        raw = await self._manager.assign_workspace_id(
            user_id=user_id, agent_id=agent_id, session_id=session_id,
        )
        return self._workspace_id(raw, context)

    async def get_workspace(self, user_id: str, agent_id: str, session_id: str,
                            workspace_id: str | None = None) -> Any:
        context = self._context()
        runtime_id = self._workspace_id(workspace_id, context)
        agent_key = self._agent_path_key(agent_id, context)
        self._prepare_parent(agent_key)
        workdir = os.path.join(self._base, agent_key)
        self._assert_no_symlinks(workdir)
        workspace = await self._manager.get_workspace(
            user_id=user_id,
            agent_id=agent_key,
            session_id=session_id,
            workspace_id=runtime_id,
        )
        if os.path.commonpath((self._base, os.path.realpath(workspace.workdir))) != self._base:
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
        if not isinstance(getattr(workspace, "_backend", None), ConfinedLocalBackend):
            workspace._backend = ConfinedLocalBackend(workspace._backend, workspace.workdir)
        return ScopedWorkspace(workspace, self._manager._storage, user_id)


class ConfinedLocalBackend:
    """Guard LocalBackend paths and disable unrestricted host shell access."""

    def __init__(self, backend: Any, root: str) -> None:
        self._backend = backend
        self._root = os.path.realpath(root)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._backend, name)

    def _resolve(self, path: str, *, reject_absolute: bool = False) -> str:
        raw = os.fspath(path)
        if reject_absolute and (os.path.isabs(raw) or PureWindowsPath(raw).is_absolute()):
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
        parts = PurePosixPath(raw.replace("\\", "/")).parts
        if ".." in parts:
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
        candidate = os.path.abspath(raw if os.path.isabs(raw) else os.path.join(self._root, raw))
        try:
            if os.path.commonpath((self._root, candidate)) != self._root:
                raise ValueError
            relative = os.path.relpath(candidate, self._root)
            current = self._root
            for part in Path(relative).parts:
                if part in {"", "."}:
                    continue
                current = os.path.join(current, part)
                if os.path.lexists(current) and os.path.islink(current):
                    raise ValueError
            resolved = os.path.realpath(candidate)
            if os.path.commonpath((self._root, resolved)) != self._root:
                raise ValueError
        except (ValueError, OSError):
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"}) from None
        return candidate

    def abspath(self, path: str, *, cwd: str) -> str:
        # Absolute paths from callers and traversal syntax are forbidden even
        # when they would normalize back inside the workdir.
        raw = os.fspath(path)
        if os.path.isabs(raw) or PureWindowsPath(raw).is_absolute():
            raise HTTPException(status_code=400, detail={"code": "WORKSPACE_PATH_FORBIDDEN"})
        cwd_path = self._resolve(cwd)
        return self._resolve(os.path.join(cwd_path, raw), reject_absolute=False)

    async def exec_shell(self, *args: Any, **kwargs: Any) -> Any:
        command = args[0] if args else None
        # AgentScope's Write tool invokes this one filesystem primitive before
        # writing. Reimplement it directly so no subprocess runs on the host.
        if isinstance(command, (list, tuple)) and len(command) == 3 and tuple(command[:2]) == ("mkdir", "-p"):
            target = self._resolve(command[2])
            os.makedirs(target, exist_ok=True)
            from agentscope.tool import ExecResult
            return ExecResult(exit_code=0, stdout=b"", stderr=b"")
        # First access to an agent's Skills partition copies the optional
        # .seed template. Permit only AgentScope's fixed copy-and-rename
        # shim, with both source and destination constrained to this
        # workspace's skills directory. This is not a general Python/shell
        # execution allowance.
        if isinstance(command, (list, tuple)) and len(command) == 5:
            import sys

            from agentscope.workspace._base import _EQUIP_PARTITION_SHIM

            executable, flag, shim, seed, partition = command
            skills_root = os.path.join(self._root, "skills")
            seed_path = self._resolve(seed)
            partition_path = self._resolve(partition)
            if (os.path.realpath(executable) == os.path.realpath(sys.executable)
                    and flag == "-c" and shim == _EQUIP_PARTITION_SHIM
                    and seed_path == os.path.join(skills_root, ".seed")
                    and os.path.dirname(partition_path) == skills_root
                    and os.path.basename(partition_path) not in {"", ".", "..", ".seed"}):
                return await self._backend.exec_shell(
                    list(command), cwd=self._root,
                    timeout=kwargs.get("timeout"),
                )
        # AgentScope's archive installer uses one pinned, shell-free Python
        # shim. Permit precisely that program, with both paths confined to
        # this workdir; arbitrary Python/shell and helper execution stay off.
        if isinstance(command, (list, tuple)) and len(command) == 7:
            import sys

            from agentscope.workspace._base import _EXTRACT_ARCHIVE_SHIM

            executable, flag, shim, archive, staging, archive_format, limit = command
            try:
                extracted_limit = int(limit)
            except (TypeError, ValueError):
                extracted_limit = -1
            if (os.path.realpath(executable) == os.path.realpath(sys.executable)
                    and flag == "-c" and shim == _EXTRACT_ARCHIVE_SHIM
                    and archive_format in {"zip", "tar", "tar.gz"}
                    and 0 < extracted_limit <= 500 * 1024 * 1024):
                archive_path = self._resolve(archive)
                staging_path = self._resolve(staging)
                if (os.path.dirname(archive_path) == self._root
                        and os.path.dirname(staging_path) == self._root
                        and os.path.basename(staging_path).startswith(".skill-staging-")
                        and archive_path == staging_path + "." + archive_format):
                    return await self._backend.exec_shell(
                        list(command), cwd=self._root,
                        timeout=kwargs.get("timeout"),
                    )
        # Arbitrary shell, rg, and helper-script execution can escape path
        # guards; those command-based tools remain unavailable on LocalBackend.
        raise PermissionError("Host command execution is disabled for tenant-scoped workdirs")

    async def read_file(self, path: str) -> bytes:
        return await self._backend.read_file(self._resolve(path))

    async def write_file(self, path: str, data: bytes) -> None:
        await self._backend.write_file(self._resolve(path), data)

    async def write_stream(self, path: str, stream: AsyncIterator[bytes]) -> None:
        await self._backend.write_stream(self._resolve(path), stream)

    def read_stream(self, path: str, *args: Any, **kwargs: Any) -> Any:
        return self._backend.read_stream(self._resolve(path), *args, **kwargs)

    async def file_exists(self, path: str) -> bool:
        return await self._backend.file_exists(self._resolve(path))

    async def is_dir(self, path: str) -> bool:
        return await self._backend.is_dir(self._resolve(path))

    async def list_dir(self, path: str, *args: Any, **kwargs: Any) -> Any:
        return await self._backend.list_dir(self._resolve(path), *args, **kwargs)

    async def scandir(self, path: str) -> Any:
        return await self._backend.scandir(self._resolve(path))

    async def stat(self, path: str) -> Any:
        return await self._backend.stat(self._resolve(path))

    async def stat_mtime(self, path: str) -> Any:
        return await self._backend.stat_mtime(self._resolve(path))

    async def delete_path(self, path: str) -> None:
        await self._backend.delete_path(self._resolve(path))
