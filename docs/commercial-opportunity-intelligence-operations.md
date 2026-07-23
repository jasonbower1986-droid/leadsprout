# Commercial Opportunity Intelligence operations

Authority: `ENG-IMP-AUTH-001 Revision 1.0`

## Feature control

`OPPORTUNITY_WORKSPACE_ENABLED` is the single production feature control. It defaults OFF; only the exact string `true` enables the authenticated API, frontend navigation, and protected frontend route. `/api/config/features` exposes the same server-side decision to the frontend. Do not activate it before Engineering Acceptance and operational progression.

Immediate application rollback sets `OPPORTUNITY_WORKSPACE_ENABLED=false` and restarts the application. This removes workspace routes and frontend entry while retaining all additive workspace records. Do not drop the workspace tables during operational rollback.

The I4 outreach-gate amendment uses the same control. Its additive review, acknowledgement, field-verification snapshot, immutable completion, progression and invalidation records are created only prospectively. Feature-off rollback disables every I4 route and UI entry but deliberately retains those records. There is no historical completion backfill and no destructive down-migration.

Before later Engineering acceptance, rehearse `backend/migrations/002_opportunity_workspace.sql` against a production-equivalent backup, run `test_opportunity_workspace_migration.js` twice to prove idempotency and row-count preservation, and run `test_opportunity_workspace_api.js` to prove RC-01–RC-07 gating, stale-version rejection, tenant isolation, replay protection, refresh invalidation, retained history and truthful non-communication progression semantics.

## Controlled migration sequence

Keep the feature OFF throughout this sequence.

1. Confirm the exact clean repository revision.
2. Capture current schema identity and row counts:
   `node backend/scripts/opportunity_workspace_preflight.js <protected-preflight.json>`
3. Create and verify the recoverable logical backup:
   `node backend/scripts/opportunity_workspace_backup.js <protected-backup.json>`
4. Store both evidence files in the approved protected operational evidence location; they contain schema and potentially protected data and must not be committed.
5. Apply the idempotent additive migration:
   `node backend/scripts/apply_opportunity_workspace_migration.js <protected-preflight.json> <protected-backup.json>`
6. Repeat the preflight capture to record the post-migration schema digest and row counts.
7. Confirm existing lead and Evidence Identity row counts are unchanged.

The migration creates only new tables and indexes. It does not rename, repurpose, delete, or backfill existing records. Existing leads become candidates only through a customer-owned draft workspace.

## Paying-customer and UAT separation

Paying-customer capability is confined to `backend/routes/opportunity-workspaces.js`, the production domain policy, production workspace tables, and the protected `/opportunities` journey.

The non-customer harness is confined to `uat/commercial-opportunity-intelligence/`. It has no server route, production navigation entry, subscription entitlement, or production-table dependency. It refuses production runtime and refuses participant activation unless `COI_UAT_RETENTION_DAYS` is supplied by the later Executive/UAT authority.

Participant identifiers are pseudonymous. Eligibility/consent records are outside fixture responses. The harness contains no customer names, emails, contact details, or real-customer evidence.

## Access and privacy controls

- Every workspace and mutation is authenticated.
- Object reads and mutations resolve `workspace_id` together with authenticated `user_id`.
- Capability profiles and customer adaptations are customer-authored records, never system evidence.
- Candidate snapshots retain evidence references and limitations; raw protected evidence is not written to operational telemetry.
- Telemetry contains stable IDs, event/failure category, correlation ID and duration only.
- UAT data is not stored in customer-product tables.
- UAT retention is configurable but organisational retention policy is not selected by Software Development.

## Rollback point

Code rollback point: `1d6e26c3e43379a33e349897a6207c2f4542dfaf`.

Application rollback remains compatible with the additive schema and all existing lead/evidence records. Newly written workspace data is retained. A destructive production down-migration is prohibited.
