import { AIError } from "@/lib/ai/server";

// The one OpenAI client. Every AI feature goes through complete(), which
// retries short outages and reports tokens so each call can be logged.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-4.1-mini follows tool and JSON rules far more reliably than smaller
// models; the cheap model does summaries and other simple jobs.
export const MODEL = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";
export const CHEAP_MODEL = () => process.env.OPENAI_CHEAP_MODEL || "gpt-4.1-nano";

export type LLMMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; name: string; arguments: string };

export type LLMResult = {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

type Options = {
  messages: LLMMessage[];
  model?: string;
  json?: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One chat completion, retried up to twice on network errors, rate limits
// and server errors. Throws AIError with a friendly message on failure.
export async function complete(options: Options): Promise<LLMResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIError("The AI assistant isn't set up yet (OPENAI_API_KEY is missing).", 503);
  }
  const model = options.model ?? MODEL();
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? 50_000);

  let lastError: AIError = new AIError("Couldn't reach the AI service. Try again shortly.", 502);
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 3_000) break;

    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: options.messages,
          ...(options.json && { response_format: { type: "json_object" } }),
          ...(options.tools && { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }),
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 1200,
        }),
        signal: AbortSignal.timeout(remaining),
      });
    } catch {
      lastError = new AIError("Couldn't reach the AI service. Try again shortly.", 502);
      await sleep(500 * (attempt + 1) ** 2);
      continue;
    }

    if (response.ok) {
      const json = await response.json();
      const message = json.choices?.[0]?.message ?? {};
      return {
        content: (message.content ?? "").trim(),
        toolCalls: (message.tool_calls ?? []).map(
          (c: { id?: string; function?: { name?: string; arguments?: string } }) => ({
            id: c.id ?? "",
            name: c.function?.name ?? "",
            arguments: c.function?.arguments ?? "",
          })
        ),
        model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        ms: Date.now() - started,
      };
    }

    console.error("OpenAI error:", response.status, (await response.text()).slice(0, 500));
    if (response.status === 401) throw new AIError("The AI API key is invalid.", 502);
    if (response.status === 400) throw new AIError("The AI couldn't handle that request.", 502);
    lastError =
      response.status === 429
        ? new AIError("The AI is busy right now. Try again in a minute.", 429)
        : new AIError("The AI service returned an error.", 502);
    await sleep(response.status === 429 ? 1500 * (attempt + 1) : 500 * (attempt + 1) ** 2);
  }
  throw lastError;
}

// A JSON answer. A reply that isn't valid JSON is asked for once more.
export async function completeJSON(
  system: string,
  user: string,
  options: { maxTokens?: number; model?: string; meter?: { add: (r: LLMResult) => void } } = {}
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      json: true,
      maxTokens: options.maxTokens ?? 1200,
      model: options.model,
    });
    options.meter?.add(result);
    try {
      return JSON.parse(result.content);
    } catch {
      // try again
    }
  }
  throw new AIError("The AI gave an unreadable answer. Try again.", 502);
}

// Tool arguments, or null when the model sent broken JSON
export function parseArgs(call: ToolCall | undefined): Record<string, unknown> | null {
  if (!call) return null;
  try {
    const value = JSON.parse(call.arguments);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
