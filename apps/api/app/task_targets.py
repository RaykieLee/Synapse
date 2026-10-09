"""Explicit scheduled-task target allowlist; handlers are added by F18b."""

SCHEDULED_TASK_TARGETS: dict[str, dict[str, str]] = {
    "tenant.expire_pending_invitations": {
        "name": "清理过期租户邀请",
        "description": "将已过期且仍待处理的租户邀请标记为过期。",
        "scope": "tenant",
    },
    "tenant.reconcile_attachment_metadata": {
        "name": "核对租户附件元数据",
        "description": "核对租户范围内附件元数据与本地存储对象关联。",
        "scope": "tenant",
    },
    "tenant.refresh_resource_summary": {
        "name": "刷新租户资源摘要",
        "description": "更新租户范围内的资源摘要数据。",
        "scope": "tenant",
    },
}
