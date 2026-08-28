# Governed Msaidizi memory runtime

Terminal task reconciliation writes encrypted episodic, procedural, and
semantic records from server-owned structure only: terminal state, step-state
counts, governed capability identifiers, effect counts, and exact
principal/user/company/mandate/device scope. It never copies the task objective,
model output, step arguments, tool results, artifacts, page/email/clipboard
content, or credentials into a trusted memory.

The writer rejects the complete batch on any DLP finding, unknown host-device
scope, more than four device scopes, more than 32 capability identifiers, a
4 KiB per-record content limit, a 64 KiB per-task memory limit, or the task's
persisted `maxLocalBytes` ceiling. Encrypted content plus metadata/provenance is
charged once to `bytesWritten`; deterministic record IDs and a task-row CAS
prevent duplicate charges and writes after restarts.

Runtime memory retrieval requires a caller-owned, still-unused `PLANNING` task
snapshot and revalidates it before and after decryption. The source task,
principal, initiating user, company, mandate, and device scope must all match.
Device-neutral records come only from tasks with no host step; a device-bound
record is never exposed to another device. Human-created memory keeps its
existing caller/company API and remains `USER`/`UNTRUSTED`.

Ranking uses a local, deterministic hybrid: an explicit ERP/workstation concept
ontology provides synonym similarity, and lexical Jaccard resolves nearby
matches. This is real but deliberately bounded semantic retrieval; it is not a
general-language neural embedding and currently has an English finance and
operations vocabulary. A future embedding service must preserve the same
pre-decryption scope predicate, DLP boundary, hard candidate limits, and exact
runtime provenance checks.

Owners may inspect or delete their runtime-authored memories through the
existing human API, but may not edit a `TASK`-attributed trusted record in place.
They can create a replacement through the normal API, which is always stamped
`USER`/`UNTRUSTED`; this prevents a human edit from inheriting internal trust.
