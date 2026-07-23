# ADR 0002: Supabase Auth candidate

Status: `CANDIDATE_SELECTED / BLOCKED`

## Decision

The Phase 0 identity candidate remains the existing Supabase Auth account named by the plan.
Official documentation reviewed on 2026-07-22 exposes TOTP/phone MFA challenge and verify flows
and the `aal` JWT claim: <https://supabase.com/docs/guides/auth/auth-mfa>.

An AAL2 session is necessary but never sufficient for a sensitive command. The frozen local
protocol requires a specific challenge completed within 120 seconds, then a 256-bit opaque,
60-second, single-use grant stored only as SHA-256 and bound to actor/session/role/challenge,
action/account, resource version, safety epoch, and canonical request digest. Consumption and
command audit must be one Tier 0 transaction.

## Blocking proof

No tenant configuration, issuer/JWKS verification, roles, enrolled factor, challenge evidence,
revocation test, or action-grant implementation spike exists. The console therefore exposes no
operator controls. The candidate remains blocked until current official verification and a
credentialed integration test reproduce every requirement.
