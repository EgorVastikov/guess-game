function object(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const text = maxLength => ({ type: "string", minLength: 1, maxLength });

// Ollama applies these schemas while generating, not only after parsing JSON.
// Application validation remains authoritative for history links and game rules.
export function responseFormat(task, input) {
  let schema;
  if (task === "hint") {
    const keys = (input.candidates ?? []).map(item => item.key);
    schema = object({ key: { type: "string", ...(keys.length ? { enum: keys } : {}) } });
  } else if (task === "analysis") {
    const turns = (input.bestCandidates ?? []).map(item => item.turn);
    const best = object({ turn: { type: "integer", enum: turns }, reason: text(600) });
    schema = object({
      strength: text(600),
      bestQuestion: turns.length ? { anyOf: [best, { type: "null" }] } : { type: "null" },
      improvement: text(600),
      nextQuestion: text(300),
    });
  } else if (task === "vision") {
    schema = object({
      guesses: { type: "array", items: text(80), minItems: 0, maxItems: 3 },
      question: { anyOf: [text(200), { type: "null" }] },
    });
  } else return null;
  return { type: "json_schema", json_schema: { name: `game_${task}`, strict: true, schema } };
}
