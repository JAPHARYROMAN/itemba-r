# MSAIDIZI — INTEGRATION PLAN (2026-08-18)

**Date:** 2026-08-18 · **Baseline:** `ops/msaidizi-production-env` @ `129629a6` · **Status:** backend phases 0–4 live in production read-only; **zero frontend code exists** (`grep -rli msaidizi frontend/src` returns nothing). First light passed against production on 2026-08-18 (`backend/test/adversarial/first-light.mjs`). This plan takes Msaidizi from a bearer-token HTTP surface exercised by scripts to a chat application a manager uses every day — and to a working, proved, permission-gated **write** path.

**One-line essence:** *Msaidizi is a colleague with your own badge. So it gets a page like any colleague's conversation, it remembers what you talked about, it knows what a GRN is — and it does not get to change anything until a human has watched a change complete and found the row that proves it.*

> Successor to [MSAIDIZI_AI_PLAN_2026-08-16.md](MSAIDIZI_AI_PLAN_2026-08-16.md), which remains the spec of record for the backend. Nothing here changes the load-bearing architecture recorded there (§3, §4): every tool runs through an existing service under the caller's own `AuthUser` over HTTP, permission and write-mode ceilings are always intersected, an unpermitted capability is invisible rather than refused, red-tier confirmation suspends the run and resumes on a later request, and there is no automatic undo.

---

## Owner decisions, 2026-08-18 — binding

This plan was rewritten around four decisions. They are not amendments; the document is written from them.

| | Decision | What it displaces |
|---|---|---|
| **D1** | **A dedicated page, laid out like a chat app.** Not a docked panel. It *is* a chat: you type, it answers, and the steps it took appear inline in the conversation. | The panel-as-primary-surface, and the "work log, not a chat" framing. Both are gone. |
| **D2** | **Deeper knowledge of the app's inner workings.** It should understand the business — what a GRN is, how a POS sale becomes a sales order, which module owns which concept — not just endpoint names and Swagger schemas. | The assumption that machine-derived tool descriptions are enough. §4 is new. |
| **D3** | **It must be able to act.** *"It should be able to inject or make requests once I prompt it."* Writes are the point. | Writes as a distant maybe. The confirmation defect moves from a gate on the last phase to the first thing fixed. §9 is re-ordered around this. |
| **D4** | **Permission-gated, admin only by default.** Other roles are granted `msaidizi.use` deliberately, one at a time. | The current seed, which hands it to COMPANY_MANAGER and GROUP_DIRECTOR as well. §5 is new, and it narrows an existing live grant. |

**D1's consequence, which this plan must solve and does (§3):** a chat app implies conversation history you can return to. The prior plan decided nothing would be persisted, because `messages` carries fenced raw tool_result payloads — customer records, supplier balances, invoice lines — and `localStorage` would put those on a shared office machine's disk. **That reasoning still holds for `localStorage` and is wrong about the feature.** Persistence moves to the server, where it can be scoped, encrypted and expired. It is a required part of the first shipping version, not a deferral.

---

## 0. Where this starts, precisely

| | |
|---|---|
| Backend | `backend/src/modules/msaidizi/` — 8 source files, 5 spec files. Live. |
| Production config | `docker-compose.production.yml:158-175` — `MSAIDIZI_ENABLED=true`, `MSAIDIZI_WRITE_MODE=read-only`, `claude-opus-5` at `effort: medium`, 40 tool calls / 10 writes / 32,000 max tokens / 30 s invoke timeout per run. |
| Effective tier | `msaidizi.config.ts:16-20` — `read-only` ⇒ `allowedTiers = ['green']`. No amber or red tool has ever been built in production. |
| Manifest | 1,215 capabilities (556 green / 404 amber / 255 red), extracted from 1,219 route decorators across 199 controllers. The only `@AgentExcluded` routes in the whole system are Msaidizi's own nine (`msaidizi.controller.ts:87`, `procedures.controller.ts:49`). |
| Frontend | Nothing. The agent is reachable only by `POST /api/v1/msaidizi/ask` with a bearer token. |

**Two gaps, and they are different in kind.**

The first is that **nobody has ever *watched* a run.** Everything Msaidizi has done in production was observed through a script's stdout. The trust properties the backend earned in §9a of the prior plan — tier withholding, injection reporting, confirmation binding — are currently invisible to the person whose authority is being used.

The second is that **it cannot act, and the reason is a live defect, not just a policy.** Production is read-only by configuration, which is a choice. But even with the write mode turned up, the confirmation gate does not complete: a bare "yes" re-narrows the tool set and deletes the tool being confirmed (§6.1). Per `backend/test/adversarial/README.md`, no confirmed red action has ever executed in the history of the project. D3 makes that the first thing fixed rather than the last thing gated.

---

## 1. Where the assistant lives

**Decision (D1): a dedicated page at `/msaidizi`, laid out like a chat application — conversation list, thread, composer. A global launcher survives as a *launcher*: it opens the page with your question already running. No docked panel.**

### 1.1 Why a page, and why the panel is gone

The prior plan chose a fixed right-hand overlay so a manager could keep looking at the screen the answer was about. That is a real advantage and it is outweighed by three things.

**A chat is a place you return to.** The panel framing produced a surface with no history, no way back to yesterday's question, and no address to send someone. D1 says this is a chat, and every chat application anyone has used has a conversation list down the left. Building that as an overlay means either a very cramped rail or a second navigation model inside a 420px column.

**Runs are long and the thread is the artefact.** There is no ceiling on total run duration: 40 tool calls at a 30 s invoke timeout each (`msaidizi.config.ts:112-114`) can occupy a connection for minutes. A long-running thing you come back to wants a URL, not a floating layer that closes when you navigate.

**One renderer, not two.** The thread — messages, inline step rows, the confirmation checklist, the security-finding block — is the bulk of the frontend work (§12, item 11). A panel plus a page means building it once and hosting it twice, with two scroll models and two persistence paths.

**What is lost, honestly:** you can no longer read the answer beside the invoice it is about. §1.4's page-context chip recovers part of it — the question carries where you were. **What would change my mind:** if managers consistently report they want the answer next to the record, a compact thread in a fixed overlay becomes cheap *later*, and it is cheap specifically because §3 puts conversations on the server — a thread started in an overlay is the same conversation, at the same URL, on the page. That ordering is deliberate: the panel is additive after persistence and was subtractive before it.

### 1.2 What the launcher is now

**Decision: the launcher survives and is only a launcher.** Topbar button, `Ctrl/⌘+J`, and a nav leaf. It opens a small composer — one input, "Ask Msaidizi…" — and on submit it **creates the conversation, navigates to `/msaidizi/{conversationId}`, and the run streams there.** It renders no steps, no answer, and no thread of its own.

The precedent is exact and it is the right one. `CommandPaletteProvider` (`frontend/src/components/aurora/command/CommandPaletteProvider.tsx`) mounts `<CommandPalette/>` as a sibling of `{children}` in the dashboard layout, owns a `document.keydown` listener, exposes `open/close/toggle` through context — and **navigates**. It does not try to be the destination. `MsaidiziLauncher` is the same shape, nested inside it.

Rejected: a compact thread in the launcher that "continues on the page". It is the panel again under a different name — two renderers, two scroll states, and a handover mid-stream where the SSE reader has to survive a route change. Not worth it to save one navigation.

### 1.3 The nav leaf, and the POS exclusion that comes free

`NAV` in `frontend/src/components/layout/sidebar.tsx:138` is the single source of truth for the sidebar, the command palette (`flattenNavigationCommands(NAV)`), the tab title, and the recents store. One leaf —

```ts
{ href: '/msaidizi', label: 'Msaidizi', iconKey: 'automation', permission: 'msaidizi.use' }
```

— makes the assistant appear in all four surfaces at once and **correctly invisible to anyone without `msaidizi.use`**, which is the UI expression of "an unpermitted capability is invisible, not refused." Under D4 (§5) that is one role to begin with, by design.

Mount the launcher **inside the non-POS branch only.** `mobilePosStandalone` (`frontend/src/app/(dashboard)/layout.tsx:124-126`) strips the entire ERP shell for `/mobile-pos` and `/westsides/mobile-pos`; `isPosOnlyUser()` hard-redirects POS-only users out of the shell. A launcher mounted in the ERP branch is therefore structurally absent from Kaunta — the POS boundary (§10.6) is enforced by where the component hangs, not by a runtime check anyone can forget. Verified against the live layout: the branch is at `layout.tsx:145`, and `CommandPaletteProvider` wraps both arms, so the Msaidizi provider nests inside it and the launcher renders only in the ERP arm.

### 1.4 Should the assistant know what screen you are on?

**Decision: yes, but only as a visible, user-attached, user-removable line — never as silent context injection. It ships after the page, not with it.**

This looks like a free win and is not, for a specific mechanical reason: **page context is a retrieval input, not metadata.** `registryFor` (`msaidizi.service.ts:271-297`) narrows the tool set by the text of the newest user string message. If the UI silently prepends `On screen: /invoices/41`, it has changed which tools the model receives. A silent, invisible string that changes both the tool set and the answer makes bad runs unreproducible — and reproducibility is why the domain filter is deterministic in the first place (`domain-filter.ts:9-11`).

So:

- **The first version sends nothing automatically.**
- **Then a chip** in the launcher — *"About this page: Invoice INV-2026-0041"* — that the user clicks to attach. When attached, the text it appends is shown in the composer where the user can see and edit it. It reads as a human sentence (`I am looking at invoice INV-2026-0041.`), never a raw pathname or UUID: a lexical filter scores vocabulary, and `/invoices/41` contributes one usable token where "invoice" contributes the one that matters.
- **Never send route params blind.** They end up in `messages`, which is echoed verbatim and — now — persisted (§3).

### 1.5 The transport, which needs no new plumbing

`frontend/src/app/api/backend/[...path]/route.ts` already does exactly what is needed. The browser never holds a bearer token — `itemba_access` is httpOnly — and the proxy reads it server-side and sets `Authorization: Bearer …` upstream. A browser `POST /api/backend/msaidizi/ask/stream` arrives at the controller with a real token, and the agent replays the caller's own credential against the caller's own services.

Three mechanics the streaming client depends on, all verified by reading:

- **The proxy passes SSE through unbuffered.** `route.ts:176-182` branches on content-type: JSON is buffered through `NextResponse.json`, **everything else is `new NextResponse(backendRes.body, …)`** — a genuine `ReadableStream` pass-through. `passthroughHeaders` (`:196-199`) forwards `cache-control`, so the backend's `no-cache, no-transform` survives, which is what stops Caddy's `encode zstd gzip` (`deploy/caddy/Caddyfile`) buffering the stream into a compressor. It does **not** forward `x-accel-buffering`.
- **CSRF comes free.** `components/security/CsrfFetchProvider.tsx:32,59` monkey-patches `window.fetch` and attaches `x-csrf-token` to any POST under `/api/backend/`. Its `withEmptyBodySafeJson` wrapper (`:35,78`) only lazily redefines `.json` via `response.clone().text()`; it never consumes `response.body`, so `getReader()` remains available.
- **`EventSource` is unusable** — the endpoint is POST and needs an `Authorization` header. It must be `fetch` + `response.body.getReader()` + a hand-rolled SSE frame parser. **This is the first streaming consumer in the codebase**: `EventSource`, `text/event-stream`, `getReader`, `ReadableStream`, `TextDecoderStream` all return zero hits across `frontend/src`.

**One trap, stated so nobody walks into it.** `frontend/src/lib/api-client.ts:1-2` — `const API_URL = process.env.NEXT_PUBLIC_API_URL ?? BACKEND_PROXY_URL`. In production `NEXT_PUBLIC_API_URL` is the public API origin, so the bare `apiFetch()` bypasses the proxy and carries **no credential**. It is used by zero files today and must stay that way. Msaidizi uses `backendPost`/`backendGet` or a raw `fetch('/api/backend/...')`.

---

## 2. The conversation surface

The agent acts *as the user*, with the user's badge, and the audit trail will say the user did it. So the product is not the answer alone. **The product is the answer with the record of what was touched to produce it, in the same thread, where you cannot miss it.**

### 2.1 It is a chat, and the steps are inline

```
┌─ Msaidizi ──────────────────────────────────────────────────────────┐
│  Conversations       │  Supplier balances                           │
│  ──────────────────  │  ──────────────────────────────────────────  │
│ ▸ Supplier balances  │   You                                        │
│   today · 2 steps    │     How much do we owe suppliers right now?  │
│                      │                                              │
│   Stock at Kariakoo  │   ·  Looking at supplier invoices    ✓ 0.9s  │
│   yesterday          │   ·  Looking at suppliers            ✓ 0.4s  │
│                      │                                              │
│   Cash position      │   Msaidizi                                   │
│   3 days ago         │     Three suppliers have unpaid invoices     │
│                      │     totalling TZS 4,180,000 …                │
│  ──────────────────  │                                              │
│  + New conversation  │   ┌────────────────────────────────────────┐ │
│                      │   │ Ask Msaidizi…                          │ │
│                      │   └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

The step rows are **not** behind a chevron and **not** in a sidebar. They sit in the thread, between the question and the answer, in the order they happened. That placement is the whole trust argument: an assistant whose working is hidden behind a disclosure is a black box with a receipt attached, and nobody opens the receipt. An assistant that shows you it looked at supplier invoices and then supplier records, and *then* gives you a number, is legible without any effort from the reader.

Completed runs keep their steps inline, collapsing to a single summary line only past ~8 steps — and the summary says how many, so the collapse is visible rather than silent.

### 2.2 No typewriter — a rendering decision, not a philosophy

Events are emitted **per model turn, not per token.** `AnthropicModelClient.createMessage` opens a stream but awaits `stream.finalMessage()` (`model-client.ts:87`), so a whole assistant turn lands at once. First light observed 6 frames with a multi-second spread.

So a turn appears complete when it appears. **No typewriter, no fake token cadence, no shimmering placeholder text** — not because a chat should feel like a log, but because faking a cadence the transport does not have misrepresents what is happening, and makes a genuinely slow run look like a fast one that stalled. While running, the last row carries a live indicator and elapsed time. That is honest and it is enough.

If a per-token delta channel is ever added to `ModelClient`, the renderer can grow one; it is a separable backend change and nothing here forecloses it.

### 2.3 Making a tool call legible to a manager

A step row must not say `SupplierInvoices_findAll`. A manager does not know what an endpoint is and should not have to.

The label comes from the capability's own description — `describeAction(capability)` (`tool-registry.ts:66-75`) is already what goes into the tool description and what `describeForConfirmation` interpolates. The frontend has no access to it. **This is the main reason `GET /msaidizi/capabilities` is a prerequisite rather than a nice-to-have** (§8.2): it hands the UI a lookup table from tool name to `{description, tier, path}` so a step can read *"Looking at supplier invoices"* instead of an identifier.

Until that endpoint exists the UI must fall back to splitting the tool name (`SupplierInvoices_findAll` → "Supplier invoices · find all"), which is honest and ugly. Ship the endpoint.

Three rules for the row:

- **Verb by tier.** Green reads say *"Looking at …"*. Amber says *"Changing …"* with an amber dot. Red says *"About to …"* and never appears without having passed the gate. Tier is on every `tool_call` event, so this costs nothing.
- **Failure is loud.** `tool_result{ok:false}` renders the sanitised `error` string from `describeFailure` (`capability-invoker.ts:167-190`) inline on the row, not in a toast that scrolls away. The features/UI review found swallowed errors to be the top defect class in this codebase; an agent that silently no-ops reads as success, and this is where that happens.
- **`status: 0` is not an HTTP status.** It means transport failure, timeout, or a missing path parameter (`capability-invoker.ts:85,138`). Never render "0" to a user.

### 2.4 The constraint that shapes everything: no result bodies in the trace

`msaidizi.service.ts:243-249` records only `{tool, ok, status, error}`. **The actual response payload goes to the model and is discarded from the trace.** The UI can say *"Looked at customers → 200 OK"* and cannot show the rows.

This is deliberate — the trace itself cannot leak a payload — and §3 is built on it: the array a chat renders is exactly the array with no business records in it. Do not fight it by adding a "view results" affordance; there is nothing to view. State the division of labour in the UI copy instead:

> **The steps say what Msaidizi touched. The answer says what it found.**

Anything a user wants to verify, they open the real page for. That is a feature: it sends people back to the system of record rather than treating the chat as one.

### 2.5 Rendering safety — non-negotiable

Tool results are attacker-influenceable: supplier names, customer notes, product descriptions, uploaded document text (`prompts.ts:1-11`). And the prompt **instructs the model to quote hostile content back when it finds it** (`prompts.ts:37`). That is correct behaviour, and it guarantees adversary-authored strings will legitimately appear inside `text`.

1. **Never render `text` as HTML, or as Markdown with raw HTML enabled.** Escape everything. If Markdown is rendered at all, raw HTML is off and the output is sanitised.
2. **Same for `confirmation_required.description` and `tool_call.args`** — `description` interpolates argument values through `JSON.stringify` (`msaidizi.service.ts:350-355`). Text, never markup.
3. **Never render `messages`.** It is transport state containing fenced raw tool_result payloads — the business data §2.4 deliberately kept out of the trace — plus provider internals. It exists to be echoed back, and now to be stored encrypted (§3).
4. **Give a security finding its own treatment.** When the model reports injected content, that is a finding, not prose. Render it in a bordered block headed *"Msaidizi flagged something in this data"* so the signal survives. A UI that renders it identically to a sentence about invoice totals throws away the property the adversarial suite spent ten shapes proving.

### 2.6 The six terminal states

`done` is emitted exactly once per run (`msaidizi.service.ts:58-64`). Each gets its own treatment; none may be silent.

| `reason` | Treatment |
|---|---|
| `end_turn` | Normal. Render the answer. |
| `awaiting_confirmation` | §6. Render the gate inline in the thread. |
| `tool_budget_exhausted` | *"Stopped after 40 steps. This answer may be incomplete."* — see the warning below. |
| `write_budget_exhausted` | *"Stopped after 10 changes."* Same warning. |
| `refused` | **Arrives inside a `success: true` 201.** A client branching only on HTTP status renders a refusal as a blank successful answer. Show whatever `text` exists — which may be none — and say the request was declined. **Never auto-retry.** |
| `failed` | Preceded by an `error` event. *"Msaidizi could not complete this."* Retry is reasonable. Note this is also what an unset `ANTHROPIC_API_KEY` looks like (`model-client.ts:66-69`) — config errors and model outages are indistinguishable at the client. |

**The "continue" button is a trap.** Both budget counters are local variables initialised per `run()` call (`msaidizi.service.ts:125-126`) — **per HTTP request, not per conversation**, despite `maxWritesPerSession` being named as it is. A naive "continue" resets them to 0/0 and hands the user an unbounded loop one turn at a time. Persistence makes this more tempting *and* more dangerous, because the UI now has a conversation object to hang a counter on. If continuation is offered at all it must cap against `MsaidiziConversation.toolCallCount` / `writeCallCount` (§3.2) and say so. The first version does not offer one: it says the run stopped and lets the user ask again, deliberately.

### 2.7 Stop, which cannot stop

`run()` takes no `AbortSignal`. Closing the stream only makes `send()` a no-op. **Aborting the HTTP request does not cancel the run** — remaining model turns and tool calls execute to completion and their audit rows land.

**Decision: no Stop button in the first version.** On a page rather than a panel there is nothing to "hide", so the control is simply absent and the thread says the run will finish on its own. A button labelled Stop that does not stop is worse than no button, and under amber it would be a lie about whether a write happened.

**But D3 changes the priority.** Under read-only an uncancellable run wastes tokens; under amber it keeps writing after the user has decided they were wrong. Threading an `AbortController` through `run()` and checking it between loop iterations is a small, well-bounded backend change, and it moves onto the amber gate list (§9.4) rather than staying an open "revisit". A Stop that lands between tool calls is honest — it cannot recall an in-flight write, and the UI must say exactly that: *"Stopped. Anything already changed stays changed."*

### 2.8 Stream mechanics the client must get right

- **`result.events` contains every event already streamed, `done` included.** Render the individual frames for liveness and use `result` **only** for `sessionId` / `conversationId` / `messages` / `reason`. A client that renders both double-renders the entire run.
- **`ask` is enveloped, `ask/stream` is not.** `POST /ask` goes through `TransformInterceptor` → `{success, data, timestamp}`; the `@Res()`-decorated stream handler bypasses it. `unwrapApiPayload` in `api-client.ts` handles the first correctly. Do not assume one envelope for both.
- **Three frames break the `data.type` pattern**: the controller's catch-all `error`, `result`, and the new `session` frame (§8.3). Parse on the SSE `event:` name, not on `data.type`.
- **Pre-stream failures arrive as ordinary JSON**, because the enabled/authorization guards throw before `flushHeaders()`. A 503 or 403 is an `HttpExceptionFilter` body, not an SSE frame. The reader must check `content-type` before assuming it has a stream.
- **No heartbeat, no `retry:`, no event ids.** A run whose first model turn takes 60 s emits *nothing at all*. Intermediaries may reap the idle connection. This is materially less bad than it was: with §3 the conversation row and its `agentSessionId` exist before the loop starts, so a dropped stream loses the live view but not the run's identity. Still measure it (§9.2); if it bites, a comment-frame heartbeat is a small backend change.
- **Set generous client timeouts.** Prefer `/ask/stream` precisely because a silent `/ask` is indistinguishable from a hang.

### 2.9 What the page must say about itself

Two standing lines, both currently true and both of which must change when the facts do:

> **Msaidizi can read what you can read. It cannot change anything.**
> *(read-only mode — from `GET /msaidizi/capabilities`, never hardcoded)*

> **What Msaidizi read is not recorded in the audit log.** Changes are; reads are not, yet.

That second line is uncomfortable and it is the truth (§10.5). A COMPANY_MANAGER's agent run today leaves **zero** audit rows for what it read, by construction. Until `api_request_logs` is populated, a UI that implies otherwise is lying about the one property the whole design was built to have.

The mode line is driven by `writeMode` from the capabilities endpoint, so the day the deployment moves to amber the sentence changes itself. Hardcoding it is the single easiest way to ship a lie later.

---

## 3. Conversation persistence — server-side

**Decision (D1): conversations are stored on the server, encrypted at rest, readable only by their author, with two retention clocks. `localStorage` remains forbidden.**

The prior plan's "nothing is persisted" was right about `localStorage` and wrong about the feature. The payload objection stands — `messages` carries fenced raw tool_result payloads, and writing those to a shared office machine's disk under a key any script on the origin can read is not acceptable. So the store moves to the server, where it can be scoped, encrypted and expired.

### 3.0 The split the existing types already hand you

The whole design rests on one observation about `RunResult` (`msaidizi.service.ts:87-93`). It returns **two** arrays, and they are not two views of the same thing:

| | `events: MsaidiziEvent[]` | `messages: ModelMessage[]` |
|---|---|---|
| Built for | the human | the API |
| Tool results carry | `{ tool, ok, status, error }` — **no body** (`:243-249`) | the fenced body verbatim (`:251-256`) |
| Size | kilobytes | up to megabytes |
| Needed to **display** a past conversation | yes | no |
| Needed to **resume** one | no | yes |

`MsaidiziEvent`'s `tool_result` variant (`msaidizi.service.ts:46`) is `{ type, tool, ok, status, error }` — verified; the retrieved records never enter it. They enter `messages` only, through `fenceToolResult` (`prompts.ts:121-129`), which `JSON.stringify(payload, null, 1)`s the whole HTTP body from `CapabilityInvoker` (`capability-invoker.ts:117-129`).

So the sensitive bulk is confined to one array, which is exactly the array display does not need. **Persist both, at different fidelities, on different clocks.**

### 3.1 What is stored

**Three things, three lifetimes.**

**(a) The transcript — `MsaidiziEvent[]` per turn, plus the user's prompt.** This is the conversation history. It carries the user's words, the model's prose, and the *fact* of every tool call: name, capability id, tier, arguments, ok/status/error, every `confirmation_required` with its id and description. It is what a chat app renders and what a human re-reads a week later.

Be precise about what it is not: it is **minimal, not sanitised**. Two places business data still enters, both small and both wanted:

- `tool_call.args` and `confirmation_required.args` — model-authored inputs. A search term is a customer name; a red-tier write body is the change itself. Keep them; they are the reviewable substance. **Run them through `redactSensitiveFields` (`audit-logs.service.ts:176`) before storing** — a `POST /users` capability at red tier would otherwise put a plaintext password in the transcript, which is precisely the case that function already exists to catch on the audit path.
- `tool_result.error` — `describeFailure` interpolates `body.message` on 400/403/409 (`capability-invoker.ts:167-190`), so a validation message can carry a record detail. Small, and it is what a human debugging the run needs.

**(b) The resume state — `messages`, verbatim, or nothing.** Three reductions are conceivable and all three fail:

1. *Reconstruct `messages` from `events` on resume.* Impossible. `events` carries no `tool_use` block ids and no result bodies. You could synthesise a structurally valid array with invented ids and placeholder bodies — and that is the failure to refuse, because the model would then answer follow-ups from placeholders while sounding exactly as confident as before. That is §11.1's "confidently incomplete", manufactured deliberately.
2. *Store `messages` with tool-result content replaced by a pointer or hash.* Structurally valid; semantically poisoned. The system prompt says *"Every figure you state must come from a tool result in this conversation"* (`prompts.ts`, the Accuracy block). Elide the bodies and the model's own earlier sentences become unsupported by anything it can see. It will either re-call the tools — cost, and under amber a needless re-read of a moving target — or hedge about numbers it already stated.
3. *Store only the last N turn-pairs.* The only lossy option that stays both structurally valid and truthful, because it drops whole `tool_use`/`tool_result` pairs rather than gutting them. It is real compaction and it is a later version, not this one.

**So: for resume, verbatim or nothing.** There is no middle.

**A correction to the "byte-for-byte" framing, because it is load-bearing.** What the API enforces is *structural*: role alternation, and every `tool_use` block paired with a `tool_result` of the same `tool_use_id` in the following user turn. It does not remember what you sent last time and cannot check that a tool result is the same tool result. The only content *cryptographically* bound is a thinking block's `signature` — and today `AnthropicModelClient` filters those out (`model-client.ts:94-96`, the latent bug in §11.6), so nothing currently in `messages` is signed.

Two consequences:

- Storing `messages` as JSON is safe. The bulky part is already a **string** inside the block, because `fenceToolResult` stringifies before it goes in — so no numeric or key-order normalisation can touch a customer balance.
- **When §11.6 is fixed, redaction of assistant turns becomes permanently impossible**, because the signature covers content you would be altering. Fixing §11.6 and "store less" are mutually exclusive. Decide §11.6 first; it constrains this.

**(c) The correlation key.** `agentSessionId` — the same `ms_…` value minted at `msaidizi.service.ts:107`, written onto every audit row the run produces (`schema.prisma:1870`, indexed at `:1885`). The conversation row becomes the durable index into the audit trail that the prior plan was approximating with a copy-to-clipboard button.

**Encryption at rest.** `resumeState` and the per-turn `events` are stored as AES-256-GCM ciphertext via the existing `EncryptionService` (`common/services/encryption.service.ts`), following the `integration-connections` precedent (`integration-connections.service.ts:48,560`; module wiring at `integration-connections.module.ts:11`). `APP_ENCRYPTION_KEY` is already required in production and staging (`config/env.validation.ts:162`), so this adds no ops requirement. Four properties come free:

- A DBA browsing `msaidizi_conversations` sees ciphertext, not supplier balances.
- No one can accidentally write a `jsonb` path query into customers' records.
- "Byte-for-byte" becomes literally true — GCM round-trips the exact string.
- The auth tag means a **tampered transcript fails closed**. Someone editing a stored conversation to inject an instruction gets a decryption error, not a poisoned resume.

**The line: what the user typed is plaintext; what the system retrieved, or what the model said about it, is ciphertext.** `prompt` stays plaintext so history is searchable and the title is derivable — and it contains only the user's own words, no retrieved records. That posture matches the rest of the codebase, which stores entity ids and search-shaped data in the clear.

### 3.2 The schema

Two new tables, no new enum, `String` for `reason`/`highestTier` following `MsaidiziProcedure.highestTier` (`schema.prisma:300` — verified `String @default("green")`) rather than enums that would need a migration every time `DoneReason` grows.

```prisma
/// One chat with Msaidizi: the header, the counters, and the short-lived state
/// that makes "continue this conversation" possible.
///
/// Two payloads with two lifetimes live here. `turns` is the conversation a human
/// re-reads and is kept for the retention window. `resumeState` is the model's
/// own message array — the only place retrieved business records are stored — and
/// is destroyed within a day. A conversation past that window is readable and not
/// continuable, which is what a chat app does when a session ages out.
model MsaidiziConversation {
  id              String    @id @default(uuid())
  /// Mirrors audit_logs.agentSessionId. Server-owned: never taken from the client,
  /// because confirmationIdFor() derives red-tier approval ids from it
  /// (msaidizi.service.ts:333-347) and a client that forgets to echo it produces
  /// an infinite approval loop that looks exactly like the server ignoring the user.
  agentSessionId  String    @unique
  userId          String
  companyId       String?
  /// Derived from the first prompt, truncated. The one plaintext field that can
  /// name a customer — which is why the oversight projection (§3.3) excludes it.
  title           String?

  turnCount       Int       @default(0)
  toolCallCount   Int       @default(0)
  writeCallCount  Int       @default(0)
  /// Highest reversibility tier this conversation has touched. Denormalised so
  /// oversight can rank conversations without decrypting anything.
  highestTier     String    @default("green")

  /// AES-256-GCM ciphertext of JSON.stringify(messages). NOT jsonb: opaque by
  /// intent, and the only column in this schema holding retrieved records.
  resumeState     String?
  resumeBytes     Int       @default(0)
  resumeExpiresAt DateTime?
  /// False when the run's messages exceeded MSAIDIZI_RESUME_MAX_BYTES. A truncated
  /// array would break tool_use/tool_result pairing, so we store nothing and say so.
  resumable       Boolean   @default(true)

  lastTurnAt      DateTime?
  /// Sliding: recomputed as lastTurnAt + retention window on every turn.
  expiresAt       DateTime
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?

  /// Cascade, deliberately unlike audit_logs' SetNull (schema.prisma:1873). A
  /// conversation is private to its author; when the author is gone nobody may
  /// read it, and what it *did* survives independently in the audit trail.
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company? @relation(fields: [companyId], references: [id], onDelete: SetNull)
  turns   MsaidiziConversationTurn[]

  @@index([userId, deletedAt, lastTurnAt])
  @@index([companyId, createdAt])
  @@index([expiresAt])
  @@index([resumeExpiresAt])
  @@map("msaidizi_conversations")
}

/// One user question and the run it produced. Append-only within a conversation.
model MsaidiziConversationTurn {
  id             String    @id @default(uuid())
  conversationId String
  sequence       Int
  /// The user's own words, plaintext — searchable, and free of retrieved data.
  prompt         String
  /// AES-256-GCM ciphertext of the MsaidiziEvent[] as returned to the client.
  /// Carries no tool-result bodies by construction (msaidizi.service.ts:37-56).
  events         String
  reason         String
  toolCallCount  Int       @default(0)
  writeCallCount Int       @default(0)
  procedureId    String?
  startedAt      DateTime  @default(now())
  endedAt        DateTime?

  conversation MsaidiziConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([conversationId, sequence])
  @@index([conversationId, sequence])
  @@map("msaidizi_conversation_turns")
}
```

Back-relations added to `User` and `Company`, as `MsaidiziProcedure` already does (`schema.prisma:310-312`).

**Migration discipline.** Additive, exactly as `20260816180000_msaidizi_procedures/migration.sql`: two `CREATE TABLE`s, their indexes, and FK constraints. **No existing table is altered** — the only DDL touching `users` and `companies` is `ADD CONSTRAINT … FOREIGN KEY`, which is what that migration already did (*"Additive only: one enum, one new table, no changes to existing tables."*). No backfill, no column drop, no type change. The migration file carries a prose header explaining the two-lifetime split and why `resumeState` is TEXT ciphertext rather than JSONB, following that file's commenting convention.

### 3.3 Access control

**The problem, stated plainly.** The agent runs under the caller's own permissions and their own bearer token, so a conversation contains exactly what *that user* was entitled to see. A COMPANY_MANAGER's conversation may hold payroll rows. A second COMPANY_MANAGER in the same company, without `payroll.view`, reading that transcript sees data their own permissions deny. **The transcript is a permission-bypass channel unless the read gate is tighter than the app's normal one.**

**Rule 1 — read is author-only.** The read filter is `userId = requester.id`, **not** `companyWhereForUser` (`common/services/company-scope.service.ts:76-104`). Reaching for the house scoping helper is the obvious move and it is wrong here: it would let any peer in the same company read the transcript. Company scope is applied *in addition* — a conversation under a company the user has since lost access to disappears — never *instead*.

**Rule 2 — no admin read of another user's transcript. This is not a deferral; it is not expressible.** To decide whether reader R may see conversation C, you would have to re-evaluate every record inside C against R's permissions. But the transcript stores prose and fenced payloads, not record identities — there is nothing to re-check. Any "admins can review conversations" feature is a permission bypass wearing an oversight costume, and the fact that it can never be made correct is the reason to refuse it rather than schedule it.

**Rule 3 — what oversight gets instead.** Two things, both already correct:

- *"What did the agent do?"* already exists and is already properly scoped: `GET /audit-logs?channel=AGENT&agentSessionId=…`, gated on `audit-logs.read` (`audit-logs.controller.ts:12`) and filtered through `companyWhereForUser` (`audit-logs.service.ts:263`, with the `agentSessionId` filter at `:268`). Nothing new needed. Note honestly that under `read-only` this returns zero rows, because reads are not audited (§10.5) — that gap is unchanged by this feature.
- *"Who is using the agent, and how much?"* — a new **metadata-only** projection: conversation id, session id, author, company, `turnCount`, `toolCallCount`, `writeCallCount`, `highestTier`, timestamps. **No `title`, no `prompt`, no `events`, no args.** Title is excluded specifically because it is derived from the first prompt and will name a customer; it is the one field an implementer would naturally include and the one that leaks. Permission `msaidizi.oversight`, seeded to no role — a deliberate grant, consistent with D4's posture in §5.

**Rule 4 — if the owner overrules and wants break-glass.** Then it must be loud, not silent: a distinct `MSAIDIZI_CONVERSATION_DISCLOSE` action requiring a permission no role holds by default, which writes a `CRITICAL` audit row naming reader, author and conversation **before** returning content, and surfaces "this conversation was reviewed by X on Y" to the author in the UI. A visible bypass is defensible; an invisible one is the failure this system was built against.

**Two properties persistence does not weaken, worth recording:**

- **Resume cannot outrun current permissions.** `registryFor` rebuilds the tool set from `request.user.permissions` on every turn (`msaidizi.service.ts:271-297`). A conversation resumed after the user loses `payroll.view` cannot call payroll tools. Stored state is history, never a grant — the same principle as `ProceduresService`' invoker-permissions rule. This matters more under D4: when `msaidizi.use` is revoked from a role (§5), the whole surface disappears for its holders and their stored conversations become unreachable by them, not a residual capability.
- **A leaked resume state cannot act.** Every tool call carries the requester's own `Authorization` header (`capability-invoker.ts:110`). Stored `messages` contain no credential. The exposure is read, not act — which is why Rule 1 is the whole of the control.

**Non-goal, stated so nobody adds it:** `confirmed[]` is **never persisted.** It is derived per request and checked as a plain set for the run (`msaidizi.service.ts:116, 203-222`). Storing it would convert a one-shot approval into a standing grant — the exact hazard §6.5 warns clients about, promoted to the database.

### 3.4 Retention

**Two clocks, because there are two payloads.**

| | Window | Default | Config |
|---|---|---|---|
| `resumeState` | hours | 24h | `MSAIDIZI_RESUME_TTL_HOURS` |
| conversation + turns | days | 90d, sliding on `lastTurnAt` | `MSAIDIZI_CONVERSATION_RETENTION_DAYS` |

24h for resume is the humane floor: a manager asks at 5pm and comes back at 9am. It is also why the short window is *right* rather than merely cautious — an `APP_ENCRYPTION_KEY` rotation orphans ciphertext, and at 24h that costs at most one day of resumability instead of a re-encryption project.

**Who decides.** The deployment, via config, following `MsaidiziConfig`'s existing posture (`msaidizi.config.ts`) — every knob an env var, safe defaults. Not per-user, not per-company: a per-user retention setting is a way to talk someone into keeping records forever.

**What deletes it — and the honest part.** There is **no scheduler in this codebase.** `@nestjs/schedule` is not a dependency and `@Cron` appears nowhere — verified. `CacheEntry` has an `expiresAt` that nothing sweeps; `getStats()` merely *counts* the expired rows (`cache-management.service.ts:98-110`). Do not repeat that: an "expired" row still holding customer records is a deletion that did not delete.

The house precedent that actually works is `auth.service.ts:816-823` — expired refresh tokens are `deleteMany`'d **inline, opportunistically, on the traffic the feature itself generates**. Do the same: at the top of every `POST /msaidizi/ask`, before the run, in a bounded and swallowed call:

1. `UPDATE msaidizi_conversations SET "resumeState" = NULL, "resumeBytes" = 0, "resumable" = false WHERE "resumeExpiresAt" < now()` — bounded batch.
2. `DELETE FROM msaidizi_conversations WHERE "expiresAt" < now() OR ("deletedAt" IS NOT NULL AND "deletedAt" < now() - grace)` — cascades to turns.

No new dependency, no new failure surface, and the sweep rides exactly the traffic that creates the rows.

**Real delete or soft delete?** Both, and the split is the point.

- **`resumeState` is a real, destructive `NULL`.** This is the one place the codebase's soft-delete convention must be broken — `20260816180000_msaidizi_procedures/migration.sql` states it explicitly: *"Nothing here is hard-deleted: an archived procedure is still the explanation for whatever it did while it was active."* That convention exists so history explains itself, and the resume state is not history, it is a resumption cache. A `deletedAt` stamp leaving customer records in the column would be theatre.
- **The conversation and its turns are soft-deleted** (`deletedAt`), matching `MsaidiziProcedure`. A user pressing Delete gets: `deletedAt` set, `resumeState` nulled **immediately** (not on the next sweep), row hidden from every read path. The transcript survives until the sweeper hard-deletes it after the grace window. Say this in the UI as "removed" rather than "permanently deleted", because it is true.

**Deleting a conversation never deletes evidence.** The audit trail is a separate append-only table joined only by `agentSessionId`. Whatever the agent changed remains recorded under the user's id and `channel: AGENT` after the conversation is gone. This is the correct relationship — the conversation is a UI artefact; the audit log is the record — and it means "delete my conversation" can be an unrestricted user action without becoming a way to cover tracks. Under D3 that is not a nicety: once the agent writes, someone will eventually want to delete the chat that ordered a write, and the answer must be that it changes nothing about what is on record.

### 3.5 What this costs in the request path

**It cannot go in the run's transaction, because there isn't one.** `CapabilityInvoker` calls the API over HTTP (`capability-invoker.ts:104-115`); each endpoint commits its own transaction. By the time a run ends, its writes are already durable in tables this module never touches. A wrapping transaction could not roll them back and would only widen a lock window across several seconds of model latency.

**So: two write points, both after the work they record, both non-fatal.**

1. **Before the loop** (immediately after `sessionId` is minted, `msaidizi.service.ts:107`): upsert the conversation and open the turn. One insert. This also fixes §11.5 — a run that crashes or whose stream drops mid-loop has still left a row saying it happened, with the `agentSessionId` needed to find what it changed. Under amber that is the difference between a traceable incident and a silent one.
2. **After `finish()`**: encrypt and write the turn's `events`, update `resumeState` + counters + `lastTurnAt` + sliding `expiresAt`, in one `$transaction([insert, update])`.

**Failure handling — the house rule, applied.** `AuditLogsService.log()` never throws; it catches and logs (`audit-logs.service.ts:254-257`, and the class comment at `:200-202`: *"`log()` never throws — audit failures must not block business operations."*). Persistence follows it exactly:

- Pre-run insert fails → the run proceeds unpersisted. The user gets their answer; the audit trail still records writes; only the history entry is lost.
- Post-run write fails → the user gets their answer; the conversation is missing its last turn; the next turn falls back to client-supplied `history`.
- **Keep `history` on `AskDto` as an optional fallback** (`msaidizi.controller.ts:59-64`). Server state is authoritative when present; client `history` covers expiry and write failure. Persistence is then a strict improvement with no new single point of failure.

**Awaited, not fire-and-forget.** The response must be consistent with what was stored, because the client's next action — a confirmation click — can arrive within a second and will resume by `conversationId`. One encrypted insert (~1–5 ms) after a run that already took seconds of model latency and tool HTTP is roughly 0.02% of the request. In `askStream` it slots between `run()` returning and `send('result', …)`, for the same reason.

**The real cost is size, and it must be bounded.** `fenceToolResult` stringifies whole response bodies, and `maxToolCallsPerSession` defaults to 40 (`msaidizi.config.ts:112-114`). A conversation that lists customers a few times is megabytes. Cap it: `MSAIDIZI_RESUME_MAX_BYTES`, default 1 MB, measured on the plaintext before encryption. **Over cap ⇒ store nothing and set `resumable = false`.** Do not truncate the array — dropping arbitrary blocks breaks `tool_use`/`tool_result` pairing and produces a request the API rejects, surfacing as a generic `reason: 'failed'` indistinguishable from an outage. The UI says *"this conversation is too long to continue — start a new one"*; the transcript is still readable, and in-tab continuation still works from client-held `history`.

**One server-side trap, the mirror of §6.5.** `messages` must reach `JSON.stringify` and come back from `JSON.parse` **without passing through a class-transformer DTO.** The global `ValidationPipe` runs `whitelist: true` and strips undecorated properties — this already broke multi-turn once and is why `ConversationMessageDto.content` is only `@IsDefined()` (`msaidizi.controller.ts:30-50`, whose comment spells out the failure verbatim; pinned by `msaidizi.dto.spec.ts:47-73`). A persistence layer that "types" the stored messages on the way out reintroduces the same bug from the other end.

**Concurrency.** Two tabs on one conversation would silently diverge on a last-write-wins column. The client sends the `sequence` it last saw; if `conversation.turnCount` is higher, return **409** — *"this conversation continued in another window"* — rather than clobbering. Cheap, and it is a real chat-app failure, not a hypothetical.

### 3.6 Is there already an endpoint for this?

**No. This is new surface.** The only adjacency is `GET /audit-logs?agentSessionId=…`, and it does not do the job on four counts:

1. **It answers a different question.** It lists what the agent *changed*. It has no record of what it *read*, no user prompt, and no model prose. Under `read-only` — the current production mode — an entire agent run leaves **zero** rows, so "my conversations" would be empty for every user.
2. **You must already know the id.** There is no "list my sessions" route. `agentSessionId` is indexed (`schema.prisma:1885`) and filterable (`audit-logs.service.ts:268`), but nothing enumerates distinct ids for a user.
3. **It is the wrong permission.** `audit-logs.read` (`audit-logs.controller.ts:12`) is an oversight permission. Reading your own chat history must not require it.
4. **It is company-scoped, not author-scoped** (`audit-logs.service.ts:263`) — the exact widening §3.3 Rule 1 forbids.

**New endpoints, all under `msaidizi.use` except the last:**

| Route | Purpose |
|---|---|
| `GET /msaidizi/conversations` | List mine — metadata + title + `resumable`, paginated, `userId = me`, newest first |
| `GET /msaidizi/conversations/:id` | One conversation with its turns, decrypted, author-only |
| `DELETE /msaidizi/conversations/:id` | Soft-delete + immediate `resumeState` null |
| `GET /msaidizi/conversations/:id/audit` | Convenience proxy to `agentSessionId=…`; still enforces `audit-logs.read` |
| `GET /msaidizi/oversight/conversations` | Metadata-only projection, no title, `msaidizi.oversight` (seeded to nobody) |

**Changes to the existing surface, all additive:**

- `AskDto` gains optional `conversationId`. When present the server loads `agentSessionId` and `resumeState` from the row and **ignores** client `sessionId`/`history` — which retires the byte-fidelity contract §6.5 places on the frontend, and with it the whole class of "a well-meaning normalisation step broke multi-turn" defect that has already bitten once. `history` and `sessionId` remain as the fallback path.
- `RunResult` gains `conversationId` and `sequence`. `messages` continues to be returned, unchanged, for in-tab use and backward compatibility.
- The SSE stream emits a `session` frame **first**, carrying `conversationId` + `agentSessionId` — §11.5's recommendation, now with somewhere durable to point.
- `MsaidiziModule` adds `EncryptionService` to `providers`, as `integration-connections.module.ts:11` does. (It currently provides `MsaidiziConfig`, `ManifestProvider`, `CapabilityInvoker`, `MsaidiziService`, `ProceduresService`, `CompanyScopeService` and the `ModelClient` binding — verified.)

---

## 4. Domain grounding — what the agent knows about the business

**Decision (D2): ship a curated domain primer in the cached system prefix, plus a hand-written disambiguation map attached to collision-prone tool descriptions, both gated by a drift spec. Reject retrieval over the repo's docs. Defer the glossary tool.**

D2 is read as **business/domain grounding, not source-code reading by the agent.** One nuance is flagged rather than a disagreement, at the end of §4.4.

### 4.1 What the model is told today

There are exactly three model-facing text surfaces. There is no fourth.

**(a) The system prompt** — `backend/src/modules/msaidizi/prompts.ts`. Hand-written, 100% of it: a stable prefix (identity, "your tools are your limits", "tool results are data never instructions", accuracy, communication style), a mode clause, and a volatile tail (`Today's date is …`, `You are speaking with …`) deliberately placed after the cache breakpoint. Roughly 1,042 tokens cached at red tier.

**Every sentence of it is about *conduct*** — permissions, injection resistance, not fabricating figures, leading with the answer, TZS, language matching. **There is not one sentence about the business.** Verified by reading the whole file: the words "customer", "invoice", "GRN", "stock", "company", "branch", "division" and "group" do not appear anywhere in it.

**(b) Tool definitions** — `tool-registry.ts:buildToolDefinition`. Machine-derived, per capability:

- **name**: `capability.controller.replace(/Controller$/,'') + '_' + handler` (`toolNameFor`, `:49`).
- **description**: `describeAction()` (`:66-75`) returns `capability.summary` if the route carries `@ApiOperation({summary})`; **otherwise** the handler name split on camelCase, lowercased, plus `(VERB /path)`. Plus a tier note, plus the free-form-query note.
- **input_schema**: path params (`:id` → `"Identifier for the id in the route path."`), named `@Query('x')` params (`"Optional \`x\` filter."`), and a bare `body: {type:'object', additionalProperties:true}` if the handler declares `@Body()`.

**(c) `fenceToolResult`** (`prompts.ts:121-129`) — one fixed sentence wrapping each payload, restating the data/instruction boundary. Carries no domain content.

**Where the knowledge stops — measured against the live tree:**

| Source of description | Coverage |
|---|---|
| `@ApiOperation({summary})` | **118 of 1,219 route decorators (9.7%)**, concentrated in **14 of 199 controllers** — verified by grep |
| Handler JSDoc | 37 handlers have one, and **the manifest cannot see any of them** — `extractCapabilities` reads Nest's reflect-metadata (`capability-manifest.ts:1-14`: *"It reads Nest's own route metadata rather than parsing source"*), not source |
| DTO field descriptions | 11 `description:` strings across 351 DTO files; only 31 files use `@ApiProperty` at all |
| Prisma model doc comments | 43 of 329 models carry a preceding `///` |
| Query parameters | 271 unnamed `@Query()` vs 108 named — the unnamed ones set `freeFormQuery`, and the model is told *"Accepts additional filter parameters that are not enumerated here … do not invent parameter names"* with **nothing enumerated** |
| Untyped bodies | 46 `@Body() dto: any`, 97 `@Query() query: any`, across 81 controllers — no DTO class exists to read |

So for ~90% of the agent's toolbox, the total knowledge transferred is **a route path and a camelCase handler name.** Serialised, 60 green tools cost roughly 12 KB ≈ 3,400 tokens — about 3.3× the system prompt, carrying almost no semantics.

Two hard stops worth naming:

- **Role-gated modules are invisible, not merely unpermitted.** `GroupsController` (`modules/groups/groups.controller.ts:10-11`) is `@Roles('GROUP_SUPER_ADMIN','GROUP_DIRECTOR')` with no permission codes, and `capabilitiesFor` drops it by construction — the comment is explicit: *"An agent reaches the API through permission codes only, so that its envelope is expressible as data"* (`capability-manifest.ts:238-269`). Its five routes are among the ~40 capabilities in the manifest with no permission code at all (the prior plan's own manifest run: 23 JWT-only, 6 API-key, 6 public, 5 role-gated). **Whatever the owner means by "what Group Control holds", the agent has no tool for it and will not under the current envelope.** A primer that describes Group Control creates an expectation the system cannot satisfy, so the primer must say the boundary out loud instead.
- **`describeAction` drops the path when a summary exists.** The `westsides/`-prefixed controllers are the only delivery-note, quotation, proforma, price-list and stock-damage implementations in the system, and `mobile-pos-lite` calls `DeliveryNotesService` directly for every company. The model sees `"List delivery notes"` and cannot tell whether that is Westsides-only.

### 4.2 The failure this causes

**Case A — the reported one, reproduced mechanically.** Saved procedures compile through the *same* lexical scorer as chat, at `limit: 12` and **with no floor** (`procedures.service.ts:292-301` — verified: `{ limit: 12 }`, no `floor`). Running the real scorer over the real manifest for the instruction `"credit profile review"` returns eight tools headed by `CustomerCreditProfiles_findAll`; **`Customers_findAll` is absent.** `restrictTo` then bypasses re-narrowing (`msaidizi.service.ts:273`), so the run is sealed inside that set.

Asked how many customers are on file, the model sees exactly one plausible tool, described as:

```json
{"name":"CustomerCreditProfiles_findAll","description":"find all (GET /customer-credit-profiles)"}
```

versus the tool it needed, which it never saw:

```json
{"name":"Customers_findAll","description":"find all (GET /customers)"}
```

**The two descriptions are byte-identical apart from the path.** Nothing in the prompt says they are different concepts, so answering "0 customers" was not a hallucination — it was the only reading available.

It is also worse than a naming collision. Verified in `schema.prisma:13851-13875`: `CustomerCreditProfile` carries a `customerId String` column and **no `customer` relation field at all** — its only relations are `company` and `reviewedBy`. `BACKEND_LOGIC_AUDIT_FINDINGS.md:872` records that its `creditLimit` is never consulted by the sales credit gate (`sales-orders.service.ts:1795-1814` reads `customer.creditLimit`), and that `currentOutstanding`/`overdueAmount` are never written by any flow. **The agent read an orphan table and reported its emptiness as a fact about the business.**

**Case B — the sign of the money is invertible.** `Debt` (`schema.prisma:1612-1637`) has `creditorName`, `creditorContact`, and relations only to `Company` and `Document` — **no customer or supplier relation.** It is money **the company owes**. `Receivable` is money owed **to** the company. The agent's descriptions are `"find all (GET /debts)"` and `"find all (GET /receivables)"`.

Run the scorer:

- `"what is our outstanding debt"` → `Debts_*` plus fifteen alphabetical fallback tools (`AccountingLocks`, `ActiveSessions`, `AlertEvents`, `ApiKeys`, `BackupJobs`…). `Receivables_findAll`: absent.
- `"how much money are we owed"` → **score 0 for every capability.** The floor fires (`domain-filter.ts:150,179-187`) and hands the model twenty shallowest-path tools alphabetically — api-keys and backup-jobs — to answer a receivables question.

Ask "how much are we owed" and get either nothing, or `Debts` with the sign reversed, reported confidently.

**Case C — a business concept spanning modules, where no single endpoint description could ever help.** A POS counter sale is one user-visible event and at least four records. Verified in `mobile-pos-lite.service.ts`: `createSale` → `salesOrders.mobilePosLiteQuickSale()` (`:2161`), with `SALE_ISSUE` inventory movements written **inside `SalesOrdersService.confirm()`** (`sales-orders.service.ts:2092`; the POS service says so at `:2531-2532`), then — behind the counter-sale delivery-note flag — a `DeliveryNote` created and driven `DRAFT → DISPATCHED → DELIVERED`, which the code is emphatic **"MOVES NO STOCK. DeliveryNotesService has no inventory effects of any kind"** (`:2531`, and again at `:2251-2253`).

Ask the agent `"what did the POS sale do to our stock"`. The scorer returns 25 tools; **every one is `mobile-pos-lite/*` or `stock-*`**. `InventoryMovements_findAll`, `InventoryBalances_findAll`, `SalesOrders_findAll` and `DeliveryNotes_findAll` — the four places the answer actually lives — are **all absent**, because the words "inventory", "movement", "sales order" and "delivery note" are not in the question. No endpoint description can fix this: the fact needed is *the relationship between four modules*, which by construction is not a property of any one of them.

**Why this gets more expensive under D3.** Under read-only, Case A costs a wrong answer. Under amber, the same misread concept chooses a *write* — a credit limit updated on an orphan table that nothing enforces, or a "debt" recorded against a customer who is actually owed money. **This is the argument for grounding being an amber gate rather than a nice-to-have** (§9.3).

### 4.3 The options

**(a) Curated domain primer in the stable system prefix.** Bounded, deterministic, reviewable in one diff, sits beside the security text it is peer to, and is the only option that can carry *cross-module* facts (Case C). Ships as data in `prompts.ts` with no new moving parts and no new failure mode. Costs: hand-maintained; competes for attention; stated once, far from the point of use.

**(b) Retrieval over the repo's own docs. Reject — with evidence, not on principle.** The corpus is not true. `docs/codebase-master-study.md` (929 lines, *"Last updated: 2026-05-18"*) asserts at line 199 **"Total: ~200 backend modules, all wired into `AppModule`"** and names `fuel-tanks`, `vehicles`, `farms`, `construction-projects`, `hospitality-facilities`, `rooms`, `parking-zones`, `rental-units`, `group-control`, `bi`, `help-center`. Verified: the tree has **152 module directories and none of those eleven exist.** `docs/user-manuals/sales-inventory-user-guide.md` documents a **Product Variants** feature with a click path; there is **no `ProductVariant` anywhere in `schema.prisma` or `backend/src`** — verified, zero hits. The user manuals are also the wrong genre: second-person UI click-paths for a human at a screen, not concept definitions for a client calling HTTP. Retrieval over this corpus would ground the agent in a system that does not exist, and would do so *confidently* — the exact failure mode the rest of this design is built to avoid. It also adds a hop inside a 60-tool budget and one more tool competing for selection.

**(c) Richer capability descriptions generated from schema/DTO comments.** Closest to the existing machinery and the right long-run answer — but the raw material is mostly absent (9.7% summaries, 11 DTO descriptions, 43 of 329 models). Three sub-options differ sharply in cost:

- **c1 — harvest what is already written.** The 37 handler JSDoc comments are genuinely good and are invisible only because extraction reads runtime metadata. Reaching them needs a build-step source scan emitting a `capabilityId → description` artifact — new pipeline, new drift surface.
- **c2 — surface DTO fields at runtime.** `QueryCustomerDto` is fully typed and reachable via `design:paramtypes` plus class-validator's metadata storage. This fixes a real, separate defect: today `Customers_findAll` is emitted with `properties: {}`, so the agent cannot filter or page and gets the default page of rows. Worth doing on its own merits; it does **not** address concept confusion.
- **c3 — the cheap slice that actually prevents Case A.** A small hand-curated `DISAMBIGUATION: Record<capabilityId, string>` appended to the description of collision-prone capabilities only. Twelve to twenty entries. It puts the fact **at the point of use**, where the model cannot skim past it, and it survives narrowing — it travels with whichever tool was selected.

**(d) On-demand glossary tool.** Scales, self-documenting, model pulls only what it needs. But: a round trip inside a 40-call ceiling; one more tool competing for selection in a 60-tool budget; and — decisively — **the model must know it is confused in order to look something up.** In Case A it was not confused. It had one plausible tool and a clean answer. Defer.

**Cache economics — the honest read.** Render order is `tools → system → messages`, and a `cache_control` breakpoint caches everything up to it. Two consequences:

1. **The existing breakpoint almost never hits across turns.** The tool array renders *before* the system block, and `registryFor` re-derives it from the newest user message every turn — and a tool-definition change invalidates the tools, system **and** message caches. It does hit *within* a run, since the registry is computed once before the loop. So a primer is paid at full price roughly once per user turn and at a tenth of that for every subsequent model turn in that run.
2. **At this scale, cache economics do not decide the question.** A ~1,200-token primer at $5/MTok is about **$0.006 per user turn**. Against the ~3,400 tokens of tool schemas already sent, a primer is ~26% more prefix for a change that decides whether the answer is right.

Worth flagging for a later pass, not this one: **mid-conversation tool changes** let the tool set change between turns *without* invalidating the cached prefix, via `tool_addition`/`tool_removal` blocks over tools declared `defer_loading: true`. `tool-registry.ts:78-82` already emits `defer_loading` and no caller sets it. This is a *control* mechanism, explicitly distinct from tool search (*discovery*), which §10.3 settled against — so §10.3 does not dispose of it. It would make the primer genuinely cacheable and is the same lever that cleanly fixes §6.1. **Verify against current API documentation before relying on it.**

### 4.4 Decision

**Ship (a) + (c3) together, in one PR, gated by a drift spec. Defer (c1)/(c2). Reject (b).**

1. **A `DOMAIN_PRIMER` constant in `prompts.ts`, ~900–1,300 tokens, inside the cached stable prefix, after the Accuracy section and before "How to communicate."** Not a description of the app. Four things only, because these are the four the code cannot say for itself:
   - **The org shape as the agent can reach it**: Group → Company → Division → Branch, the three companies (Mwanjalisi Oil `MWAN`, Itemba Enterprises `ITEM`, Westsides `WEST`), amounts in TZS. Plus the honest boundary: *the group level itself is not something you have tools for.*
   - **A concept-ownership table**: which module owns which noun, and — the load-bearing half — **what each one is not**. `customers` is the master list; `customer-credit-profiles` is a review record with no link to it; `receivables` is money owed to us, `debts` is money we owe a named creditor; `inventory-balances` is what is on hand now, `inventory-movements` is the history of how it got there.
   - **Two document chains, as sequences**: `Quotation → Proforma → SalesOrder → DeliveryNote → Payment` and `Requisition → RFQ → SupplierQuotation → BidComparison → PO → GRN → SupplierInvoice → 3-way match → AP`. Six lines. These are the facts that turn a one-tool answer into a three-tool answer.
   - **The three or four cross-module truths** no endpoint can state — chiefly: *a POS counter sale is a SalesOrder plus SALE_ISSUE inventory movements plus a receivable/cash receipt plus a GL posting; the delivery note it also writes moves no stock.*
2. **`DISAMBIGUATION` map in `tool-registry.ts`**, appended by `buildToolDefinition` after `describeAction()`. Twelve to twenty entries covering the measured collisions: the three "customers" (`Customers_*`, `CustomerCreditProfiles_*`, `MobilePosLite_customers`), `Debts` vs `Receivables`, `inventory-balances` vs `inventory-movements`, `financial-reports` vs `financial-statements` vs `operations-reports` vs `profit`, and the `westsides/` mount question. Example: `CustomerCreditProfiles.findAll` → *"Credit-limit review records. NOT the customer master — use Customers_findAll for that. Not linked to Customer and not enforced anywhere."* This is what would have caught Case A.

Rationale: the primer is the only artifact that can carry cross-module facts, and the disambiguation map is the only one that survives narrowing intact. Neither adds a runtime dependency, a network hop, a tool slot, or a new failure mode — which matters, because everything else in this module is engineered so failures are structural rather than advisory.

**What would change my mind:**

- **If the disambiguation map grows past ~30 entries**, the hand-maintained approach has lost and (d) — a glossary tool over a generated index — becomes correct.
- **If someone lands (c1)** and the 37 JSDoc lines turn out to be the tip of a much larger accurate seam in service-layer comments (the POS service alone carries hundreds of lines of genuinely excellent domain prose), generation beats curation and the primer shrinks to the cross-module facts only.
- **If a doc in `docs/` is put under a CI truth-check** and made accurate, (b) becomes viable for the long tail. Today the opposite is true and it is not close.
- **If the agent proves able to notice its own confusion** — if transcripts show it saying "I found credit profiles but I'm not sure those are customers" — then (d) is cheap and correct and the primer can shrink. Nothing in first light suggests it does.

**The one nuance on D2's interpretation, flagged as instructed.** Business/domain grounding is the right target. But **several of the highest-value grounding facts exist only in source-code comments, not in any business document.** "A delivery note moves no stock; `SalesOrdersService.confirm()` already issued it" is a business fact, and the only place it is written down is `mobile-pos-lite.service.ts:2531`. The agent does not need to read source at runtime; **a human distilling source into the primer does.** Read D2 as *business grounding, sourced partly from code comments* — not as source-code reading by the agent. If the owner meant the agent should read the repo at runtime, that is a different and much larger feature, and it should be said explicitly rather than arrived at.

### 4.5 The maintenance problem

A hand-written primer drifts. `docs/codebase-master-study.md` is the proof — three months old and describing ten industry verticals that are not in the tree. Assume the primer will be wrong within two releases unless something makes it fail.

The repo already has the answer, in this exact module. `capability-manifest.ts` calls its spec *"the drift guard that keeps every endpoint classified"*, and `mobile-pos-lite.service.ts` records the pattern in prose: a source-level guard in the spec fails the day the claim stops being true. Apply it:

**The rule: a primer claim that cannot be asserted against the live manifest does not go in the primer.** Ship `prompts.domain.spec.ts` alongside the primer, structured as claims rather than prose:

```
{ says: 'The customer master is the customers module',
  assert: manifest has CustomersController.findAll with permission 'customers.view' }
{ says: 'Credit profiles are a separate record, not the customer master',
  assert: CustomerCreditProfile has no relation field to Customer in schema.prisma }
{ says: 'A POS sale writes SALE_ISSUE movements via SalesOrdersService.confirm()',
  assert: source-level grep, exactly as the POS spec already does }
{ says: 'Delivery notes move no stock',
  assert: DeliveryNotesService references no inventoryMovement/inventoryBalance }
```

Every claim naming a module, a route, a permission code, a Prisma model, or a service relationship becomes an assertion. **The subset that cannot be asserted is the subset that must not be written.** That constraint is the feature: it keeps the primer small and factual, and stops it drifting into the aspirational register that made the master study false.

Three more disciplines:

- **Every `DISAMBIGUATION` key is asserted to exist in the manifest.** A renamed controller fails CI rather than silently orphaning a note.
- **Colocation.** The primer lives in `prompts.ts`, not `docs/` — a reviewer changing the security text sees it; a reviewer changing `docs/` never touches it.
- **How anyone notices when it is wrong in a way the spec cannot see** (a claim true of the code and false of the business): the primer states a date and a version, the run's `sessionId` correlates to the audit trail and now to a stored conversation (§3), and this is what §11.1's narrowed-count instrumentation is for. Absent that, nobody notices — which is the honest answer, and the reason the assertable subset must be the whole primer.

### 4.6 What this does not fix

**Three separate defects, three separate fixes. Do not let a domain-grounding PR be scored as progress on any of the others.**

| | What it is | Does domain grounding fix it? |
|---|---|---|
| **Selection** — the wrong 60 reach the model | `domain-filter.ts` scores English token overlap against paths, handler names and permission codes, **before the model sees anything**. `"how much money are we owed"` scores 0 across the entire manifest. | **No.** The primer is in the system prompt; the filter never reads it. A tool that is filtered out cannot be reasoned about, however well the model understands the domain. |
| **Interpretation** — the right tool is present but misread | Case A: one plausible tool, indistinguishable description, honest wrong answer. | **Yes — this is exactly what it fixes**, and (c3) fixes it structurally by attaching the fact to the tool. |
| **Confirmation resume** — `"yes"` re-narrows and deletes the approved tool (§6.1) | A state bug: `registryFor` re-derives from the newest string message even on the turn carrying `confirmed`. | **No, and not close.** `"yes"` has no domain vocabulary to improve. |

**The one place they genuinely meet.** The primer's *concept-ownership table* is, structurally, a `concept → module → synonyms` index. If that index is also fed to the retrieval step, one artifact serves both layers:

- feed it to the **Haiku pre-filter** (§10.1) as its reference vocabulary, so `"how much money are we owed"` and `"tunadai kiasi gani"` both resolve to `receivables customer-statements outstanding aging` before `narrowCapabilities` runs; and/or
- fold its synonyms into `capabilityTokens()` (`domain-filter.ts:114`) as a static expansion — `owed|owing|debtor → receivable`, `stock|shelf → inventory`, `till|counter → mobile-pos-lite` — a five-line change that raises the floor for cases the classifier is overkill for.

Build it **as one artifact with two consumers**, but plan it as such. Writing the primer alone and expecting narrowing to improve is the mistake to avoid: it produces an agent that understands the business perfectly and is handed the wrong toolbox to answer with — which, per §11.1, is the failure mode most likely to lose the owner's trust, because it is invisible from the outside.

---

## 5. Permissions — admin only by default

**Decision (D4): `msaidizi.use` and the three `msaidizi.procedures.*` permissions are seeded to `GROUP_SUPER_ADMIN` only. COMPANY_MANAGER and GROUP_DIRECTOR lose them. Any later grant is a deliberate, named act.**

### 5.1 What is true today

The four permissions are defined at `database/seeds/seed.ts:173,177` — `msaidizi.use`, and `msaidizi.procedures.{view,manage,approve}`. The seed's own comment on `msaidizi.use` is worth keeping in view: *"It confers no data access of its own: the agent acts under whatever else the holder is granted, so this only decides who may talk to it, never what it can reach on their behalf."*

Three roles hold them, by two different mechanisms:

| Role | How it gets `msaidizi.use` | Where |
|---|---|---|
| `GROUP_SUPER_ADMIN` | `filter: all` — it holds every permission in the system automatically | `seed.ts:1327-1333` |
| `GROUP_DIRECTOR` | explicit `inModules('msaidizi', 'msaidizi.procedures')` | `seed.ts:1345` |
| `COMPANY_MANAGER` | `'msaidizi', 'msaidizi.procedures'` inside its `inModules(...)` list | `seed.ts:1532-1533` |

**Permissions come only from roles.** There is no per-user permission model — verified: `jwt.strategy.ts:90` and `auth.service.ts:731` both compute `permissions` as `user.userRoles.flatMap(ur => ur.role.rolePermissions.map(rp => rp.permission.code))`, and nothing else contributes. So "the admin account alone" is expressible only as "the role that only the admin holds", which is `GROUP_SUPER_ADMIN`.

### 5.2 The change

Two edits to `seed.ts`, and nothing else:

1. Delete `inModules('msaidizi', 'msaidizi.procedures')` from `GROUP_DIRECTOR`'s filter (`:1345`).
2. Delete `'msaidizi'` and `'msaidizi.procedures'` from `COMPANY_MANAGER`'s `inModules(...)` (`:1532-1533`).

`GROUP_SUPER_ADMIN` needs no edit: `filter: all` picks the permissions up automatically, and will pick up `msaidizi.oversight` (§3.3) the same way — which is itself worth noting, because it means the owner's account gets every new msaidizi permission by default and nobody else does. That is the intended posture.

Leave the permission *definitions* in place. They are the vocabulary; removing them would orphan the `@RequirePermissions('msaidizi.use')` decorators on the controllers and make every route unreachable by anyone.

### 5.3 What happens to people who already hold it — and why this is migration-shaped

**Nobody loses anything they are using.** No frontend references msaidizi (verified: zero files), and the only way to reach the agent today is a hand-made HTTP request with a bearer token. In practice the affected population is "people who could have used a script and did not".

**But the mechanism deserves stating precisely, because it has three sharp edges.**

**Edge 1 — the seed is the migration, and it full-replaces.** `seed.ts:2355-2360` does, per role: `rolePermission.deleteMany({ where: { roleId } })` then `createMany(...)` — the comment says *"Replace role permissions (full replace for idempotency)"*. There is no Prisma migration for permission grants and no `_prisma_migrations` row recording one. So narrowing the seed **has the effect of a migration without the safety of one**: it is applied by running the seed, it is not versioned, there is no down script, and its rollback is "edit the file back and run it again". Treat it accordingly — a named deployment step, reviewed as a schema change would be, not a drive-by edit.

**Edge 2 — revocation propagates in about a minute, without re-login.** `jwt.strategy.ts` caches the computed permission set per user for `PERMISSION_CACHE_TTL_MS = 60_000` (`:18`, and the comment says exactly why: *"short enough that revocations propagate fast"*). A seed run that deletes the `RolePermission` rows takes effect within 60 seconds for everyone holding the role, with no token rotation. That is good, and it is also the reason not to run the seed casually against production while someone is mid-run.

**Edge 3 — and this is the trap — a later grant made through the UI is silently reverted by the next seed run.** `PATCH /roles/:id` with `permissionIds` (`roles.service.ts:145-156`) does the same delete-then-create full replace, inside a transaction, and then invalidates the permission cache for every holder. It works, and the next `seed.ts` run overwrites it, because the seed's filter — not the database — is the source of truth for a system role.

### 5.4 How a role is granted it deliberately, later

Two routes. **Prefer the second.**

**(i) Widen the seed.** Add the module back to a role's filter in `seed.ts`, review it as the permission change it is, and deploy. Durable, versioned in git, survives every future seed run. Correct when the answer is "all company managers should have this", which is a real decision someone should make once.

**(ii) Create a new, non-system role.** `POST /roles` (`roles.service.ts:120-131`) creates a role with `permissionIds`, and roles created through the API are **not** `isSystem` — only seeded baseline roles are, and `remove()` refuses to delete those (`roles.service.ts:189-193`). A role the seed does not manage is a role the seed does not overwrite. So: create `MSAIDIZI_USER` holding exactly `msaidizi.use` (plus `msaidizi.procedures.view` when procedures ship), and assign it alongside a person's existing role via `users.assign_roles`. Because permissions are the union across a user's roles (`jwt.strategy.ts:88-92`), this adds the agent to someone without touching what else they can do.

**Route (ii) is the recommendation for pilots**, and it is what §9's phasing assumes: amber goes to one user in one company, and the cleanest expression of "one user" is a role with one holder. It also makes the revocation trivial and auditable — unassign the role.

**One thing to check before either route:** granting `msaidizi.use` to a role grants the agent to *everyone who holds that role*, under *their own* permissions. The agent's blast radius for a new holder is whatever else that person can already do — which is the design, and is also why "just give it to COMPANY_MANAGER" is a bigger decision than it looks. A COMPANY_MANAGER reaches 1,001 capabilities at red tier (§10.3).

### 5.5 What the UI does about it

Nothing special, and that is the point. The nav leaf carries `permission: 'msaidizi.use'` (§1.3), so the entire surface — sidebar entry, command-palette command, launcher, page — is **absent** for anyone without it, not present-and-disabled. That mirrors `PermissionGate` (`components/ui/permission-gate.tsx`), which renders `null` rather than a denial, and it is the UI expression of the backend's own rule: an unpermitted capability is invisible, never refused.

A user who navigates to `/msaidizi` directly without the permission gets the app's standard not-authorised treatment from the route guard, and `POST /ask` would 403 anyway (`@RequirePermissions('msaidizi.use')` on both handlers).

---

## 6. The confirmation gate

The single most safety-critical screen, and — under D3 — the first thing on the critical path rather than the last. Everything the owner wants from "it should be able to make requests once I prompt it" runs through this gate at red tier, and the gate does not currently work.

### 6.1 The defect that must be fixed first

`registryFor` (`msaidizi.service.ts:271-297`) re-derives the tool set from the newest string-content user message on **every** turn, including the turn carrying `confirmed`. Because a broadly-granted role always exceeds `TOOL_BUDGET = 60` (COMPANY_MANAGER: 1,001 permitted at red tier), narrowing always runs. Measured against the real manifest:

```
"post journal entry 41"   -> 24 tools, contains JournalEntriesController.post: true
"yes"                     -> 20 tools, contains it: FALSE
"yes, go ahead"           -> 20 tools, contains it: FALSE
"ndiyo"                   -> 20 tools, contains it: FALSE
```

A bare confirmation deletes the red tool from the registry. The model's re-issued call hits `if (!entry)` at `:169-176` and gets *"No such tool"*. **The confirmed action can never execute.**

Note the shape of the near-miss: §6.5's decision to compose the message from the action's description (*"Yes — go ahead and delete invoice 41"*) would probably re-narrow to include the tool, by accident, because it carries the right vocabulary. **Nothing may rely on that.** A safety gate that works because of an incidental property of a lexical scorer is not a safety gate.

**Fix:** when `request.confirmed` is non-empty, skip narrowing — or union the narrowed set with the tools named in the prior turn's `tool_use` blocks. Union is the better shape: it keeps the budget bounded and generalises to the multi-confirmation case (§6.4).

**Why this is first, not last.** It is a one-line-ish change in a file with existing specs, it needs no frontend, and **it can be proved without a single line of UI** — a script sends turn 1, receives `confirmation_required`, sends turn 2 with `confirmed:[id]`, and someone checks that the audit row exists. That positive control is §9.1's gate. It is the most important untested thing in the system and it has been sitting behind four phases of UI work for no reason other than sequencing.

It is worth noticing that this is the same shape as the bug that broke multi-turn in §9a of the prior plan: a path that only executes on the *second* HTTP request, which no service-level spec touches. `backend/test/adversarial/README.md` records the confirmation gate as verified only up to `awaiting_confirmation` — *"The delete was proposed, never executed."*

### 6.2 What must be on the screen for the yes to mean anything

From the `confirmation_required` event alone, with no additional call:

1. **The model's own preceding `text`.** The red-tier prompt clause instructs it to state the specific records and amounts before asking. This is usually the most human-readable thing on the screen and it goes at the top, not in a disclosure.
2. **`description`**, verbatim, as escaped text. It contains verb, path and every argument.
3. **`args` as a key/value table.** This is the substance — which record, which amount. Not a JSON blob; a two-column table with the keys de-camel-cased.
4. **An explicit irreversibility line**: *"This cannot be undone by Msaidizi. Reversing it means doing the opposite by hand."* Not UI hedging — it is the recorded architectural decision. Automatic undo was deliberately not built, because an undo that usually works is worse than none.
5. **A link to the record.** Built from a small hand-maintained map of red capability → app route plus `args.id`, so the manager can open the thing in another tab and look at it before answering.

The gate renders **inline in the thread**, in sequence, where the steps that led to it are still visible above it. That is the D1 property doing safety work: the reader can see that the agent looked at invoice 41 and then proposed deleting invoice 41, without navigating anywhere.

### 6.3 What cannot be shown, and the honest consequence

The backend provides **no pre-image** — no current state of the record, no monetary impact beyond what appears in `args`, no diff. A generic "fetch the before-state" mechanism would need a capability→read-endpoint mapping the manifest does not carry, and would be confidently wrong often enough to be worse than absent.

**Decision: no generic pre-image fetching.** Ship the record link in §6.2.5 and accept that the manager must look. This is the plan's weakest point and it is stated as such in §11.3.

**One thing that changes the calculus, and is worth revisiting once §4 lands:** a *curated* map for the dozen or so red capabilities anyone actually uses is not the same project as a generic one. The `DISAMBIGUATION` map (§4.4) establishes that hand-curating a small, CI-asserted table over collision-prone capabilities is acceptable in this codebase. A `RED_PREIMAGE` map of the same size and the same discipline — red capability → the read capability that shows its current state — is the same shape of artifact, and it would put the before-state on the gate for the actions that matter. Not in the first version; a strong candidate for the red phase (§9.5).

### 6.4 Multiple confirmations, and why this is not `ConfirmDialog`

The loop `continue`s rather than breaking (`msaidizi.service.ts:203-222`), so one assistant turn proposing three red actions yields **three `confirmation_required` events and one `awaiting_confirmation` result**. And green/amber tools in the same batch **execute anyway** — suspension stops the run, not the batch. If the model interleaves a read and a delete, the read has already happened by the time the gate appears.

`ConfirmDialog` (`components/ui/confirm-dialog.tsx`, used in 59 files) is the wrong primitive on three counts, worth naming so nobody tries:

| `ConfirmDialog` | The gate |
|---|---|
| One `message: string` | A list of distinct actions, each with its own id and args |
| `onConfirm: () => void \| Promise<void>` — returns nothing | Must thread `conversationId` (or `sessionId` + `messages`) plus `confirmed[]` into a **later HTTP request** |
| One action, one dialog, one call | A suspended run resumed by a new turn |

So the gate is a **checklist inside the thread**, not a modal. Each proposed action is a row with its own checkbox, unchecked by default. "Approve all" requires checking each — there is no select-all. Approving three destructive actions should cost three deliberate clicks.

### 6.5 The resume

With §3 landed, the resuming request is small:

```jsonc
{
  "message":        "Yes — go ahead and delete invoice 41.",
  "conversationId": "<from the suspended response>",
  "confirmed":      ["cnf_Invoices_remove_1a2b3c"]
}
```

The server loads `agentSessionId` and `resumeState` from the row, so the client no longer carries transport state. **That is the main product argument for persistence beyond history**: it deletes an entire class of client bug.

The pre-persistence path stays supported and stays documented, because it is the fallback when the resume state has expired or failed to write (§3.5):

- **`sessionId` is mandatory** on that path. The confirmation id is derived from it (`msaidizi.service.ts:333-347`). Omit it and `run` mints a fresh one (`:107`), every recomputed id differs, and the run suspends again — an infinite approval loop that looks exactly like the server ignoring the user.
- **`history` must include the suspended turn**, so the model still holds the `tool_use` block and the "stop and wait" tool_result and re-proposes the same call with the same args.
- **`messages` is opaque.** Do not re-serialise it through a typed model, do not reorder keys, do not strip `id` / `caller` / anything unrecognised, do not trim the array. This is the frontend mirror of the `@IsDefined()` bug that already broke multi-turn once (`msaidizi.controller.ts:30-50`; `msaidizi.dto.spec.ts:47-73` pins it).

Two rules that hold on both paths:

- **`message` is required** (`@MinLength(1)`); there is no confirm-only endpoint. **The UI composes it from the approved action's description, not a bare "yes".** The click is the consent; the message is the record of *what* was consented to, and it now lives in a stored transcript anyone reviewing the conversation will read. `"Yes, go ahead."` in a transcript is evidence of nothing.
- **`confirmed` is a one-shot.** It is a plain set checked against every red proposal for the whole run. A client that keeps it in component state and re-sends it on subsequent turns has silently granted standing permission for that exact action for the rest of the session. Send it on the resuming turn, then clear it — hold it in a consumed variable, never in persistent state, and never in the database (§3.3).

### 6.6 Decline, and abandonment

There is no decline endpoint and no server-side pending state. Confirmation is *derived*, not stored — no row, no cache, no TTL. §3 does not change this and deliberately does not persist `confirmed[]`.

- **Decline:** the next turn goes normally with `confirmed` omitted and a message saying no. The model sees the "stop and wait" tool_result plus the refusal and moves on. The UI strikes the declined row through and leaves it in the thread, where it is now part of the stored transcript. Nothing to clean up.
- **Abandon** — closes the tab, drops the stream, never comes back: **nothing happens.** No action executes, no row is written, no lock is held, no timer expires. The thread says so, because it is a genuinely reassuring true statement and those are rare:

  > **Nothing has changed yet.** Closing this leaves everything as it is.

- **Stale approval:** an id stays valid as long as the same `sessionId` is in play. There is no expiry — except that with §3, `resumeExpiresAt` gives one in practice: after 24h the conversation is not resumable, so the approval has nowhere to be replayed. That is a side benefit, not the control; the control is the client clearing `confirmed` after use.

The confirmation id is **not a secret and not an authorization token** (`msaidizi.service.ts:339-340` says so). Its value is that it names exactly one action; the actual authorization is the bearer token and the permission envelope. Do not build anything that assumes it is unguessable, and do not redact it in logs.

---

## 7. Saved procedures in the UI

Route `/msaidizi/procedures`, three permission-gated surfaces: browse (`msaidizi.procedures.view`), author (`…manage`), approve (`…approve`). Every one of `procedures.controller.ts`'s seven endpoints is script-only today. Under D4 all three permissions start with `GROUP_SUPER_ADMIN` alone (§5), which makes the maker-checker rule temporarily unusable — a procedure must be approved by someone other than its author, and at first there is only one holder. **That is a reason to grant `msaidizi.procedures.approve` to a second named person early, not a reason to weaken the rule.**

Note the asymmetry to honour: the two `GET`s do not call `assertEnabled()`, so **a procedures library stays browsable when `MSAIDIZI_ENABLED=false`**. Everything else 503s. The list page must render fine with the module off, with a banner saying nothing can run.

### 7.1 Authoring

Instruction box → `POST /compile` → reviewable preview.

`compile` saves nothing. It resolves the instruction against **the author's current permissions × the deployment's write mode**, through the same lexical narrowing the live agent uses, capped at **12** capabilities (`procedures.service.ts:292-301`). The preview renders `preview[]` as a table — tool, plain description, tier badge, `VERB /path` — under a prominent **blast-radius banner** driven by `highestTier`:

> **This procedure can change things.** Highest tier: **amber** — reversible changes.

Three things the screen must say plainly:

- Compile is a preview. Nothing is saved.
- The list is capped at 12. *"A procedure that needs dozens of capabilities is not a procedure, it is the whole agent"* — `procedures.service.ts:286-289`.
- The result is a **DRAFT and cannot run** until someone else approves it.

`POST /` re-derives what the author may reach and **intersects** — a client-supplied capability the author does not hold is silently dropped. So the UI must not treat its own preview as authoritative; it re-reads the created row's `capabilities` and shows what actually got saved.

**No match ⇒ 400** *"No capabilities you hold match that instruction…"* — and `selectForInstruction` has **no `floor`** (verified: `{ limit: 12 }` only), unlike the chat path which floors at 20. So a compile that scores zero *throws* rather than degrading. This is where Swahili hard-fails today (§10.1). The UI cannot fix that and must not paper over it: surface the backend's message unchanged and add *"Try naming the records involved — suppliers, invoices, stock."*

**Red-tier procedures are a dead end and the author must be told at authoring time.** `POST /:id/run` passes no `sessionId`, so `run()` mints a new one per run and every confirmation id recomputes differently. A red procedure suspends forever. When `highestTier === 'red'`, the create screen says so and recommends running it as a chat instead. Fixing this is a red gate (§9.5).

### 7.2 The maker-checker approval

`activate()` refuses an approver who is the author: **403 *"A procedure must be approved by someone other than its author."*** (`procedures.service.ts:163-167`).

**Surface that as a designed state, not an error toast.** When `createdById === me.id`, the Approve button is **absent** — not present-and-disabled with a tooltip — and the panel reads: *"You wrote this. Someone else has to approve it."* That is the whole point of the feature; a 403 red toast makes it look like a bug.

The closest structural analogue in-repo is `app/(dashboard)/approvals/pending/page.tsx` (291 lines): `ResponsiveDataTable`, per-row `busyId` so one action does not freeze the table, a reject flow that opens a `Modal` with a `FormTextarea` for a reason, `showToast` on both paths, optimistic row removal. Reuse that shape wholesale. It is the one place in this feature where an existing page maps almost exactly.

**Two things block this being a real review, and one is a hard gate.**

- **The row stores bare tool names.** `MsaidiziProcedure.capabilities` is a JSON array of strings; `createdById` / `approvedById` come back as bare UUIDs (`schema.prisma:288-317`). There is **no `GET /:id/preview`**, and `POST /compile` takes an instruction, not an id. So the approver either sees unadorned identifiers, or the UI re-compiles the instruction — which may now resolve *differently* than when it was saved, meaning the approver reviews something other than what is stored. **Re-compiling to populate an approval screen is not acceptable.** `GET /msaidizi/procedures/:id/preview` is a gate on the approval UI shipping (§8.5).
- **User names need a join.** The UI resolves `createdById` / `approvedById` against `/users` itself.

### 7.3 The hostile-payload risk, and how it reaches the approver

First light proved a hostile **saved procedure** is REPORTED, not obeyed or concealed — the sharpest result in the suite, because a procedure's instruction sits closer to the model's own instructions than a customer note does.

But the instruction is author-supplied free text that becomes model instructions, and **the approver is the only human who reads it.** So:

- **The approval screen renders the full instruction verbatim, as escaped monospace text, with no truncation, no ellipsis, no Markdown rendering, and no "show more".** An instruction truncated in the UI is an instruction nobody approved. This is the single most important rule on the screen.
- A standing note above it: *"This text becomes instructions to Msaidizi. Read all of it."*
- The capability list and `highestTier` sit **below** the instruction, not above. The tier tells you the blast radius; the instruction tells you the intent, and intent is what is being reviewed.
- The approve action is a `ConfirmDialog` with `variant='danger'` naming the author: *"Approve Rehema's procedure 'Weekly supplier close'? It will run under whoever invokes it, with their access."*

### 7.4 Running one

ACTIVE only (DRAFT ⇒ 403 *"not been reviewed and approved yet"*, ARCHIVED ⇒ 403, `procedures.service.ts:243-249`). Optional `context` field (≤2000 chars), appended as `"{instruction}\n\nFor this run: {context}"`.

The result is a `RunResult` in the same shape as `/ask`, so it renders in the same thread (§2) and is stored as a conversation with `procedureId` set on the turn (§3.2). Two things the run screen must convey:

- **It runs under the invoker's permissions, never the author's.** `resolveForRun` intersects the stored list with a registry built from the *invoker's* permissions and the current write mode (`:251-256`); an empty intersection is **403 *"You do not have access to any of the actions this procedure needs"*** — refused outright rather than half-executed. Surface that as an explanation, not a failure: *"This procedure needs access you do not have. Ask the person who owns it to run it, or request the access."*
- **The stored list is a ceiling, not a snapshot to refresh.** A procedure approved last month does not widen because a new endpoint shipped last week. The migration comment says it outright: *"A relational edge would imply the set tracks the manifest as it changes, which is the opposite of what an approval means."* Say so on the detail page; it is the property that makes approval meaningful.

`POST /:id/run` is not streamed — there is no streaming procedure endpoint. A procedure run therefore shows a spinner with the step count unknown until it returns. Acceptable; if procedure runs get long, the same `@Res()` treatment as `ask/stream` is a small backend addition.

---

## 8. What the backend must ship before the UI can be honest

Six items. Each is small. Each blocks something specific, and the blocking relationship is what makes them worth doing first rather than alongside.

### 8.1 The two `registryFor` defects — hours, and they come first

**A — the confirmation resume drops the tool being confirmed.** §6.1. Live, reachable, and it means a confirmed action can never execute. Under D3 this is **the first change in the project**, not a red gate.

**B — narrowing is skipped for structured user content.** The same line requires `typeof m.content === 'string'` and falls through to `return permitted` — the full permitted set, 474 tools today, 1,001 at red — when no string user turn exists.

**Correction to the original investigation on B: it is not currently reachable.** `msaidizi.controller.ts:120` always appends `{role:'user', content: dto.message}` where `dto.message` is `@IsString`, and `procedures.controller.ts:130` passes a string too. So `latestUserText` is always defined on both live paths. B is a latent hazard in `MsaidiziService.run`'s own contract — it would fire the moment a caller passes structured-only user content — not a live defect. **Guard it (cheap, one line), but it gates nothing.**

### 8.2 `GET /msaidizi/capabilities` — one to two days

Nothing tells a client whether Msaidizi is enabled, what `writeMode` is, which capabilities the current user's agent can reach, or what the budgets are. The only enabled-signal is a 503 on `POST /ask` — **you must attempt a run to learn the feature is off.**

`MsaidiziConfig` is already exported from the module (`msaidizi.module.ts:35`) and `ManifestProvider.capabilities()` already exists. Return:

```jsonc
{ "enabled": true, "writeMode": "read-only", "allowedTiers": ["green"],
  "budgets": { "maxToolCalls": 40, "maxWrites": 10 },
  "capabilities": [ { "name": "Customers_findAll", "description": "list all customers",
                      "tier": "green", "path": "GET /customers" } ] }
```

**Blocks:** legible step labels (§2.3), the honest mode banner (§2.9), any "what can I ask?" affordance, and the ability to pre-warn that a write will be refused. Without it the page either hardcodes "read-only" — wrong the day the tier changes — or says nothing.

**Add one field while you are there: whether narrowing occurred, and how many capabilities survived it.** Today there is no signal in a run that the tool set was narrowed from 474 to 41 — no event, no field. That silence is the mechanism behind the worst risk in §11.1.

### 8.3 `usage` on `RunResult`, and a `session` frame — half a day each

`AnthropicModelClient.createMessage` **already computes usage** — `model-client.ts:97-100` returns `{inputTokens, outputTokens}` from `message.usage`. `MsaidiziService.run` never reads it, `RunResult` has no field for it (`:87-93`), and nothing is logged. So no run has ever reported real token counts, every cost figure in this plan and the last is an estimate, and **whether the prompt-cache breakpoint ever hits is unmeasured** — which matters directly to §4.3.

Fix: accumulate across loop iterations, including `cache_read_input_tokens` / `cache_creation_input_tokens` which the client currently discards, add `usage` to `RunResult`, log it per `sessionId`.

The `session` frame is one line: emit `{conversationId, agentSessionId}` as the first SSE event, before the loop. §11.5's mitigation, and the client needs it to attach the stream to a stored conversation.

**Blocks:** the cost decision (§10.4), the "is 60 the right budget" question (§10.3), the primer's cache argument (§4.3), and any UI that shows what a question cost.

### 8.4 Conversation persistence — the §3 build

Migration, two models, `EncryptionService` in the module providers, the five endpoints, the two write points, the opportunistic sweep, `conversationId` on `AskDto`. **M–L**, and it is a required part of the first shipping page, not a follow-up (D1).

### 8.5 `GET /msaidizi/procedures/:id/preview` — one day

Resolve the stored capability list against the manifest and return the same `preview[]` shape `compile` returns. **Blocks the procedures approval UI** (§7.2).

### 8.6 `api_request_logs` populated with `agentSessionId` — two to three days

§10.5 in full. The table already exists with exactly the right columns (`method`, `path`, `statusCode`, `userId`, `companyId`, `durationMs`, `ipAddress`) and **nothing in the codebase writes to it** — `api-request-logs.service.ts:35,41` only ever calls `findMany` and `count`. A global interceptor populating it, reusing the AsyncLocalStorage context `RequestContextMiddleware` already establishes, plus an `agentSessionId` column, gives read-level attribution for the whole application.

**Blocks:** the claim that agent activity is reviewable, and therefore §2.9's second banner line. A gate on amber (§9.4), because the first thing anyone wants after a bad write is to know what the agent looked at before making it.

---

## 9. Phasing, and the evidence each gate needs

**D3 re-orders this document.** The prior plan treated writes as a distant fifth phase gated behind a full read-only product. That was defensible when nobody had asked for writes; it is wrong now. The critical path is: **make the write path work → prove it works → build the surface → turn it on for one person → widen.**

What does **not** change is the evidence discipline. This project's history is that **positive controls find the real bugs** — the multi-turn break was found by the red-tier *positive* control, not by any of the ten hostile ones. Enthusiasm for writes does not delete the requirement to watch one complete and find the row that proves it. If anything, D3 raises the bar: an agent that can only read fails by being unhelpful; an agent that can write fails by being wrong in the ledger.

Each phase is independently revertible. The page is behind a build-time flag until Phase 1 sign-off, and the deployment stays `read-only` until Phase 3's evidence exists.

### 9.1 Phase 0 — make the write path work. No UI.

§8.1 (both `registryFor` defects), §8.3 (`usage` + `session` frame), §8.2 (capabilities endpoint), §5 (the seed narrowing).

**Gate to leave Phase 0 — one piece of evidence, and it is the one that has never existed:**

> **A red-tier action is confirmed and executes, and its audit row is found.** In a non-production deployment at `MSAIDIZI_WRITE_MODE=red`, by script: turn 1 proposes, turn 2 sends `confirmed:[id]`, the action completes, and `GET /audit-logs?channel=AGENT&agentSessionId=…` returns the row. Per `backend/test/adversarial/README.md` this has never happened in the history of the project.

Also leaving Phase 0: `first-light.mjs` re-run reporting real token counts and a cache-hit figure for the first time.

**Why this is a phase and not a checklist item:** everything downstream assumes the gate completes. Building a confirmation UI against a gate that structurally cannot succeed is how you ship a screen that looks right and does nothing.

### 9.2 Phase 1 — the page. Read-only, with history.

The `/msaidizi` route, conversation list, thread, composer, launcher (`Ctrl/⌘+J` + topbar + nav leaf), the SSE client, inline step rows, the six terminal states, the two banners, and **server-side persistence (§3) with its list / read / delete endpoints**. No procedures, no page-context chip, no Stop.

**Gate to ship to its holders — six pieces of evidence:**

1. **The stream survives the real path.** A run through Caddy → Next proxy → browser, with frames arriving incrementally rather than as one flush at the end. Never done: the proxy's pass-through branch is verified by reading, and `no-transform` surviving into Caddy's `encode` block is an inference.
2. **A slow first turn does not drop.** A question taking >60 s to the first frame, held open end-to-end. If it drops, the heartbeat lands before Phase 1 ships.
3. **The refusal path renders.** Force `reason: 'refused'` and confirm the page does not show a blank successful answer. This is the failure mode a status-code-only client has, and it is easy to ship without noticing.
4. **A hostile string reaches the screen and is escaped.** Plant `<img src=x onerror=…>` in a customer note, ask a question that reads it, confirm the model quotes it back (it will) and that the page renders it as text under the security-finding treatment.
5. **Persistence behaves under its own rules.** Three checks, all cheap: a second user with the same role and the same company **cannot** read the first user's conversation by id (§3.3 Rule 1); a conversation past `resumeExpiresAt` renders its transcript and refuses to continue with the stated message rather than a generic failure; Delete nulls `resumeState` immediately, not on the next sweep.
6. **A manager who has not seen it before uses it for a week** and can answer, unprompted: what can it see, what can it change, and where would you look to check what it did. If the answer to the third is "I don't know", §2.9 is not doing its job.

### 9.3 Phase 2 — grounding. No UI. Can run in parallel with Phase 1.

§4 in full: `DOMAIN_PRIMER`, the `DISAMBIGUATION` map, and `prompts.domain.spec.ts`.

**Gate:** the three measured cases from §4.2 are re-run and answer correctly — *"how many customers are on file"* under a credit-profile-only procedure no longer answers from the wrong table; *"how much are we owed"* does not return `Debts`; *"what did the POS sale do to our stock"* names sales orders and inventory movements. Plus: every primer claim has an assertion, and CI fails if one stops being true.

**This is an amber gate, and that is the point of putting it here.** Under read-only, a misread concept costs a wrong answer. Under amber it costs a wrong write, to the wrong table, under the user's own name. Grounding before writes is not polish; it is the cheapest available reduction in the blast radius of Phase 3.

### 9.4 Phase 3 — amber. The first time Msaidizi changes anything.

`MSAIDIZI_WRITE_MODE=amber` for one pilot company, one user — expressed as a dedicated role with one holder (§5.4 route ii).

**Gate — five pieces, and the first is the one that matters:**

1. **A positive control through the UI.** The agent completes a real amber write end-to-end from the page, and the audit row is then found by `GET /audit-logs?agentSessionId=…` with `channel=AGENT`. Phase 0 proved the mechanism headless; this proves the product. Every amber test on record so far proved *refusals* — the adversarial README records the fingerprint unchanged after every case, which is the right result for an injection test and tells you nothing about whether a legitimate write works and is attributable.
2. **§8.6 landed.** Reads attributable, so "what did it look at before it changed that" is answerable.
3. **§9.3 landed.** Grounding, per above.
4. **`@AgentExcluded()` on the POS write path.** §10.6. `POST /mobile-pos-lite/sales` and `/activate` before amber, not after — a two-line decorator change that is free while read-only.
5. **The injection suite re-run at amber over HTTP**, with `usage` reporting, so the cost of an amber run is known before it is offered to ten people. `injection-suite.mjs:19,58` already goes over HTTP to `/msaidizi/ask`; extend it to `/ask/stream`, which has never been adversarially exercised.

Plus two UI gates: amber steps render with the amber verb and dot, and a completed amber run shows a **"what changed"** summary distinct from "what it looked at" — a manager must tell the two apart at a glance. And the `AbortController` (§2.7), because an uncancellable run that writes is a different thing from an uncancellable run that reads.

### 9.5 Phase 4 — red. The confirmation gate in the product.

**Gate — three, all hard:**

1. **The Phase 0 positive control re-proved through the UI**: a red action proposed in the thread, approved by checkbox, executed, and the audit row found by a human clicking through from the conversation.
2. **Procedure `sessionId` threading fixed** (§7.1), or red procedures explicitly blocked at creation.
3. **The gate screen reviewed with a real manager against a real proposed action**, and they can say what will happen without being told. If they cannot, §6.3's missing pre-image is the reason — and the curated `RED_PREIMAGE` map is the answer before red widens, not after.

Red goes to one user in one company for a month before anyone else, and every confirmed action gets read back afterwards from the audit trail by a second person. That is an operating discipline, not a UI feature, and it belongs in the rollout note. There is no schedule pressure here that beats being wrong once.

### 9.6 Phase 5 — procedures, and the page-context chip. Parallel, unblocked after Phase 1.

Needs §8.5. Author / approve / run, plus the chip from §1.4.

**Gate:** a procedure authored by one person, approved by another, run by a third, with the self-approval 403 hit deliberately and confirmed to render as a designed state. Plus the adversarial suite's **procedure-injection shape re-run against the UI** — first light proved the model reports a hostile procedure; this must prove the *approver* sees the payload, in full, before approving.

---

## 10. The open decisions

Two of these are genuinely still the owner's call. The rest the codebase answers, and they are recorded as settled so they stop being re-litigated. D1–D4 have removed four that used to be here.

### 10.1 Language — **OWNER'S CALL** on input; output is settled

**Recommendation: ship Swahili *output* now. Do not market Swahili *input* until the pre-filter lands.**

Swahili input is not a degradation today, it is a **hard failure**. `domain-filter.ts` narrows by English lexical overlap against route paths, handler names and permission codes; its `STOP_WORDS` list is English (`:20-`). Measured over the real 540-capability green set:

| Question | Matched | Tool set the model receives |
|---|---|---|
| "show me the outstanding customer invoices for this month" | 41 | 41 relevant |
| "nionyeshe ankara za wateja ambazo hazijalipwa mwezi huu" | **0** | 20 fallback |
| "which suppliers have unpaid purchase orders" | 48 | 48 relevant |
| "ni wasambazaji gani wana oda za manunuzi ambazo hazijalipwa" | **0** | 20 fallback |

Every Swahili question scores zero and falls through to the depth-then-alphabetical fallback, which returns **the identical wrong 20 tools every time**. And saved procedures do not degrade, they **throw**: `selectForInstruction` has no `floor`, so a Swahili instruction 400s with a message blaming the author's permissions.

**Cheap and correct now:** read `user_preferences.locale` in `MsaidiziController` and vary the prompt tail. The field already exists, defaults to `'en'`, and the settings page already offers Kiswahili (`settings/preferences/page.tsx:38`) — **nothing reads it anywhere in the repo.** Half a day, and it turns a dead preference into a live one.

**The real fix,** which the code itself points at (`domain-filter.ts:13-14` — *"The plan's Haiku pre-filter is the natural next step… this is the layer it would sit in front of"*): route the request through `MSAIDIZI_CLASSIFIER_MODEL` (already configured, `claude-haiku-4-5`) to emit English domain keywords, then narrow on those. Language-agnostic, roughly a cent per hundred runs, and it fixes procedures and chat together. Give `selectForInstruction` a floor so compile degrades instead of throwing. **§4.6 changes the economics of this**: the primer's concept-ownership table is the classifier's reference vocabulary, so building the primer first makes the pre-filter cheaper and better.

**Owner's call:** whether Swahili *input* is a product commitment at all. Under D4 the initial holder is the admin account, which narrows the question considerably in the short term. **What would change my mind:** a manager typing a Swahili question and getting a wrong answer instead of an obvious failure — because the fallback returns *plausible* tools, not an error.

### 10.2 API key custody — **SETTLED. Not the owner's call except for the trigger.**

**The `api-keys` module cannot hold it, structurally.** `api-keys.service.ts:80` stores `keyHash = hashApiKey(rawKey, APP_ENCRYPTION_KEY)` and `common/utils/api-key-hash.ts` is a bare HMAC-SHA256 — **one-way**. That module mints and verifies *inbound* credentials; plaintext is shown once and never recoverable. `security-policies` is worse — CRUD over a `settings` JSON blob with no encryption at all.

**The right precedent exists, and §3 now uses it too.** `integration-connections.service.ts:560` encrypts outbound provider credentials with `EncryptionService` (AES-256-GCM, versioned, scrypt off `APP_ENCRYPTION_KEY`), and `IntegrationConnection` is company-scoped with `credentialsEncrypted Json?`. If Msaidizi ever needs per-tenant keys, that is the shape.

**Do nothing now.** One deployment, one Anthropic account, one owner paying one bill. And the premise that this is the only non-tenant-scoped credential is slightly off — `SMTP_PASS` is read straight from env by `common/services/email.service.ts:29` and shared by every company in the group. There is precedent and it has been fine.

Note that `ANTHROPIC_API_KEY` is deliberately absent from `backend/src/config/env.validation.ts`: it fails loudly at first use in `model-client.ts:66-69` rather than blocking boot. That is correct and should stay. `APP_ENCRYPTION_KEY`, by contrast, **is** enforced in production and staging (`env.validation.ts:158-172`), which is what makes §3's encryption free of new ops requirements.

**Owner's call — the trigger only.** "Before multi-tenant hosting" is not a date. Name the event — *the first company outside Itemba Group* — and this becomes schedulable instead of perpetually open.

### 10.3 Tool search — **SETTLED: do not enable. Not the owner's call.**

The budget is exceeded roughly 8×, and has been from day one. Against the real seed filters:

| Role | Permission codes | Permitted capabilities | green | amber | red |
|---|---|---|---|---|---|
| COMPANY_MANAGER | 758 | 1,001 | **474** | 309 | 218 |
| GROUP_DIRECTOR | 423 | 599 | **471** | 83 | 45 |
| GROUP_SUPER_ADMIN | 791 | 1,056 | 499 | 328 | 229 |

*(These figures predate §5. After the seed narrowing, only the last row is reachable by anyone until a grant is made — which does not change the conclusion, since GROUP_SUPER_ADMIN is the largest of the three.)*

Nothing breaks, because narrowing is already load-bearing: `registryFor` runs it whenever `permitted.length > 60`, which is always. English questions land at 41–48 tools — inside budget and genuinely relevant. **The deterministic lexical filter is already doing the job tool search was proposed for, and it is cheaper, testable and reproducible.**

Enabling tool search needs three unwired things — `{defer: true}` passed to `buildRegistry` (`tool-registry.ts:78-82`, no caller sets it), a `tool_search_tool_*` declared in `ModelClient.createMessage` (which today passes only `request.tools`), and at least one non-deferred tool or the API rejects the request — and it adds a beta server tool plus a second failure mode.

**What actually breaks is the tail, not the volume**: the filter fails silently when the user's vocabulary misses the route vocabulary. Swahili (§10.1), and English phrasings that miss. **Fix the pre-filter instead.**

**Note the distinction §4.3 draws and this section does not dispose of:** *mid-conversation tool changes* are a different mechanism from tool search — control rather than discovery — and would make the domain primer genuinely cacheable across turns. Settling against tool search does not settle against that. Verify it against current API documentation before building on it.

**What would change my mind on tool search:** a single role's genuinely *relevant* set for one question exceeding 60. I could not construct such a question.

### 10.4 Cost control — **OWNER'S CALL on the number, after §8.3**

90% of the work is already done and thrown away (§8.3). Nothing in the codebase meters anything comparable: `ThrottlerModule` is request-count throttling (100 req / 60 s, not per-user, not cost-aware); `ApiClient.rateLimitPerMinute`/`rateLimitPerDay` exist in the schema and are **enforced nowhere**; `observability-budget.service.ts` is latency, not spend.

Order:

1. **Surface `usage` and log it per `sessionId`.** Half a day. Before anything else.
2. **Then decide budgets, with data.** A small `msaidizi_usage` table keyed by `(userId, companyId, day)`, and a per-company monthly ceiling checked in `MsaidiziController` before `service.run()` — about a day once usage exists.
3. Note the existing per-run ceilings bound a runaway *loop*, not a runaway *month*.

**D4 buys time here.** With one holder, the volume risk is bounded by one person's curiosity, and the ceiling can be decided from real data before the second grant rather than guessed before the first. That is a genuine benefit of admin-only-by-default that is worth stating: it makes §11.8 a Phase 3 problem instead of a Phase 1 problem.

**Owner's call:** the ceiling. A tolerable monthly agent bill for a Tanzanian SME group is a business number, not a technical one. **Ask after step 1**, when a real cost per question can be quoted.

### 10.5 Audit attribution — **SETTLED: close it. Not the owner's call. Gates amber.**

**The plumbing is genuinely good.** `RequestContextMiddleware` runs on `'*'` before the guards, validates `x-msaidizi-session` against `^[A-Za-z0-9_-]{8,128}$`, and puts `{channel: AGENT, agentSessionId}` into AsyncLocalStorage. `AuditLogsService.log` picks both up ambiently (`:216`), so ~160 services attribute agent actions correctly without knowing Msaidizi exists. It warns when an AGENT row arrives without a session id (`:222-225`). The filter is on an indexed column. Nothing here needs changing.

**The coverage is the problem, and it is worse than "only Group Control."** `SensitiveAccessInterceptor` is applied to exactly five controllers — bank-accounts, contracts, debts, fixed-assets, loans. Against each role's permitted green set:

| Role | green reads | that leave an audit row |
|---|---|---|
| **COMPANY_MANAGER** | 474 | **0** |
| GROUP_DIRECTOR | 471 | 23 |

COMPANY_MANAGER is zero **by construction**: the interceptor keys off Group Control modules, and `notGroupCtrl` is precisely what excludes those from the role.

So "every agent action is reviewable" is true of **writes** and false of **reads**, which is 100% of what production does today. A manager asking *"what did Msaidizi look at on my behalf?"* gets an empty result set, indistinguishable from "it did nothing."

**Do not extend `SensitiveAccessInterceptor` to 474 endpoints** — that writes a high-severity audit row per read and drowns the trail managers actually use for writes. **Populate `api_request_logs` instead** (§8.6): separate stream, lower severity, the table is designed for it, the request-context wiring is done, and it gives read attribution for the whole application rather than just Msaidizi.

Until then, the UI says plainly that reads are not logged (§2.9). One minor real finding while measuring: the interceptor's `GROUP_CONTROL_MODULES` includes `'company-profiles'`, which `database/seeds/seed.ts:164` does not mark `isGroupControl` and which no controller applies the interceptor to. Dead entry.

**§3 does not close this gap and must not be presented as closing it.** A stored conversation shows what the agent *said* it read; `api_request_logs` shows what it actually requested. Those are different evidentiary objects, and confusing them is how an oversight story quietly becomes a self-report.

### 10.6 The POS boundary — **partly settled; one OWNER'S CALL**

**The boundary you think you have does not exist.** COMPANY_MANAGER holds `mobile_pos_lite.use`, `.purchase` and `.stock_count` (`seed.ts:1558-1560`), which put **ten green mobile-pos-lite capabilities in the tool registry in production** — sales, stock, products, customers, session, suppliers, purchases, my-sales-today, day-report PDF, sale receipt — plus `GET /sales-orders/mobile-pos/bootstrap` and `GET /westsides/reports/sales-by-cashier`. "Kept out of scope" is true of the *product surface* and not of the *envelope*.

*(D4 changes who holds this, not what it is: after §5, the envelope in question is GROUP_SUPER_ADMIN's, which is wider still.)*

Three framings resolve cleanly. *POS phones get stolen* — irrelevant; a stolen phone holds a cashier's token and cashiers do not hold `msaidizi.use`. *The POS is Swahili-first and single-purpose* — a strong argument against an agent **inside** Kaunta. *Cashiers do not hold `msaidizi.use`* — already true and the seed keeps it that way. None argue against a manager asking *"how much did Kaunta take today?"* from the back office, which is a POS **read** by an office role and the single most obviously useful thing a Tanzanian SME manager would ask an assistant.

1. **Keep the agent out of the POS app. Settled.** §1.3 enforces it structurally via the `mobilePosStandalone` branch.
2. **Keep POS reads available to office roles. Settled.** They already are, and removing them makes the agent worse at the one question managers most want answered.
3. **`@AgentExcluded()` the POS write path before amber.** `POST /mobile-pos-lite/sales` and `/activate` — an agent that can ring up a sale or activate a terminal can move business-day state and till custody, invariants the POS reform records as hard-won and which the agent has no way to reason about. `POST /mobile-pos-lite/purchases` is already red. Two lines, free while read-only, and a Phase 3 gate.

**Owner's call:** whether Msaidizi may ever *write* to Kaunta. **Recommendation: no, permanently** — but that is a judgement about who owns the till, not a technical constraint. D3 makes this question live rather than theoretical, so it wants answering before Phase 3 rather than during it.

---

## 11. Risks — and what would make this a bad idea to continue

The prior plan's §7 risk table stands for the backend. These are the risks the *frontend*, *persistence* and *writes* create or expose, in the order I would worry about them.

### 11.1 Impressive in a demo, untrustworthy in a month — **the one that would kill it**

The mechanism is specific and already in production: **silent narrowing.** A broadly-granted user's several hundred permitted reads get cut to 41 by a lexical scorer, and there is **no signal in the response that it happened** — no event, no field, nothing a UI can render. When the vocabulary misses, the agent does not error; it answers thinner, from the wrong toolbox, plausibly.

That is the exact failure this system is otherwise engineered against. A manager cannot learn to trust a tool whose confidence is uncorrelated with its coverage; they learn to distrust it, quietly, and stop using it without filing a complaint you could act on.

**§4 helps and does not fix it.** Domain grounding fixes *interpretation* — the right tool present but misread. It does nothing for *selection*, because the filter never reads the system prompt (§4.6). Shipping the primer and calling this risk mitigated is the specific mistake to avoid.

**Mitigations:** (a) surface the narrowed count in the thread — *"looked at 41 of the tools you can reach"* — which needs §8.2; (b) the Haiku pre-filter fed by the primer's concept index (§4.6, §10.1); (c) an explicit "I don't have a tool for that" path, which the model cannot currently take because it does not know a tool was withheld.

**This is the risk that would make me stop.** If Phase 1 ships and managers report answers that are confidently incomplete, the pre-filter is not an improvement to schedule later — it is the condition of continuing.

### 11.2 A wrong write, chosen from a misread concept

New with D3, and the reason §9.3 gates §9.4. Case A (§4.2) under read-only produces a wrong sentence. The same misreading under amber produces a wrong row: a credit limit set on an orphan table nothing enforces, a "debt" recorded for money the company is owed. It is attributable to the user, it is in the ledger, and the agent will report it as done.

**Mitigations:** grounding before amber; the amber prompt clause's existing *"Make the change you were asked for and stop"*; `writeCallCount` visible in the thread; and the operating discipline of reading writes back from the audit trail during the pilot. **What would make this unmanageable:** amber widening past one user before §8.6 lands, because then "what did it look at before it did that" has no answer.

### 11.3 A manager approves a red action they did not really understand

The gate shows a machine-written sentence, an args table, and the model's own account. It does **not** show the record's current state, the monetary impact, or a diff (§6.3). A manager under time pressure, four screens deep, clicking approve on *"delete (DELETE /invoices/:id) … with id=\"41\""* has technically consented and has not necessarily understood.

A UI cannot fully fix this. What it can do: lead with the model's prose, require a per-item checkbox with no select-all, link to the actual record, state irreversibility in the affirmative, and keep the steps that led to the proposal visible above it in the thread. What actually mitigates it: **red stays off longer than anyone wants**, goes to one user in one company for a month, and every confirmed action gets read back afterwards from the audit trail by a second person.

### 11.4 Business data at rest, now deliberately

§3 puts customer records in a database column on purpose. That is a smaller risk than `localStorage` on a shared machine and it is not zero. The controls are: AES-256-GCM via the existing `EncryptionService`, author-only reads, a 24h clock on the only column holding retrieved records, and a real destructive null rather than a soft-delete stamp.

**The residual risks, named:** an `APP_ENCRYPTION_KEY` compromise reads every unexpired resume state; a bug in the read filter (§3.3 Rule 1) is a cross-user data leak rather than a UI glitch, so it deserves a test rather than a code review; and the opportunistic sweep only runs when someone uses the agent, so a deployment nobody talks to for a week keeps its resume states for a week. That last one is acceptable — the alternative is a scheduler this codebase does not have — but it should be written into the sweep's comment so the next person does not discover it as a surprise.

**The risk that gets added later by someone who has not read this:** a "share this conversation" button, or an admin conversation viewer. §3.3 Rule 2 explains why the second cannot be made correct. Both are in §13.

### 11.5 A dropped stream loses a run that is still executing

No heartbeat, no event ids, nothing to resume from. Under amber this is materially worse than under read-only: the connection drops, the page shows nothing, and **the writes complete anyway.**

**§3 downgrades this from a data-loss risk to a liveness risk.** The conversation row and its `agentSessionId` are written *before* the loop (§3.5), and the `session` frame (§8.3) hands them to the client on the first byte. So a dropped run is traceable and reappears in the conversation list when the turn's post-run write lands. What is still lost is the live view. Worth doing before amber; no longer the sharp edge it was.

### 11.6 Thinking blocks are stripped from `messages`

`AnthropicModelClient` filters `message.content` to `text | tool_use` only (`model-client.ts:94-96`) and the loop pushes that filtered array as the assistant turn. With `MSAIDIZI_MODEL=claude-opus-5`, adaptive thinking is on by default when no `thinking` parameter is sent, and the current request omits it. Guidance is that thinking blocks should be echoed back unchanged on the same model; stripping them can produce ordering or signature errors on later turns.

Multi-turn works today, so this is latent rather than observed — but it sits **exactly on the path the client is contractually told to echo verbatim**, and it surfaces as `reason: 'failed'` with a generic message, indistinguishable from an outage.

**Two reasons this is now more urgent than it was.** First, the confirmation resume is a multi-turn flow with a destructive action at the end of it, and D3 puts that on the critical path. Second, §3.1 records the coupling: **fixing this makes redaction of stored assistant turns permanently impossible**, because a signature covers content you would be altering. **Decide §11.6 before finalising §3's storage shape.** They are not independent.

### 11.7 The agent's own tool calls share one throttle bucket

`CapabilityInvoker` reaches the API over HTTP from `127.0.0.1` and the stock `ThrottlerGuard` tracks by IP, at 100 requests / 60 s (`app.module.ts:223-228`, unset in production compose). **Every user's every tool call shares one loopback bucket.** Under concurrency this produces spurious `tool_result{status:429}` with *"Rate limited. Stop making requests and report this."* A UI must treat a 429 inside a tool_result as an infrastructure condition, not a user-facing quota — and this gets worse with every additional concurrent user. D4 delays the problem; it does not remove it.

### 11.8 Cost that scales with curiosity rather than value

Per-run ceilings bound a loop, not a month. A page removes the only thing currently limiting volume, which is that using the agent requires a script and a bearer token. Ten managers × fifty questions a day is not a runaway; it is normal adoption, and nothing measures or bounds it (§10.4).

**This sits last rather than second, and D4 is the only reason.** With `msaidizi.use` on one role with one holder (§5), volume is bounded by one person's curiosity, and `usage` (§8.3) will have produced a real cost-per-question before the second grant is made. **The mitigation is therefore ordering, not a feature: `usage` before the page, a real number before the second holder, a ceiling before the fleet.** If D4 is relaxed early — if `msaidizi.use` goes back to COMPANY_MANAGER before §8.3 has produced data — this risk moves straight back to second place and the ceiling (item 31) stops being optional.

---

## 12. Build-size ledger and sequencing

| # | Item | Where | Size | Blocks |
|---|---|---|---|---|
| **Phase 0 — make the write path work** | | | | |
| 1 | **Defect A: union the narrowed set with the prior turn's `tool_use` names when `confirmed` is non-empty** | `msaidizi.service.ts:271-297` | **XS** | **everything about writes** |
| 2 | Guard `registryFor` against structured-only content (defect B) | `msaidizi.service.ts:283` | **XS** | nothing (latent) |
| 3 | `usage` on `RunResult`, logged per session | `msaidizi.service.ts`, `model-client.ts` | **S** (½ day) | §10.4, cost UI, §4.3 |
| 4 | `session` frame emitted first | `msaidizi.controller.ts` | **XS** | §11.5, §3 client wiring |
| 5 | `GET /msaidizi/capabilities` (+ narrowing signal) | new handler in `msaidizi.controller.ts` | **S–M** | step labels, mode banner, §11.1 |
| 6 | **Seed narrowing: `msaidizi.*` to `GROUP_SUPER_ADMIN` only** | `database/seeds/seed.ts:1345,1532-1533` | **XS** (deploy-shaped) | D4 |
| **Phase 1 — the page** | | | | |
| 7 | Persistence: migration + 2 models + `EncryptionService` wiring | `database/prisma/`, `msaidizi.module.ts` | **M** | history, resume, §11.5 |
| 8 | Persistence: 5 endpoints, 2 write points, opportunistic sweep, `conversationId` on `AskDto` | `msaidizi.controller.ts`, new `conversations.service.ts` | **M–L** | the conversation list |
| 9 | `MsaidiziLauncher` + `Ctrl/⌘+J` + nav leaf | `(dashboard)/layout.tsx`, `layout/topbar.tsx`, `layout/sidebar.tsx` | **S** | |
| 10 | SSE client: fetch + `getReader()` + frame parser | new `lib/msaidizi-stream.ts` | **M** | first of its kind in this repo |
| 11 | The page: conversation list + thread + composer + inline steps + six terminal states | new `features/msaidizi/*`, `app/(dashboard)/msaidizi/` | **L** | the heart |
| 12 | Safe renderer (escaped text, sanitised MD, security-finding block) | `features/msaidizi/` | **S–M** | |
| 13 | Assistant icon in `icon-set.tsx` (none exists; nearest is `automation: Zap`) | `components/ui/icon-set.tsx` | **XS** | |
| 14 | `agentSessionId` filter on the audit-logs page | `app/(dashboard)/audit-logs/page.tsx` | **S** | "review this run" |
| **Phase 2 — grounding (parallel)** | | | | |
| 15 | `DOMAIN_PRIMER` in the cached stable prefix | `prompts.ts` | **S–M** | §4, amber gate |
| 16 | `DISAMBIGUATION` map appended by `buildToolDefinition` | `tool-registry.ts` | **S** | Case A |
| 17 | `prompts.domain.spec.ts` drift guard | new spec | **S** | keeps 15/16 true |
| **Phase 3 — amber** | | | | |
| 18 | `@AgentExcluded()` on POS writes | `mobile-pos-lite.controller.ts` | **XS** | amber gate |
| 19 | `api_request_logs` global interceptor + `agentSessionId` column | `common/interceptors/`, migration | **M** | amber gate, §10.5 |
| 20 | `AbortController` threaded through `run()` + honest Stop | `msaidizi.service.ts`, `features/msaidizi/` | **S–M** | §2.7 |
| 21 | Amber run treatment: "what changed" vs "what it looked at" | `features/msaidizi/` | **S** | |
| **Phase 4 — red** | | | | |
| 22 | The confirmation gate UI (inline checklist) | `features/msaidizi/` | **M** | |
| 23 | Thread `sessionId` through `POST /procedures/:id/run` | `procedures.controller.ts:110-134` | **S** | red procedures |
| 24 | Curated `RED_PREIMAGE` map (12–20 entries, CI-asserted) | `tool-registry.ts` or sibling | **S–M** | §6.3, §11.3 |
| **Phase 5 — procedures, chip** | | | | |
| 25 | `GET /msaidizi/procedures/:id/preview` | `procedures.controller.ts` | **S** | approval UI |
| 26 | Procedures: list / author / compile-preview | `app/(dashboard)/msaidizi/procedures/` | **M** | |
| 27 | Procedures: approval screen (maker-checker, verbatim instruction) | same | **M** | |
| 28 | Page-context chip | `features/msaidizi/` | **S** | |
| **Cross-cutting** | | | | |
| 29 | Read `user_preferences.locale` → prompt tail | `msaidizi.controller.ts`, `prompts.ts` | **S** | §10.1 output |
| 30 | Haiku pre-filter fed by the primer's concept index + `floor` on `selectForInstruction` | `domain-filter.ts`, `procedures.service.ts:292` | **M** | §10.1 input, §11.1 |
| 31 | Per-company monthly spend ceiling | new `msaidizi_usage` + controller check | **M** | after §10.4 owner call |
| 32 | Resolve §11.6 (thinking blocks) — **before finalising item 7's shape** | `model-client.ts` | **S–M** | §3.1, red multi-turn |

**Totals:** Phase 0 **S** and mostly one-line — which is the point; Phase 1 **L–XL** (the structural heart, as Phase 2 was for the POS, and larger than the prior plan's F1 because persistence is in it); Phase 2 **M**; Phase 3 **M**; Phase 4 **M**; Phase 5 **M–L**.

Item 30 is the highest value-per-point item on the list after Phase 0 and should be scheduled the moment §11.1 shows up in real use. Item 32 is the smallest item with the largest ordering constraint: it must be decided before item 7 hardens.

Nothing here blocks normal ERP work. The page is behind a build-time flag until Phase 1 sign-off, and the deployment stays read-only until Phase 3's evidence exists.

---

## 13. Explicitly rejected

- **A docked panel as the primary surface.** D1. A chat is a place you return to; that needs a URL and a conversation list, not an overlay (§1.1). A compact overlay thread becomes cheap *later*, and only because §3 made conversations server-side.
- **"A work log, not a chat."** The framing is gone. It is a chat. What the framing was protecting survives as a rendering decision: no fake typewriter, because turns arrive whole (§2.2).
- **A launcher that hosts its own thread.** Two renderers, two scroll states, and a stream handover across a route change, to save one navigation (§1.2).
- **A "Stop" button that does not stop.** Absent until `run()` takes an `AbortSignal` — which is now a Phase 3 item, not an open question (§2.7).
- **`ConfirmDialog` for the red-tier gate.** One message, no return value, one call — wrong on all three counts (§6.4).
- **Per-screen assistant buttons.** They imply a scope the backend does not have (§1.1).
- **Silent page-context injection.** Page context is a retrieval input that changes the tool set; if it is invisible, bad runs stop being reproducible (§1.4).
- **Persisting `messages` (or any transcript) to `localStorage`.** It contains fenced business data. This rejection survives D1 unchanged; the feature moved to the server, the storage location did not become acceptable (§3, §11.4).
- **Admin or peer read of another user's conversation.** Not deferred — not expressible. The transcript stores prose, not record identities, so there is nothing to re-check against the reader's permissions (§3.3 Rule 2). If overruled, it must be loud: a distinct disclose action, a `CRITICAL` audit row written before content is returned, and the author told (§3.3 Rule 4).
- **Persisting `confirmed[]`.** It would convert a one-shot approval into a standing grant (§3.3).
- **Reconstructing `messages` from `events`, or storing them with elided bodies.** Both produce a model answering confidently from placeholders (§3.1).
- **Retrieval over `docs/` for domain grounding.** The corpus is measurably false — eleven modules that do not exist, a Product Variants feature with no model (§4.3b).
- **Any runtime access to the repository, in any form.** Owner decision, 2026-08-18: *"not codebase; simply what the business is working on, no access to the codebase at all."* This is a standing boundary, not a deferral. The agent's entire world is the ERP's HTTP capabilities under the caller's own token: there is no filesystem tool, no source reader, no docs retriever, and none may be added. The distinction that keeps §4 legitimate is **who reads the source** — a human distils code comments into the primer at authoring time; the agent never reads a file at runtime. Anything that would give it one is out of scope permanently, however convenient it looks in the moment. This is the kind of property that erodes by accident, so it belongs here rather than in a commit message.
- **A glossary tool the model calls when confused.** The model must know it is confused to use it; in the reported failure it was not (§4.3d).
- **Rendering `result.events` alongside the streamed frames.** `result.events` contains every event already streamed; doing both double-renders the run.
- **Reusing `/approvals` for confirmations.** Approvals live at a URL with a permission-gated nav entry and a pending list; a confirmation is ephemeral and lives inside a run.
- **Generic pre-image fetching for confirmations.** No capability→read-endpoint mapping exists; a wrong "before" view is worse than none. A *curated* map of 12–20 red capabilities is a different proposal and is item 24 (§6.3).
- **Extending `SensitiveAccessInterceptor` to all reads.** Drowns the write trail managers actually use (§10.5).
- **Tool search (`defer_loading`) for discovery.** The deterministic filter already does the job; fix the pre-filter instead (§10.3). This does **not** reject mid-conversation tool changes as a *cache* mechanism, which is a separate, unverified lever (§4.3).
- **An "Undo" button.** Recorded as deliberately not built: reversing a create is a delete (red), and an undo that usually works is worse than none.
- **Msaidizi inside Kaunta.** Permanently (§10.6).
- **Re-compiling a stored instruction to populate the approval screen.** The approver would review something other than what was saved (§7.2).
- **Granting `msaidizi.use` broadly "to see who uses it".** D4. The grant is per-role and the agent's blast radius for a new holder is everything that holder can already do (§5.4).

---

## 14. What is still unproven

Everything in this section is something someone could reasonably assume is true and which nobody has checked. Carried forward and updated.

- **No confirmed red action has ever executed.** `backend/test/adversarial/README.md`: *"The delete was proposed, never executed."* §6.1 is why, and it was found by measurement rather than by testing, which means the gate has never been exercised past its first half. **This is now Phase 0's gate and the single most important thing on the list.**
- **No agent write of any kind has ever succeeded and been traced.** Every amber and red result on record is a *refusal*. The positive control is §9.4 gate 1.
- **`POST /msaidizi/ask/stream` has never been consumed by a browser.** First light consumed it from Node. The proxy pass-through, Caddy's `no-transform` behaviour, and `CsrfFetchProvider` leaving `response.body` intact are all verified by reading the code, not by watching frames arrive in Chrome.
- **Nothing has ever been persisted.** §3 is a design, not a running system. The specific untested claims are: that a `messages` array round-trips through `EncryptionService` and `JSON.parse` and is still accepted by the API; that 1 MB is the right cap; and that the opportunistic sweep keeps up with real traffic.
- **The domain primer's effect is predicted, not measured.** §4.2's three cases were reproduced against the real scorer and the real manifest. That the primer *fixes* them is an expectation. §9.3's gate exists to turn it into a measurement, and if it does not move those three cases, the recommendation in §4.4 is wrong and (c1) generation deserves the budget instead.
- **Read attribution is zero for COMPANY_MANAGER**, by construction, not by accident (§10.5).
- **Token cost and prompt-cache hit rate are unmeasured.** Every cost figure anywhere in this plan or the last one is an estimate (§8.3). This includes §4.3's claim that a primer costs ~$0.006 per user turn.
- **Concurrency under a UI.** First light ran three concurrent runs and they stayed separate with distinct sessionIds. Nobody has run ten, and the loopback throttle bucket (§11.7) is shared.
- **Injection against a saved-procedure run through the UI.** First light proved the model reports a hostile procedure. It did not prove an approver would have seen the payload before approving it, because there was no approval screen.
- **Thinking-block round-tripping** (§11.6). Works today; the mechanism suggests it should not always, and §3's storage shape depends on the answer.
- **Whether narrowing a seeded permission behaves as described in a live deployment.** The mechanism is verified in code — full replace at `seed.ts:2355-2360`, 60-second permission cache at `jwt.strategy.ts:18`. Nobody has run it and watched a role lose a permission.
- **Whether a manager can actually read a conversation with steps in it.** Everything in §2 is a design argument. The only test is §9.2 gate 6.
