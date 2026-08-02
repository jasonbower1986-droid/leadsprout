# LeadSprout deployment contract

The production process is intentionally fail-closed. It validates deployment configuration,
the complete migration ledger and schema, the signed Evidence Integrity checkpoint, and every
referenced provenance record before opening its network listener.

## Build and start

```sh
cd frontend
npm ci
npm run build
cd ../backend
npm ci
npm run verify:deployment-config
npm start
```

Required runtime configuration:

- `NODE_ENV=production`
- `OPPORTUNITY_WORKSPACE_ENABLED=false`
- `BASE_URL` set to the public HTTPS origin
- `JWT_SECRET` set to a deployment secret of at least 32 characters
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- `EVIDENCE_INTEGRITY_AUTHORITY_STORE` set to an absolute mounted JSON file
- `EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256` set to the exact lowercase SHA-256 of that file
- `EVIDENCE_PROVENANCE_AUTHORITY_STORE` set to an absolute mounted JSON file
- `EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256` set to the exact lowercase SHA-256 of that file
- `LEADSPROUT_TEAM_DB_EXECUTABLE` set to the absolute production `team-db` executable
- `LEADSPROUT_TEAM_DB_EXECUTABLE_SHA256` set to the exact lowercase SHA-256 of that executable
- `PORT`, if the provider does not supply it

The application contains no private Evidence Integrity signing key. The authority store contains
trusted Ed25519 public keys and externally issued signed attestations. Its top-level shape is:

```json
{
  "profile": "LEADSPROUT_EVIDENCE_AUTHORITY_V1",
  "store_id": "EVIDENCE_IDENTITY",
  "public_keys": [{ "key_id": "...", "public_key_pem": "..." }],
  "attestations": [{ "checkpoint_id": "...", "sequence": 1 }]
}
```

The provenance authority store is an independently mounted canonical record set:

```json
{
  "profile": "LEADSPROUT_PROVENANCE_AUTHORITY_V1",
  "records": [{
    "provenance_record_id": "...",
    "subject_business_id": "...",
    "source_namespace": "...",
    "source_locator": "...",
    "observed_at": "...",
    "content_sha256": "...",
    "source_profile_version": "...",
    "derivation_profile_version": null
  }]
}
```

All signatures, checkpoint continuity, genesis authorization, freshness, manifest identity and
provenance equality are verified at startup. A malformed, stale, incomplete or substituted store
prevents the server from listening. Both mounted files must be absolute paths and are byte-for-byte
hash-pinned so a provider-side substitution or a change between configuration and startup
verification fails closed.

The ordinary application query path remains the provider `team-db` boundary. Production startup
requires an absolute executable path and byte-for-byte digest, and the adapter rechecks that identity
before each datastore operation. A missing, non-executable or substituted adapter prevents startup
or later datastore use.

## Controlled migration executor

Production migration writes do not use the general `team-db` SQL-argument path. They require:

- `LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR`: absolute executable path;
- `LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256`: SHA-256 of that exact executable.

The runner invokes the executable with:

```text
--protocol LEADSPROUT_ATOMIC_SQL_V1 --payload-sha256 <sha256>
```

The exact SQL payload is supplied on standard input. A successful executor must return exactly one
JSON receipt containing the protocol, `status: "COMMITTED"`, the matching payload digest,
`foreign_keys_restored: true`, and `connection_closed: true`. A missing executor, digest mismatch,
failed process or invalid receipt is a hard stop.

The provider implementation of this executable must use one server-side session, support trigger
DDL, roll back on every failure, restore foreign-key enforcement and close without an implicit
sync/push outside the approved transaction. It must pass either the disposable same-provider
qualification before the unmodified migrations are authorized against the protected datastore.

The included `backend/scripts/turso_atomic_migration_executor.mjs` implements that protocol directly
against the Turso serverless `Session` boundary. Its deployment also requires the following immutable
runtime bindings:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`;
- `LEADSPROUT_EXPECTED_DATABASE_URL_SHA256`;
- `LEADSPROUT_TURSO_SERVERLESS_MODULE` and its `..._SHA256`;
- `LEADSPROUT_TURSO_SERVERLESS_MANIFEST` and its `..._SHA256`;
- `LEADSPROUT_TURSO_SERVERLESS_VERSION=0.2.2`, matching the manifest exactly.

The executor rejects a substituted target, module entry point, package manifest or version. It uses
one session for foreign-key disablement, `BEGIN IMMEDIATE`, the exact migration body, commit and
foreign-key restoration. Because serverless 0.2.2 `Session.close()` suppresses close errors, the
executor sends and validates the exact baton-bound close pipeline response itself before issuing a
successful receipt. Failure before commit performs rollback and restoration on that same session.
No sync-engine pull, push, or local database path is used.

## Same-provider disposable qualification

`backend/scripts/qualify_turso_atomic_migration_executor.mjs` is the bounded remote qualification
harness. It refuses the protected V1 identity and host, refuses a non-empty application target,
constructs the exact controlled pre-007 fixture, proves a material 007 rollback and retry, applies
unmodified 007 then 008 through the production executor, and verifies the exact ledger, structural
schema, 17-trigger set, guard cleanup, foreign-key integrity and executor receipts. It never creates
or selects a provider resource; an authorised operator must supply one newly created disposable
database and delete it and its scoped credential after the terminal result.

The PASS receipt emits the exact provider class, canonical migration-manifest digest, executor and
serverless module/manifest digests, adapter/runtime identities, and the forced-rollback payload
SHA-256 needed by protected qualification evidence. After provider-confirmed token revocation and
database deletion, the operator must add those teardown facts and a maximum four-hour evidence
window. Qualification evidence is revision-bound: publishing a different repository revision
requires a fresh disposable run for that exact revision.

## Protected V1 repair

`backend/scripts/execute_protected_v1_repair.mjs` is the source-controlled protected migration
orchestrator. Before opening any protected database session it requires completed same-provider
disposable qualification through the exact hash-pinned executor and serverless runtime, verified
teardown of that disposable database and credential, a fresh database-scoped and time-bounded
migration credential distinct from the ordinary runtime credential, fresh evidence of a separately
restorable backup whose restoration was rehearsed, fresh evidence that customer writes are paused,
exact owner authorization and the protected target identity.

The orchestrator performs the exact protected read-only preflight, revalidates recovery, traffic and
migration-credential evidence immediately before calling the unchanged migration runner for 007 and
008, and then performs the full final structural, trigger, guard and foreign-key postflight. It does
not perform a deliberately failing mutation on the protected target as a substitute for disposable
qualification. There is no owner-risk-waiver path. Any missing, expired or mismatched evidence stops
before the next write.
