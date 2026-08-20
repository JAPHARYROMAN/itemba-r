# Msaidizi — tool search

**Problem:** the agent sees 60 of 1,223 capabilities per turn, picked by lexical
word-matching against the user's message. **Grants no new authority** — it makes the
agent better, not freer, which is why it belongs before amber writes.

---

## 1. Why the current narrowing fails

`registryFor()` (msaidizi.service.ts:989) builds the permitted set, and because that
always exceeds `TOOL_BUDGET = 60`, `narrowCapabilities()` always runs. It scores each
capability by token overlap with the message. Three failure modes, two already
observed in production:

- **Wrong set, confidently.** At first light a saved procedure was given
  `CustomerCreditProfiles_*` but not `Customers_findAll`, so the agent answered
  "0 customers" from an empty credit-profile table. Honest, and wrong.
- **Follow-up turns have nothing to match.** A bare "yes" on a confirmation turn
  carries no domain words. The code comments already note this.
- **Vocabulary mismatch.** "who owes us money" shares no tokens with `receivables`.
  Lexical overlap cannot bridge a synonym.

## 2. The second payoff: caching is currently dead

The API renders `tools` → `system` → `messages`, and the cache breakpoint sits on the
system block (`prompts.ts:245`). Because the tool list is narrowed per request, the
bytes before that breakpoint differ on every call, so **the cache never hits**. Every
turn pays full input price for the system prompt and every resident schema.

A stable tool block fixes that as a side effect. This is why the design below fixes
the resident set per *user* rather than per *request*.

---

## 3. Design

**Declare a BM25 search tool, defer the rest, keep a small stable resident set.**

```
tools = [
  { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },  // resident
  ...ENTRY_POINTS,          // ~15 stable, permission-filtered, NOT deferred
  ...everythingElse,        // defer_loading: true
]
```

- **BM25 over regex.** Regex matches name patterns; BM25 ranks natural language, which
  is what a user types. "who owes us money" should reach `receivables`.
- **At least one tool must stay non-deferred** or the API returns
  `All tools have defer_loading set`. The search tool satisfies that, but entry points
  earn their place separately.
- **Entry points are chosen once, not per request** — the shallow list endpoints
  (customers, suppliers, invoices, products, expenses…). This gives a fast path with
  no search round-trip for the common ask, *and* keeps the tool block byte-stable for a
  given user so the cache finally works. A per-request resident set would re-break it.
- **The envelope is unchanged.** Deferred tools are still built by `buildRegistry`,
  so they are already filtered by permission ∩ write-mode before they are declared.
  Search can only surface what the caller could already have been offered. This must
  be tested explicitly, not assumed.

## 4. Descriptions become load-bearing

BM25 ranks the text we give it, and today `describeAction()` uses the Swagger summary
where one exists — **14 controllers out of 196** — and otherwise splits the handler
name. `findAll` on `customers` yields "find all", which indexes almost nothing.

This is the difference between search that works and search that looks like it works,
so it is part of the job rather than a follow-up:

1. Generate a richer default: verb + resource + the module's permission code, so
   `customers.view` contributes the word "customers".
2. Add `@ApiOperation({ summary })` to the highest-traffic controllers by hand —
   customers, suppliers, invoices, expenses, receivables, payables, products, stock.
3. Add domain synonyms to the description text where the vocabulary genuinely differs
   from the schema: receivables ↔ "owes us, debtors, outstanding"; payables ↔ "we owe,
   creditors". Swahili terms too, since the UI is bilingual — this is where a lexical
   index earns its keep or fails.

## 5. Work

| # | Change | Where |
|---|---|---|
| 1 | `SEARCH_ENABLED` config flag, default off | `msaidizi.config.ts` |
| 2 | Entry-point set + `defer` on the remainder | `tool-registry.ts` |
| 3 | Declare the BM25 tool; bypass narrowing when search is on | `msaidizi.service.ts` |
| 4 | Handle `tool_search_tool_result` blocks in the loop | `msaidizi.service.ts` |
| 5 | Richer descriptions + `@ApiOperation` on hot controllers | `tool-registry.ts`, controllers |
| 6 | Specs: envelope holds under deferral; tool block is byte-stable per user | `msaidizi.isolation.spec.ts` |

Behind a flag so it ships dark and can be compared against narrowing on the same
questions.

## 6. Verification

Unit-testable without a key: deferral marking, entry-point stability, and — the one
that matters — **that an unpermitted capability is still absent from the declared set
when deferred**. Deferral must not become a back door around the envelope.

Needs the live API: whether BM25 actually finds the right tool. Build a fixed question
set with known-correct answers ("who owes us money" → receivables; "what did we buy
from X" → purchases) and run it against both paths. Narrowing is the baseline to beat.

Measure `usage.cache_read_input_tokens` before and after. It should be ~0 now; if it
is still ~0 after, the tool block is not as stable as intended.

## 7. Risks

- **Search returns nothing useful** and the agent stalls with no tools. Mitigation: the
  entry-point set is always resident, so there is a floor.
- **Payload size.** 1,223 declared tools is a large request body even with schemas
  deferred. Unmeasured — measure before assuming it is fine.
- **A wider reach is a wider blast radius** once writes are on. This lands while
  read-only precisely so the reach can be judged before the authority grows.
