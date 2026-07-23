# ADR 0007: no-ticket waiver for Phase 0

Status: `USER-AUTHORIZED EXCEPTION`

The plan ordinarily requires a Jira ticket per slice. The user explicitly waived that requirement
for this implementation slice because the Atlassian site returned its unavailable page. No ticket
was fabricated and no external Atlassian mutation was attempted. The waiver is narrow and does
not carry into later implementation, provider provisioning, deployment, or promotion slices.
