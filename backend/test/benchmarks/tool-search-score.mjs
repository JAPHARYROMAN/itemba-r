/** Score execution evidence, not merely a model's attempt to name a tool. */
export function scoreToolSearchCase(question, result, status, { requireFastPath = false } = {}) {
  const events = Array.isArray(result.events) ? result.events : [];
  const calls = events.filter((event) => event.type === 'tool_call');
  const called = calls.map((event) => event.tool);
  const completed = status >= 200 && status < 300 && result.reason === 'end_turn';
  const answerPresent = events.some(
    (event) => event.type === 'text' && typeof event.text === 'string' && event.text.trim(),
  );
  // Dispatches and their results are emitted serially by the loop. Pair them
  // rather than accepting an unrelated or orphan successful result event.
  let pending;
  const successful = [];
  for (const event of events) {
    if (event.type === 'tool_call') pending = event;
    if (event.type === 'tool_result') {
      if (
        pending?.tool === event.tool &&
        event.ok === true &&
        event.status >= 200 &&
        event.status < 300
      ) {
        successful.push(pending.tool);
      }
      pending = undefined;
    }
  }
  const reachedExpected = successful.some((name) => question.want.test(name));
  const firstMatched = !question.first || (called.length > 0 && question.first.test(called[0]));
  const withinCallBudget = question.maxCalls === undefined || called.length <= question.maxCalls;
  // Provider-side searches do not emit ERP tool_call events. The complete
  // provider blocks are preserved in this fresh conversation's messages.
  const traceAvailable = Array.isArray(result.messages);
  const searchCalls = (traceAvailable ? result.messages : [])
    .flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content) ? message.content : [],
    )
    .filter(
      (block) => block?.type === 'server_tool_use' && /^tool_search/.test(block.name ?? ''),
    ).length;
  const fastPath = traceAvailable && searchCalls === 0;
  const hit =
    completed &&
    answerPresent &&
    reachedExpected &&
    firstMatched &&
    withinCallBudget &&
    (!(requireFastPath || question.id === 'spending') || fastPath);
  return {
    called,
    successful,
    completed,
    answerPresent,
    reachedExpected,
    firstMatched,
    withinCallBudget,
    traceAvailable,
    searchCalls,
    fastPath,
    hit,
  };
}
