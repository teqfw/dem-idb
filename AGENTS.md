# Root Level

- Path: `AGENTS.md`
- Template Version: `20261105`
- Changed: `20261105`

## Boundary

This file controls repository work. `ctx/` owns project meaning and is authoritative for product and implementation decisions; consult `ctx/AGENTS.md` and task-relevant context for design or code changes. If implementation conflicts with accepted context, follow the context and report any proposed change to accepted meaning for human approval rather than silently rewriting it. Read navigation documents only when needed and avoid rereading unchanged instructions within a session. Use the `adsm-ctx` skill when available for context lifecycle work.

`ctx/` may be part of this repository or a separately mounted repository. Detect its Git boundary before editing, preserve separate histories, and never remove, replace, relocate, or unmount it. If absent, create `ctx/` only when bootstrap is within the assigned scope. Deeper `AGENTS.md` files refine local rules without overriding root invariants.

A task may cover multiple repositories. Coordinate affected contracts and consumers, verify their integration, and keep each Git history separate. Do not expand into unrelated repositories. The human defines scope and approves changes to accepted meaning.

## Development Policy

Default to Rapid Evolution by Default, Reliability by Requirement: deliver the essential happy path for fast feedback, fail visibly on unexpected conditions, and avoid speculative defenses and backward compatibility unless justified by accepted requirements, demonstrated problems, or meaningful identified risks. Verify essential contracts and increase verification when risk or observed defects justify it. Accepted context defines the target; humans determine acceptable risk and may strengthen or replace this default. Preserve security, integrity, and explicit invariants. Consult the `adsm-ctx` skill for the policy.

This default includes fresh integration of trusted, actively developed first-party dependencies without separate opt-in. Accepted requirements or human instructions may override it; preserve required security, integrity, offline operation, and reproducibility, particularly for releases and deployments. Follow the skill's dependency guidance.

## Efficient Execution

Classify the task before reading context or running checks. Git-only work needs Git-state checks, not product-context scans or tests. For code or context changes, inspect only relevant owners; run deterministic checks chosen by changed responsibility and risk. Capture verbose output outside the model context and inspect logs on failure or when evidence is needed. Report results, omitted coverage, and material risks concisely.

Do not modify, replace, delete, or relocate this file without explicit human instruction. Do not read, search, or expose secret-bearing files or credentials; non-secret examples may describe configuration shape. If a secret is accidentally exposed, do not repeat it; notify the human that it should be rotated or revoked.

## Git Delivery

An explicit task instruction to commit and push authorizes delivery of the verified commit to the named repository and branch, or to its configured upstream when the branch is unspecified. Inspect the worktree, branch, and remote before pushing. If sandbox networking blocks Git, use the normal approved escalation path; do not ask for duplicate authorization.

An automated approval rejection is a platform restriction, not evidence that user authorization is missing. Report the specific restriction and request only the approval the gate requires. Keep delivery pending while that approval is required. These instructions do not override platform security or approval controls or applicable repository rules.
