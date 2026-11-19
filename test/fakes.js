// Test doubles shared by the unit and HTTP tests.

// A fake OpenAI Responses stream that sends the JSON in small pieces, like the API does.
// end: "completed", "refusal", "max_output_tokens" or "content_filter".
export function fakeClient(json, { end = "completed", chunk = 7 } = {}) {
  const calls = [];
  return {
    calls,
    responses: { async create(params) {
      calls.push(params);
      const refused = end === "refusal";
      const incomplete = end === "max_output_tokens" || end === "content_filter";
      const part = refused ? { type: "refusal", refusal: "I can't help with that." } : { type: "output_text", text: json, annotations: [] };
      const response = {
        id: "resp_fake", object: "response", model: params.model,
        status: incomplete ? "incomplete" : "completed",
        incomplete_details: incomplete ? { reason: end } : null,
        output: [{ type: "reasoning", id: "rs_1", summary: [] }, { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [part] }],
        usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, output_tokens_details: { reasoning_tokens: 100 } },
      };
      const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1", summary: [] } },
        { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_1", role: "assistant", content: [] } }];
      if (refused) events.push({ type: "response.refusal.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: part.refusal });
      else for (let i = 0; i < json.length; i += chunk) events.push({ type: "response.output_text.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: json.slice(i, i + chunk) });
      events.push({ type: incomplete ? "response.incomplete" : "response.completed", response });
      return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
    } },
  };
}

export const DEVON = { readable: true, name: "Devon Park", role: "4th year CS at UBC", receipts: [{ icon: "code", text: "Mostly TypeScript and Rust" }, { icon: "star", text: "212 stars on one repo" }, { icon: "moon", text: "Pushes after 1am, most nights" }], score: 64, verdict: "41 repos and 30 of them say initial commit. The Rust one is actually good." };
