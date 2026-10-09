# 租户邀请流程（F05a/F05d）

Tenant invitations are expiring, single-use links for an existing global account or an email address. The API does not send email; the authorized tenant owner/admin copies the returned token/link and delivers it out of band. Invitation tokens are generated with a cryptographically secure random source; only SHA-256 digests are stored. The raw token appears only in the creation response and must not be logged or persisted by the inviter UI.

## 端点

All paths use `/api/v1`. Invitation management and the existing-account acceptance endpoint require an authenticated active account. `register-and-accept` is intentionally anonymous because its bearer token is the authorization to create exactly one account for the invitation's email address; there is no general-purpose anonymous registration endpoint.

| 方法与路径 | 行为 |
| --- | --- |
| `POST /tenants/{tenant_id}/invitations` | Owner/admin creates an invitation. JSON accepts exactly one destination: `{ "email": "person@example.com", "tenant_role": "member", "expires_in_hours": 168 }` or `{ "user_id": "123", "tenant_role": "admin", "expires_in_hours": 168 }`. Expiry is 1–720 hours. Tenant must be active. Admins can invite only as `member`; only owners can assign `admin`. `owner` is never assigned by an invite. |
| `GET /tenants/{tenant_id}/invitations` | Owner/admin lists pending invitations, including expired-but-unrevoked rows with `expired: true`. |
| `DELETE /tenants/{tenant_id}/invitations/{invitation_id}` | Owner/admin revokes a pending invitation. |
| `POST /tenant-invitations/accept` | Authenticated invitee accepts with JSON `{ "token": "..." }`. |
| `POST /tenant-invitations/register-and-accept` | An invitee without an account registers and accepts in one transaction with `{ "token": "...", "user_name": "...", "password": "at-least-12-characters", "nick_name": "..." }`. The email is derived from the invitation; the request rejects `email`, `tenant_id`, and other extra fields. |

Create returns invitation metadata, the one-time `token`, and relative `invite_link` `/invite/accept?token=...` for the frontend to prefix with the site's origin. JSON IDs are decimal strings. Dates are RFC 3339 UTC. List items never include token material.

If `email` matches an existing active global account at creation, the invitation is pinned to that user's ID as well as their email. Otherwise it remains email-addressed. On the existing-account acceptance path, a user-ID invitation requires the exact account; an email invitation requires the authenticated account's current email to match case-insensitively. Existing accounts must use this path and authenticate normally.

Registration is accepted only for a live pending invitation with an email and no `target_user_id`, which is the invitation state for an email with no active account at creation. The endpoint creates a global `User` with `platform_role=user`, the specified email, a salted scrypt password hash, and active status. Password is explicitly supplied and must be at least 12 characters. A matching active account receives `409 INVITATION_REQUIRES_EXISTING_ACCOUNT`; a disabled or soft-deleted matching account receives `403 ACCOUNT_INACTIVE`. Username/email uniqueness races return `409 ACCOUNT_CONFLICT`. The success response is `201` with the same authentication token/user shape as login plus a `tenant` object containing the new membership; the token is also set in the existing HttpOnly `synapse_session` cookie. No password hash, invitation token hash, or token version is returned.

Both acceptance paths check pending token state, expiry, and active tenant status, then atomically claim the invitation in the database. Registration's account insert, claim, `TenantMember` insert, and atomic `membership_version` increment are committed or rolled back together. Thus concurrent use cannot leave a partial account or membership; a lost claim returns `409 INVITATION_NOT_PENDING`. Registration cannot claim user-ID invitations or email invitations already pinned to an account (`409 INVITATION_REQUIRES_EXISTING_ACCOUNT`). The authenticated path creates or reactivates only the corresponding `TenantMember`; registration creates only a new active TenantMember. Neither path creates a `WorkspaceMember`. Existing removed workspace grants remain removed and are not revived. An already-active tenant member cannot accept another invite (`409 ALREADY_TENANT_MEMBER`). Reuse/revocation returns `409 INVITATION_NOT_PENDING`; expired invitations return `410 INVITATION_EXPIRED`; target mismatch returns `403 INVITATION_TARGET_MISMATCH`; an inactive tenant returns `409 TENANT_INACTIVE`. Unknown token returns `404 INVITATION_NOT_FOUND`.

The `tenant_invitations` table is added by Alembic revision `0003_tenant_invitations`, following `0002_tenants`.
