# Active member access control

Firestore and Storage operations require an existing member record with `disabled != true`. A signed-in account may still read its own member record for onboarding and disabled-status detection.

New accounts register as ordinary members. Existing active managers may change roles and disable or restore accounts. Client deletion of member records is forbidden to prevent re-registration after disabling. The initial manager for a new environment must be provisioned through a trusted administrative channel.

Task and template creators are immutable. Normal creation uses the signed-in user's UID. Recurring tasks preserve the original creator only when Rules verify a completed predecessor, the caller's relationship to it, and matching recurrence identity and task fields.

Client team subscriptions wait for the member record and clear their data if the member becomes disabled. This prevents onboarding queries from failing before registration is complete.

Task deletion remains available to an active manager, creator, or assignee through the existing server function. Individual comment and attachment deletion remains author-only.

## Verification

- 58 access-control Rules tests, including disabled users, self-promotion, creator spoofing, and legitimate recurrence.
- 33 deletion Rules regression tests.
- 38 Angular tests, including template compilation.
- Production member compatibility checked read-only: 11 records passed.

These automated checks do not replace multi-user browser testing against deployed Rules.

## Attachment URL limitation

Previously issued Firebase download-token URLs remain usable independently of authenticated SDK Rules. Disabling a member does not revoke those URLs or remove already downloaded data. Revoking tokens and changing file retrieval to authenticated requests requires a separate agreed change.
