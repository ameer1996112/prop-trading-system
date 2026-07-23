# ADR 0001: AWS managed secrets candidate

Status: `CANDIDATE_SELECTED / BLOCKED`

## Decision

The Phase 0 candidate is AWS Secrets Manager with customer-managed KMS keys, CloudTrail export,
cross-region replication, and IAM Roles Anywhere for short-lived workload identity from the VPS.
Future account credentials use one secret path/version and one least-privilege policy per account;
no shared all-account token or static deployment secret is acceptable.

Official documentation reviewed on 2026-07-22 describes secret versions/staging labels, rotation,
CloudTrail API-call records, regional replicas, and temporary profiles for workloads outside AWS:

- <https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html>
- <https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html>
- <https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html>
- <https://docs.aws.amazon.com/rolesanywhere/latest/userguide/getting-started.html>

## Blocking proof

No AWS resources, CA/trust anchor, role, KMS key, audit trail, replica, or secret was created in
this slice. Versioning, MetaApi-compatible rotation, scoped reads, revocation, audit export,
backup/recovery, and failure behavior require a credentialed integration spike and recovery drill.
Documentary support alone does not pass the gate; onboarding remains structurally absent.
