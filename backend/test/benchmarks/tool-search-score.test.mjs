import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreToolSearchCase } from './tool-search-score.mjs';

const spending = {
  id: 'spending',
  want: /^Expenses_findAll$/,
  first: /^Expenses_findAll$/,
  maxCalls: 2,
};
const call = { type: 'tool_call', tool: 'Expenses_findAll' };
const success = { type: 'tool_result', tool: call.tool, ok: true, status: 200 };
const answer = { type: 'text', text: 'Recent expenses are listed.' };
const run = (events = [call, success, answer]) => ({ reason: 'end_turn', events, messages: [] });

test('a completed expense read and answer passes without search', () => {
  assert.equal(scoreToolSearchCase(spending, run(), 201).hit, true);
});
test('a failed read or orphan result cannot pass by naming the right tool', () => {
  for (const events of [
    [call, { ...success, ok: false, status: 403 }, answer],
    [success, answer],
    [call, { ...success, tool: 'Payables_findAll' }, answer],
    [call, answer],
  ]) {
    assert.equal(scoreToolSearchCase(spending, run(events), 201).hit, false);
  }
});
test('HTTP errors, truncated/budget-exhausted runs and absent answers fail', () => {
  assert.equal(scoreToolSearchCase(spending, run(), 500).hit, false);
  for (const reason of ['failed', 'truncated', 'tool_budget_exhausted', 'awaiting_confirmation']) {
    assert.equal(scoreToolSearchCase(spending, { ...run(), reason }, 201).hit, false);
  }
  assert.equal(scoreToolSearchCase(spending, run([call, success]), 201).hit, false);
});
test('one failed read followed by one successful retry passes, a third dispatch fails', () => {
  const failed = { ...success, ok: false, status: 503 };
  assert.equal(
    scoreToolSearchCase(spending, run([call, failed, call, success, answer]), 201).hit,
    true,
  );
  assert.equal(
    scoreToolSearchCase(spending, run([call, failed, call, failed, call, success, answer]), 201)
      .hit,
    false,
  );
});
test('provider-side search thrash fails even with only one ERP dispatch', () => {
  const result = {
    ...run(),
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'server_tool_use', name: 'tool_search_tool_bm25', id: 'search1' }],
      },
    ],
  };
  assert.equal(scoreToolSearchCase(spending, result, 201).hit, false);
  const other = { ...spending, id: 'other' };
  assert.equal(scoreToolSearchCase(other, result, 201).hit, true);
  assert.equal(scoreToolSearchCase(other, result, 201, { requireFastPath: true }).hit, false);
});
test('missing provider trace and adjacent-first reads cannot prove the spending fast path', () => {
  assert.equal(scoreToolSearchCase(spending, { ...run(), messages: undefined }, 201).hit, false);
  assert.equal(
    scoreToolSearchCase(
      spending,
      run([
        { ...call, tool: 'Payables_findAll' },
        { ...success, tool: 'Payables_findAll' },
        call,
        success,
        answer,
      ]),
      201,
    ).hit,
    false,
  );
});
