"""Workspace namespace adapter for selected AgentScope storage records."""
from __future__ import annotations

import hashlib
import json
from contextvars import ContextVar, Token
from uuid import uuid4
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, SecretStr

from app.tenancy.context import WorkspaceContext


_workspace_context: ContextVar[WorkspaceContext | None] = ContextVar(
    "agentscope_workspace_context", default=None,
)


class _EncryptedCredentialWrite(BaseModel):
    """Storage payload containing only safe labels and authenticated ciphertext."""

    id: str
    name: str
    type: str
    synapse_ciphertext_v1: str


def bind_agentscope_context(context: WorkspaceContext) -> Token[WorkspaceContext | None]:
    """Bind the verified request context for storage calls and inherited tasks."""
    return _workspace_context.set(context)


def reset_agentscope_context(token: Token[WorkspaceContext | None]) -> None:
    _workspace_context.reset(token)


def current_agentscope_context() -> WorkspaceContext | None:
    return _workspace_context.get()


class WorkspaceSessionStorage:
    """Storage adapter with tenant/Workspace namespaces for selected records.

    The public session ID is also the Redis/SQL session key. Prefixing it with
    the verified tenant, Workspace, and actor namespace isolates message keys
    and runtime bus keys that are derived from the session ID. Agent, knowledge
    base, document metadata, MCP, Skills, and credential records use related
    namespaces. Credential payloads are encrypted before persistence and
    exposed only through the runtime resolver. Other AgentScope storage
    methods remain unchanged for later resource-specific tasks.
    """

    def __init__(self, storage: Any, credential_encryption_key: str | None = None) -> None:
        self._storage = storage
        self._credential_encryption_key = credential_encryption_key
        self._credential_cipher: Any | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._storage, name)

    async def __aenter__(self) -> "WorkspaceSessionStorage":
        await self._storage.__aenter__()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self._storage.__aexit__(exc_type, exc, tb)

    def _credential_fernet(self) -> Any:
        if not self._credential_encryption_key:
            raise HTTPException(
                status_code=503,
                detail={"code": "MODEL_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED"},
            )
        if self._credential_cipher is None:
            from cryptography.fernet import Fernet

            try:
                self._credential_cipher = Fernet(self._credential_encryption_key.encode("ascii"))
            except (ValueError, UnicodeEncodeError) as exc:
                raise HTTPException(
                    status_code=503,
                    detail={"code": "MODEL_CREDENTIAL_ENCRYPTION_KEY_INVALID"},
                ) from exc
        return self._credential_cipher

    def _prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope session access requires a verified Workspace context")
        # IDs are numeric in Synapse. Delimiters make the composite unambiguous.
        return f"synapse-s{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _agent_prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope agent access requires a verified Workspace context")
        return f"synapse-agent-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _agent_id(self, agent_id: str, *, allow_new: bool = False) -> str | None:
        prefix = self._agent_prefix()
        if agent_id.startswith(prefix):
            return agent_id
        if agent_id.startswith("synapse-agent-t"):
            return None
        return f"{prefix}{agent_id}" if allow_new else None

    def _knowledge_base_prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope knowledge access requires a verified Workspace context")
        return f"synapse-kb-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _knowledge_base_id(self, value: str, *, allow_new: bool = True) -> str | None:
        prefix = self._knowledge_base_prefix()
        if value.startswith(prefix):
            return value
        if value.startswith("synapse-kb-t"):
            return None
        return f"{prefix}{value}" if allow_new else None

    def _document_prefix(self, knowledge_base_id: str) -> str:
        digest = hashlib.sha256(knowledge_base_id.encode("utf-8")).hexdigest()[:24]
        return f"synapse-doc-{digest}-"

    def _document_id(self, knowledge_base_id: str, value: str,
                     *, allow_new: bool = True) -> str | None:
        prefix = self._document_prefix(knowledge_base_id)
        if value.startswith(prefix):
            return value
        if value.startswith("synapse-doc-"):
            return None
        return f"{prefix}{value}" if allow_new else None

    def _mcp_prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope MCP access requires a verified Workspace context")
        return f"synapse-mcp-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _mcp_owner_id(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope MCP access requires a verified Workspace context")
        return f"synapse-mcp-owner-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}"

    def _mcp_id(self, value: str, *, allow_new: bool = False) -> str | None:
        prefix = self._mcp_prefix()
        if value.startswith(prefix):
            return value
        if value.startswith("synapse-mcp-t"):
            return None
        return f"{prefix}{value}" if allow_new else None

    async def upsert_mcp(self, user_id: str, mcp_record: Any) -> str:
        mcp_id = self._mcp_id(mcp_record.id, allow_new=True)
        if mcp_id is None:
            raise ValueError("MCP belongs to another Workspace")
        owner_id = self._mcp_owner_id()
        scoped = mcp_record.model_copy(update={"id": mcp_id, "user_id": owner_id})
        return await self._storage.upsert_mcp(owner_id, scoped)

    async def list_mcps(self, user_id: str) -> list[Any]:
        owner_id = self._mcp_owner_id()
        prefix = self._mcp_prefix()
        rows = await self._storage.list_mcps(owner_id)
        return [row for row in rows if row.id.startswith(prefix)]

    async def get_mcp(self, user_id: str, mcp_id: str) -> Any:
        scoped = self._mcp_id(mcp_id)
        return await self._storage.get_mcp(self._mcp_owner_id(), scoped) if scoped else None

    async def get_mcp_by_name(self, user_id: str, name: str) -> Any:
        return await self._storage.get_mcp_by_name(self._mcp_owner_id(), name)

    async def delete_mcp(self, user_id: str, mcp_id: str) -> bool:
        scoped = self._mcp_id(mcp_id)
        return await self._storage.delete_mcp(self._mcp_owner_id(), scoped) if scoped else False

    def _credential_prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope credential access requires a verified Workspace context")
        return f"synapse-credential-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _credential_owner_id(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope credential access requires a verified Workspace context")
        return f"synapse-credential-owner-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}"

    def _assert_credential_actor(self, user_id: str) -> None:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope credential access requires a verified Workspace context")
        if str(context.actor_user_id) != str(user_id):
            raise HTTPException(status_code=404, detail={"code": "RESOURCE_NOT_FOUND"})

    def _credential_id(self, value: str, *, allow_new: bool = False) -> str | None:
        prefix = self._credential_prefix()
        if value.startswith(prefix):
            return value
        if value.startswith("synapse-credential-t"):
            return None
        return f"{prefix}{value}" if allow_new else None

    def _scope_credential_config(self, config: Any) -> Any:
        if config is None:
            return None
        credential_id = self._credential_id(config.credential_id)
        if credential_id is None:
            raise ValueError("Model credential belongs to another Workspace")
        return config.model_copy(update={"credential_id": credential_id})

    @staticmethod
    def _credential_plaintext(model: Any) -> dict[str, Any]:
        payload = model.model_dump(mode="json")
        for field_name in model.__class__.model_fields:
            value = getattr(model, field_name, None)
            if isinstance(value, SecretStr):
                payload[field_name] = value.get_secret_value()
        return payload

    def _encrypt_credential(self, credential_id: str, payload: dict[str, Any]) -> str:
        envelope = json.dumps({
            "scope": self._credential_owner_id(),
            "id": credential_id,
            "data": payload,
        }, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return self._credential_fernet().encrypt(envelope).decode("ascii")

    def _decrypt_credential(self, record: Any) -> dict[str, Any] | None:
        from cryptography.fernet import InvalidToken

        token = record.data.get("synapse_ciphertext_v1")
        if not isinstance(token, str):
            return None
        try:
            envelope = json.loads(self._credential_fernet().decrypt(token.encode("ascii")))
        except (InvalidToken, ValueError, UnicodeEncodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Stored AgentScope credential cannot be decrypted") from exc
        if (envelope.get("scope") != self._credential_owner_id()
                or envelope.get("id") != record.id
                or not isinstance(envelope.get("data"), dict)):
            raise RuntimeError("Stored AgentScope credential scope does not match its key")
        payload = envelope["data"]
        payload["id"] = record.id
        payload["name"] = record.data.get("name", payload.get("name", ""))
        payload["type"] = record.data.get("type", payload.get("type"))
        return payload

    async def upsert_credential(self, user_id: str, credential_data: Any) -> str:
        self._assert_credential_actor(user_id)
        scoped_id = self._credential_id(credential_data.id, allow_new=True)
        if scoped_id is None:
            raise ValueError("Credential belongs to another Workspace")
        owner_id = self._credential_owner_id()
        payload = self._credential_plaintext(credential_data)
        payload["id"] = scoped_id
        provider_type = payload.get("type")
        if not isinstance(provider_type, str) or not provider_type:
            raise ValueError("Credential provider type is required")
        encrypted = self._encrypt_credential(scoped_id, payload)
        safe_record = _EncryptedCredentialWrite(
            id=scoped_id,
            name=str(payload.get("name") or ""),
            type=provider_type,
            synapse_ciphertext_v1=encrypted,
        )
        return await self._storage.upsert_credential(owner_id, safe_record)

    async def list_credentials(self, user_id: str) -> list[Any]:
        from agentscope.app.storage import CredentialRecord

        self._assert_credential_actor(user_id)
        owner_id = self._credential_owner_id()
        prefix = self._credential_prefix()
        rows = await self._storage.list_credentials(owner_id)
        visible = []
        for row in rows:
            if not row.id.startswith(prefix) or not isinstance(row.data.get("synapse_ciphertext_v1"), str):
                continue
            visible.append(CredentialRecord(
                id=row.id,
                user_id=user_id,
                created_at=row.created_at,
                updated_at=row.updated_at,
                data={key: row.data[key] for key in ("type", "name") if key in row.data},
            ))
        return visible

    async def get_credential(self, user_id: str, credential_id: str) -> Any:
        from agentscope.app.storage import CredentialRecord

        self._assert_credential_actor(user_id)
        scoped = self._credential_id(credential_id)
        if scoped is None:
            return None
        row = await self._storage.get_credential(self._credential_owner_id(), scoped)
        if row is None or not row.id.startswith(self._credential_prefix()):
            return None
        if not isinstance(row.data.get("synapse_ciphertext_v1"), str):
            return None
        return CredentialRecord(
            id=row.id,
            user_id=user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
            data={key: row.data[key] for key in ("type", "name") if key in row.data},
        )

    async def get_credential_for_runtime(self, user_id: str, credential_id: str) -> Any:
        from agentscope.app.storage import CredentialRecord

        self._assert_credential_actor(user_id)
        scoped = self._credential_id(credential_id)
        if scoped is None:
            return None
        row = await self._storage.get_credential(self._credential_owner_id(), scoped)
        if row is None or not row.id.startswith(self._credential_prefix()):
            return None
        payload = self._decrypt_credential(row)
        if payload is None:
            return None
        return CredentialRecord(
            id=row.id,
            user_id=user_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
            data=payload,
        )

    async def delete_credential(self, user_id: str, credential_id: str) -> bool:
        self._assert_credential_actor(user_id)
        scoped = self._credential_id(credential_id)
        return await self._storage.delete_credential(
            self._credential_owner_id(), scoped,
        ) if scoped else False

    def _skill_prefix(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope Skill access requires a verified Workspace context")
        return f"synapse-skill-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}-"

    def _skill_owner_id(self) -> str:
        context = _workspace_context.get()
        if context is None:
            raise RuntimeError("AgentScope Skill access requires a verified Workspace context")
        return f"synapse-skill-owner-t{context.tenant_id}-w{context.workspace_id}-u{context.actor_user_id}"

    def _skill_id(self, value: str, *, allow_new: bool = False) -> str | None:
        prefix = self._skill_prefix()
        if value.startswith(prefix):
            return value
        if value.startswith("synapse-skill-t"):
            return None
        return f"{prefix}{value}" if allow_new else None

    async def upsert_skill(self, user_id: str, skill_record: Any) -> str:
        skill_id = self._skill_id(skill_record.id, allow_new=True)
        if skill_id is None:
            raise ValueError("Skill belongs to another Workspace")
        owner_id = self._skill_owner_id()
        scoped = skill_record.model_copy(update={"id": skill_id, "user_id": owner_id})
        return await self._storage.upsert_skill(owner_id, scoped)

    async def list_skills(self, user_id: str) -> list[Any]:
        owner_id = self._skill_owner_id()
        prefix = self._skill_prefix()
        rows = await self._storage.list_skills(owner_id)
        return [row.model_copy(update={"user_id": user_id}) for row in rows if row.id.startswith(prefix)]

    async def get_skill(self, user_id: str, skill_id: str) -> Any:
        scoped = self._skill_id(skill_id)
        if scoped is None:
            return None
        record = await self._storage.get_skill(self._skill_owner_id(), scoped)
        return record.model_copy(update={"user_id": user_id}) if record is not None else None

    async def delete_skill(self, user_id: str, skill_id: str) -> bool:
        scoped = self._skill_id(skill_id)
        return await self._storage.delete_skill(self._skill_owner_id(), scoped) if scoped else False

    async def upsert_knowledge_base(self, user_id: str, record: Any) -> Any:
        scoped_id = self._knowledge_base_id(record.id)
        if scoped_id is None:
            raise ValueError("Knowledge base belongs to another Workspace")
        scoped = record.model_copy(update={"id": scoped_id, "user_id": user_id})
        return await self._storage.upsert_knowledge_base(user_id, scoped)

    async def get_knowledge_base(self, user_id: str, knowledge_base_id: str) -> Any:
        scoped = self._knowledge_base_id(knowledge_base_id)
        return await self._storage.get_knowledge_base(user_id, scoped) if scoped else None

    async def list_knowledge_bases(self, user_id: str) -> list[Any]:
        prefix = self._knowledge_base_prefix()
        records = await self._storage.list_knowledge_bases(user_id)
        return [record for record in records if record.id.startswith(prefix)]

    async def delete_knowledge_base(self, user_id: str, knowledge_base_id: str) -> bool:
        scoped = self._knowledge_base_id(knowledge_base_id)
        return await self._storage.delete_knowledge_base(user_id, scoped) if scoped else False

    async def upsert_knowledge_document(self, user_id: str, record: Any) -> Any:
        knowledge_base_id = self._knowledge_base_id(record.knowledge_base_id)
        if knowledge_base_id is None:
            raise ValueError("Knowledge base belongs to another Workspace")
        document_id = self._document_id(knowledge_base_id, record.id)
        if document_id is None:
            raise ValueError("Document belongs to another Workspace")
        scoped = record.model_copy(update={
            "id": document_id,
            "knowledge_base_id": knowledge_base_id,
            "user_id": user_id,
        })
        return await self._storage.upsert_knowledge_document(user_id, scoped)

    async def get_knowledge_document(self, user_id: str, knowledge_base_id: str,
                                    document_id: str) -> Any:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        if scoped_kb is None:
            return None
        scoped_doc = self._document_id(scoped_kb, document_id)
        return await self._storage.get_knowledge_document(user_id, scoped_kb, scoped_doc) if scoped_doc else None

    async def list_knowledge_documents(self, user_id: str, knowledge_base_id: str) -> list[Any]:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        if scoped_kb is None:
            return []
        prefix = self._document_prefix(scoped_kb)
        records = await self._storage.list_knowledge_documents(user_id, scoped_kb)
        return [record for record in records if record.id.startswith(prefix)]

    async def delete_knowledge_document(self, user_id: str, knowledge_base_id: str,
                                        document_id: str) -> bool:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        if scoped_kb is None:
            return False
        scoped_doc = self._document_id(scoped_kb, document_id)
        return await self._storage.delete_knowledge_document(user_id, scoped_kb, scoped_doc) if scoped_doc else False

    async def update_knowledge_document_status(self, user_id: str, knowledge_base_id: str,
                                               document_id: str, status: Any,
                                               error: str | None = None,
                                               chunk_count: int | None = None) -> None:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        scoped_doc = self._document_id(scoped_kb, document_id) if scoped_kb else None
        if scoped_kb is not None and scoped_doc is not None:
            await self._storage.update_knowledge_document_status(
                user_id, scoped_kb, scoped_doc, status, error, chunk_count,
            )

    async def acquire_knowledge_document_lease(self, user_id: str, knowledge_base_id: str,
                                               document_id: str, processing_node: str,
                                               lease_ttl: Any, now: Any = None) -> bool:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        scoped_doc = self._document_id(scoped_kb, document_id) if scoped_kb else None
        if scoped_kb is None or scoped_doc is None:
            return False
        return await self._storage.acquire_knowledge_document_lease(
            user_id, scoped_kb, scoped_doc, processing_node, lease_ttl, now,
        )

    async def renew_knowledge_document_lease(self, user_id: str, knowledge_base_id: str,
                                             document_id: str, processing_node: str,
                                             lease_ttl: Any, now: Any = None) -> bool:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        scoped_doc = self._document_id(scoped_kb, document_id) if scoped_kb else None
        if scoped_kb is None or scoped_doc is None:
            return False
        return await self._storage.renew_knowledge_document_lease(
            user_id, scoped_kb, scoped_doc, processing_node, lease_ttl, now,
        )

    async def release_knowledge_document_lease(self, user_id: str, knowledge_base_id: str,
                                               document_id: str, processing_node: str) -> None:
        scoped_kb = self._knowledge_base_id(knowledge_base_id)
        scoped_doc = self._document_id(scoped_kb, document_id) if scoped_kb else None
        if scoped_kb is not None and scoped_doc is not None:
            await self._storage.release_knowledge_document_lease(
                user_id, scoped_kb, scoped_doc, processing_node,
            )

    async def list_knowledge_documents_with_expired_lease(self, now: Any = None) -> list[Any]:
        prefix = self._knowledge_base_prefix()
        docs = await self._storage.list_knowledge_documents_with_expired_lease(now)
        return [doc for doc in docs if doc.knowledge_base_id.startswith(prefix)]

    async def list_knowledge_documents_pending_since(self, threshold: Any) -> list[Any]:
        prefix = self._knowledge_base_prefix()
        docs = await self._storage.list_knowledge_documents_pending_since(threshold)
        return [doc for doc in docs if doc.knowledge_base_id.startswith(prefix)]

    async def upsert_agent(self, user_id: str, agent_record: Any) -> str:
        agent_id = self._agent_id(agent_record.id, allow_new=True)
        if agent_id is None:
            raise ValueError("Agent belongs to another Workspace")
        scoped_record = agent_record.model_copy(update={"id": agent_id, "user_id": user_id})
        return await self._storage.upsert_agent(user_id, scoped_record)

    async def list_agents(self, user_id: str) -> list[Any]:
        prefix = self._agent_prefix()
        rows = await self._storage.list_agents(user_id)
        return [row for row in rows if row.id.startswith(prefix)]

    async def get_agent(self, user_id: str, agent_id: str) -> Any:
        scoped = self._agent_id(agent_id)
        return await self._storage.get_agent(user_id, scoped) if scoped else None

    async def delete_agent(self, user_id: str, agent_id: str) -> bool:
        scoped = self._agent_id(agent_id)
        return await self._storage.delete_agent(user_id, scoped) if scoped else False

    def _scoped_id(self, session_id: str, *, allow_new: bool = False) -> str | None:
        prefix = self._prefix()
        if session_id.startswith(prefix):
            return session_id
        # Existing foreign-scope identifiers must never be reinterpreted as
        # raw IDs. Raw IDs are accepted only by explicit upsert/create flows.
        if session_id.startswith("synapse-s"):
            return None
        return f"{prefix}{session_id}" if allow_new else None

    async def upsert_session(self, user_id: str, agent_id: str, config: Any,
                             state: Any = None, session_id: str | None = None,
                             **kwargs: Any) -> Any:
        prefix = self._prefix()
        config = config.model_copy(update={
            "chat_model_config": self._scope_credential_config(config.chat_model_config),
            "fallback_chat_model_config": self._scope_credential_config(config.fallback_chat_model_config),
            "tts_model_config": self._scope_credential_config(config.tts_model_config),
        })
        knowledge_config = getattr(config, "knowledge_config", None)
        if knowledge_config is not None:
            scoped_knowledge_ids = []
            for knowledge_base_id in knowledge_config.knowledge_base_ids:
                scoped_knowledge_id = self._knowledge_base_id(knowledge_base_id)
                if scoped_knowledge_id is None:
                    raise ValueError("Knowledge base belongs to another Workspace")
                scoped_knowledge_ids.append(scoped_knowledge_id)
            config = config.model_copy(update={
                "knowledge_config": knowledge_config.model_copy(update={
                    "knowledge_base_ids": scoped_knowledge_ids,
                }),
            })
        if session_id is None:
            session_id = f"{prefix}{uuid4().hex}"
        else:
            scoped = self._scoped_id(session_id, allow_new=True)
            if scoped is None:
                raise ValueError("Session belongs to another Workspace")
            session_id = scoped
        return await self._storage.upsert_session(
            user_id=user_id, agent_id=agent_id, config=config, state=state,
            session_id=session_id, **kwargs,
        )

    async def get_session(self, user_id: str, agent_id: str, session_id: str) -> Any:
        scoped = self._scoped_id(session_id)
        if scoped is None:
            return None
        record = await self._storage.get_session(user_id, agent_id, scoped)
        # Some upstream storage backends look up sessions by ID and owner only.
        # The requested agent must match the stored binding before callers read
        # messages, lock status, or any other session-derived data.
        if record is None or record.id != scoped or record.agent_id != agent_id:
            return None
        return record

    async def list_sessions(self, user_id: str, agent_id: str) -> list[Any]:
        prefix = self._prefix()
        rows = await self._storage.list_sessions(user_id, agent_id)
        return [row for row in rows if row.id.startswith(prefix)]

    async def delete_session(self, user_id: str, agent_id: str, session_id: str) -> bool:
        scoped = self._scoped_id(session_id)
        return await self._storage.delete_session(user_id, agent_id, scoped) if scoped else False

    async def set_session_team_id(self, user_id: str, session_id: str,
                                  team_id: str | None) -> None:
        scoped = self._scoped_id(session_id)
        if scoped is None:
            return
        await self._storage.set_session_team_id(user_id, scoped, team_id)

    async def update_session_state(self, user_id: str, agent_id: str,
                                   session_id: str, state: Any) -> None:
        scoped = self._scoped_id(session_id)
        if scoped is None:
            raise KeyError("Session not found")
        await self._storage.update_session_state(user_id, agent_id, scoped, state)

    async def list_sessions_by_schedule(self, user_id: str, schedule_id: str) -> list[Any]:
        prefix = self._prefix()
        rows = await self._storage.list_sessions_by_schedule(user_id, schedule_id)
        return [row for row in rows if row.id.startswith(prefix)]

    async def list_sessions_by_channel(self, user_id: str, channel_id: str) -> list[Any]:
        prefix = self._prefix()
        rows = await self._storage.list_sessions_by_channel(user_id, channel_id)
        return [row for row in rows if row.id.startswith(prefix)]

    async def upsert_message(self, user_id: str, session_id: str, msg: Any) -> None:
        scoped = self._scoped_id(session_id)
        if scoped is None:
            raise ValueError("Session belongs to another Workspace")
        await self._storage.upsert_message(user_id, scoped, msg)

    async def get_message(self, user_id: str, session_id: str, message_id: str) -> Any:
        scoped = self._scoped_id(session_id)
        return await self._storage.get_message(user_id, scoped, message_id) if scoped else None

    async def list_messages(self, user_id: str, session_id: str, limit: int = 50,
                            before: str | None = None, **kwargs: Any) -> Any:
        scoped = self._scoped_id(session_id)
        if scoped is None:
            return [], False
        return await self._storage.list_messages(
            user_id, scoped, limit=limit, before=before, **kwargs,
        )
