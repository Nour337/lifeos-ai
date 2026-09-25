import { AIError } from "@/lib/ai/planDay";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// gpt-4.1-mini follows tool and JSON rules far more reliably than gpt-4o-mini
export const DEFAULT_MODEL = "gpt-4.1-mini";

type Message = { role: "system" | "user" | "assistant"; content: string };

// One chat completion. Throws AIError with a friendly message on failure.
export async function chatCompletion(options: {
  messages: Message[];
  json?: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ content: string; toolCalls: { name: string; arguments: string }[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIError("The AI assistant isn't set up yet (OPENAI_API_KEY is missing).", 503);
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        messages: options.messages,
        ...(options.json && { response_format: { type: "json_object" } }),
        ...(options.tools && { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }),
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 1200,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });
  } catch {
    throw new AIError("Couldn't reach the AI service. Try again shortly.", 502);
  }

  if (!response.ok) {
    console.error("OpenAI error:", response.status, await response.text());
    if (response.status === 401) throw new AIError("The AI API key is invalid.", 502);
    if (response.status === 429) {
      throw new AIError("The AI is busy or out of credit. Try again in a minute.", 429);
    }
    throw new AIError("The AI service returned an error.", 502);
  }

  const json = await response.json();
  const message = json.choices?.[0]?.message ?? {};
  return {
    content: (message.content ?? "").trim(),
    toolCalls: (message.tool_calls ?? []).map(
      (c: { function?: { name?: string; arguments?: string } }) => ({
        name: c.function?.name ?? "",
        arguments: c.function?.arguments ?? "",
      })
    ),
  };
}

export async function askJSON(system: string, user: string, maxTokens = 1200): Promise<unknown> {
  const { content } = await chatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    json: true,
    maxTokens,
  });
  try {
    return JSON.parse(content);
  } catch {
    throw new AIError("The AI gave an unreadable answer. Try again.", 502);
  }
}
