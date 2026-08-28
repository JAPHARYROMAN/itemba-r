# Benchmarks — measured, not argued

Not part of `npm test`. These call the live Anthropic API: they cost money, they
are non-deterministic, and none of that belongs in a gate that runs on every
commit. Run them when a decision needs a number instead of an argument.

## tool-search-compare.mjs

Answers one question: **does tool search actually find the right tool?**

Seven questions, each with an expected tool. Two are controls with direct
vocabulary matches — if those regress, search is worse rather than differently
wrong. The rest are cases lexical overlap structurally cannot solve, because the
user's words share no token with the schema: "who owes us money" against
`receivables`, "what do we owe our suppliers" against `payables`.

Expectations resolve against the live capability list rather than hardcoded
names. A stale name would otherwise make every case look like a search failure
when it is really a broken test, and that mistake is invisible in the output.

The spending case is also a path-quality gate: `Expenses_findAll` must be the
first dispatched tool and the run may dispatch at most two tools. The original
search run eventually found expenses but used eight tools across four turns;
"eventually correct" is not enough for this common question.

```bash
docker compose up -d postgres redis
# MSAIDIZI_TOOL_SEARCH=false, restart backend
node backend/test/benchmarks/tool-search-compare.mjs baseline.json
# MSAIDIZI_TOOL_SEARCH=true, restart backend
node backend/test/benchmarks/tool-search-compare.mjs search.json
node backend/test/benchmarks/tool-search-compare.mjs --diff baseline.json search.json
```

Run mode exits non-zero unless all seven cases pass. For the spending case,
"pass" also means `Expenses_findAll` was dispatched first and no more than two
tools were dispatched, so a correct answer reached through the old eight-call
thrash is a failure rather than a soft warning.

For a low-cost trace check while iterating on that regression, set
`MSAIDIZI_BENCHMARK_CASE=spending`; the same first-tool and two-call ceiling
remain enforced, while the other six prompts stay covered by the deterministic
resident-set regression suite.

The flag is read server-side, so the backend must restart between runs. Roughly
14 model turns per pass.

---

## Result — 2026-08-20, `claude-opus-5`, effort `medium`, read-only, 538 permitted

### Tool selection: 7/7 with search, 3/7 with narrowing

| case | narrowing | search |
|---|---|---|
| direct-customers | hit | hit |
| direct-suppliers | hit | hit |
| low-stock | hit | hit |
| **owes-us** | **no tools called at all** | `Receivables_findAll` |
| **unpaid-bills** | **no tools called at all** | `Payables_findAll` |
| **we-owe** | `FinancialReports_getSupplierAging` | `Payables_findAll` |
| **spending** | `BidComparisons_findAll` | `Expenses_findAll` |

**4 better, 0 worse, 3 same.** The controls held, so this is a real gain rather
than a different kind of wrong.

Two failure shapes are worth separating. `owes-us` and `unpaid-bills` called
**nothing** — narrowing offered 60 tools and not one of them looked like an
answer, so the agent answered from an empty toolbox. `spending` reaching
`BidComparisons_findAll` is worse than nothing: it is confidently in the wrong
part of the system. Both are what lexical overlap does when the user's
vocabulary and the schema's do not meet.

`we-owe` under narrowing is the interesting near-miss. `getSupplierAging` is a
defensible answer to "what do we owe our suppliers" — arguably the better one —
so the regex scored it a miss where a person might not have. Worth remembering
when reading a single number.

### Cost: search is 2x slower and uses 9.5x more uncached input

| | narrowing | search |
|---|---|---|
| avg latency | 11,090 ms | **22,651 ms** |
| uncached input | 6,817 | **64,633** |
| cache reads | 49,200 | **137,116** |
| cache writes | 30,092 | 4,897 |
| output | 3,735 | 6,349 |
| model turns | 13 | 20 |

Search buys correctness and pays in latency and input tokens. The search
round-trips and the tool sets they return are themselves tokens, and the extra
turns are where the seconds go. For a manager asking a considered question that
is a good trade. For a counter clerk wanting a number in two seconds it is not —
one more reason the Kaunta path stays out of this.

### Correction: caching was not "never working"

The commit that introduced tool search claimed prompt caching had never worked.
That was too strong. Narrowing builds the tool block once per **run**, so turns
2+ within one run already cached — 49,200 reads on the baseline pass proves it.

What was broken was caching **across requests**, since the block was rederived
per request from the user's words. That is what search fixes: 2.8x the cache
reads and cache writes down from 30,092 to 4,897, which is the shape you expect
when a prefix stops being rewritten every call.

### Two things this run raises

**The entry-point set earned nothing here.** All seven cases went to search
regardless. The 15 resident tools are meant to be a no-round-trip fast path for
the common ask, and on this question set they never were. Either the questions
are unrepresentative or the set is the wrong 15 — worth measuring before assuming
it is load-bearing.

**`spending` called eight tools across four turns.** It got the right answer and
took the scenic route. Whether that is thoroughness or thrash is not something
the original harness could tell you, and it is the difference between a
37-second answer and a 10-second one. The current harness makes that distinction
explicit: expenses must be first and no more than two tools may be dispatched.

### What this does not establish

One model, one effort setting, one run per path, seven questions, one database.
Nothing here says search is better on a question set someone else would write, and
a single pass cannot separate a real gain from a lucky one. Re-run it when the
model, the prompt, or the description text changes — all three feed BM25 directly.
