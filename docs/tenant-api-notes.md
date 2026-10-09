# Tenant API implementation notes

Implemented under `/api/v1` in `apps/api`:

- `POST /tenants`: platform admin only. It transactionally creates the tenant, the selected existing active global account as tenant owner, `default` workspace, and that account's initial workspace owner membership. The platform administrator is not made a tenant or workspace member.
- `GET /me/context` and `GET /tenants`: return active tenant memberships and only active workspace memberships, with decimal string IDs. The ordinary tenant list supports `page`, `page_size`, optional case-insensitive `name` substring matching, and optional `status` (`active|suspended|archived`) filtering before pagination. It only queries active tenant memberships in active tenants, so requesting a suspended or archived status returns an empty list and never exposes those tenants.
- `GET /platform/tenants`: platform-admin-only paginated directory for tenant administration, with optional exact `status` and substring `name` filters. It returns tenant records without granting or implying tenant membership. The ordinary `GET /tenants` remains scoped to the caller's own active tenant memberships.
- `GET/PATCH /tenants/{tenant_id}` and paginated `GET /tenants/{tenant_id}/members`.
- `POST /tenants/{tenant_id}/members` and `PATCH /tenants/{tenant_id}/members/{user_id}` use existing global accounts. Tenant admins can manage non-owner members but cannot create/promote/operate on owners. Owner operations and the last active tenant owner are protected.
- Tenant member suspension/removal marks their active workspace memberships `removed`. Re-activation intentionally leaves these revoked workspace memberships removed; each must be re-granted through future workspace member management.
- Deactivating a tenant member is rejected with `409 LAST_OWNER_REQUIRED` if doing so would leave any active workspace without an active owner.

Workspace tables and their tenant-consistent composite foreign key are present because tenant creation requires a default workspace. Workspace CRUD, workspace member endpoints, ownership transfer and invitations/link delivery are not implemented in this change. Invite delivery is explicitly deferred; member addition references an already-existing active global user. Tenant and workspace status values and role values are validated by the API inputs. Schema migration is `0002_tenants`.
