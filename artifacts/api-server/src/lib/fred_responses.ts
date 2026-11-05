import type OpenAI from "openai";
import { createHash, randomUUID } from "node:crypto";

type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Input = OpenAI.Responses.ResponseInputItem;

/** Keep Responses reasoning beside the in-flight message, never in saved chat. */
export function withFredResponses(client: OpenAI): OpenAI {
  const outputByMessage = new WeakMap<object, Input[]>();
  const turns = new WeakMap<
    object,
    {
      id: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      stopped?: string;
    }
  >();

  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  const normalized = (value: string): string => {
    try {
      return canonical(JSON.parse(value));
    } catch {
      return value;
    }
  };
  // Match completed calls AND returned evidence, ignoring call IDs and JSON
  // key order. Changing results or arguments are progress, even for the same tool.
  const unchangedToolRounds = (messages: Message[]): boolean => {
    const rounds: string[] = [];
    let current: Array<{ name: string; arguments: string; output: string }> =
      [];
    let expected: Map<string, { name: string; arguments: string }> | null =
      null;
    for (const message of messages) {
      if (message.role === "assistant") {
        current = [];
        expected = new Map(
          (message.tool_calls ?? []).flatMap((call) =>
            call.type === "function"
              ? [
                  [
                    call.id,
                    {
                      name: call.function.name,
                      arguments: normalized(call.function.arguments),
                    },
                  ] as const,
                ]
              : [],
          ),
        );
      } else if (
        message.role === "tool" &&
        expected?.has(message.tool_call_id)
      ) {
        const call = expected.get(message.tool_call_id)!;
        current.push({
          ...call,
          output: normalized(
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
          ),
        });
        expected.delete(message.tool_call_id);
        if (expected.size === 0) {
          rounds.push(
            createHash("sha256")
              .update(
                canonical(
                  current.sort((a, b) =>
                    canonical(a).localeCompare(canonical(b)),
                  ),
                ),
              )
              .digest("hex"),
          );
          expected = null;
        }
      } else if (message.role === "user") {
        rounds.length = 0;
        expected = null;
      }
    }
    return (
      rounds.length >= 3 &&
      rounds.slice(-3).every((round) => round === rounds.at(-1))
    );
  };
  const convert = (message: Message): Input[] => {
    const retained = outputByMessage.get(message);
    if (retained) return retained;
    if (message.role === "tool") {
      return [
        {
          type: "function_call_output",
          call_id: message.tool_call_id,
          output:
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
        },
      ];
    }
    if (message.role === "function")
      throw new Error(
        "Legacy function messages are unsupported by Fred Responses.",
      );
    const result: Input[] = [];
    if (message.content) {
      if (typeof message.content === "string") {
        result.push({ role: message.role, content: message.content });
      } else {
        const content: OpenAI.Responses.ResponseInputContent[] =
          message.content.map((part) => {
            if (part.type === "text")
              return { type: "input_text", text: part.text };
            if (part.type === "image_url")
              return {
                type: "input_image",
                image_url: part.image_url.url,
                detail: part.image_url.detail ?? "auto",
              };
            throw new Error(`Unsupported Fred message content: ${part.type}`);
          });
        result.push({ role: message.role, content } as Input);
      }
    }
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        if (call.type !== "function")
          throw new Error("Unsupported Fred tool call.");
        result.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }
    return result;
  };
  const create = async (
    params: Params,
    options?: OpenAI.RequestOptions,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
    if (params.model !== "gpt-6-astra")
      return client.chat.completions.create(params, options);
    if (params.stream)
      throw new Error("Fred Astra currently uses non-streaming responses.");
    const anchor = params.messages[0] ?? params;
    let turn = turns.get(anchor);
    if (!turn) {
      turn = { id: randomUUID(), requests: 0, inputTokens: 0, outputTokens: 0 };
      turns.set(anchor, turn);
    }
    const stop = (reason: string): OpenAI.Chat.Completions.ChatCompletion => {
      turn!.stopped = reason;
      console.info(
        JSON.stringify({
          event: "fred_ai_stop",
          turnId: turn!.id,
          reason,
          requests: turn!.requests,
          inputTokens: turn!.inputTokens,
          outputTokens: turn!.outputTokens,
        }),
      );
      return {
        id: `fred-stop-${turn!.id}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: params.model,
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: "stop",
            message: {
              role: "assistant",
              refusal: null,
              content:
                reason === "unchanged_tool_results"
                  ? "Fred stopped this turn because three consecutive tool rounds repeated the same calls and returned identical results. No further model call was made. Earlier completed work is preserved; this stop does not mean the requested task is finished."
                  : "Fred stopped this turn because Astra reached its message limit. The interrupted output was discarded and no automatic retry was made, to avoid extra charges. Earlier completed work is preserved; this stop does not mean the requested task is finished.",
            },
          },
        ],
      };
    };
    if (turn.stopped) return stop(turn.stopped);
    if (unchangedToolRounds(params.messages))
      return stop("unchanged_tool_results");
    const tools: OpenAI.Responses.Tool[] | undefined = params.tools?.map(
      (tool) => {
        if (tool.type !== "function")
          throw new Error("Unsupported Fred tool definition.");
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters ?? {
            type: "object",
            properties: {},
          },
          strict: false,
        };
      },
    );
    const choice = params.tool_choice;
    const toolChoice =
      typeof choice === "object"
        ? choice.type === "function"
          ? { type: "function" as const, name: choice.function.name }
          : undefined
        : choice;
    const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: params.model,
      input: params.messages.flatMap(convert),
      store: false,
      include: ["reasoning.encrypted_content"],
      // High reasoning is Fred's configured operating preference, including
      // initial routing and synthesis of large operational tool results.
      reasoning: { effort: "high" },
      // Responses budgets include reasoning as well as the visible answer.
      max_output_tokens: 8192,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };
    turn.requests++;
    const startedAt = Date.now();
    console.info(
      JSON.stringify({
        event: "fred_ai_request",
        turnId: turn.id,
        request: turn.requests,
        model: params.model,
        reasoning: "high",
        maxOutputTokens: 8192,
        automaticRetries: 0,
      }),
    );
    let response: OpenAI.Responses.Response;
    try {
      response = await client.responses.create(request, {
        ...options,
        maxRetries: 0,
      });
    } catch (error) {
      console.info(
        JSON.stringify({
          event: "fred_ai_error",
          turnId: turn.id,
          request: turn.requests,
          elapsedMs: Date.now() - startedAt,
          usageKnown: false,
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
      throw error;
    }
    turn.inputTokens += response.usage?.input_tokens ?? 0;
    turn.outputTokens += response.usage?.output_tokens ?? 0;
    console.info(
      JSON.stringify({
        event: "fred_ai_usage",
        turnId: turn.id,
        request: turn.requests,
        responseId: response.id,
        model: response.model,
        reasoning: "high",
        status: response.status,
        incompleteReason: response.incomplete_details?.reason ?? null,
        elapsedMs: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens ?? null,
        cachedInputTokens:
          response.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        reasoningTokens:
          response.usage?.output_tokens_details?.reasoning_tokens ?? null,
        totalInputTokens: turn.inputTokens,
        totalOutputTokens: turn.outputTokens,
      }),
    );
    // An interrupted generation never reaches a tool handler or triggers
    // another paid attempt. Let the existing chat loop return a clear stop.
    if (
      response.status === "incomplete" &&
      String(response.incomplete_details?.reason) === "max_messages"
    ) {
      return stop("max_messages");
    }
    if (response.status !== "completed") {
      throw new Error(
        `Fred Astra response ${response.status}: ${response.incomplete_details?.reason ?? response.error?.code ?? "unknown"}`,
      );
    }
    const calls: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] =
      [];
    const texts: string[] = [];
    let refusal: string | null = null;
    for (const item of response.output) {
      if (item.type === "function_call")
        calls.push({
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        });
      if (item.type === "message")
        for (const part of item.content) {
          if (part.type === "output_text") texts.push(part.text);
          if (part.type === "refusal") {
            refusal = part.refusal;
            texts.push(part.refusal);
          }
        }
    }
    const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content: texts.join("\n") || null,
      refusal,
      ...(calls.length ? { tool_calls: calls } : {}),
    };
    outputByMessage.set(message, response.output as Input[]);
    return {
      id: response.id,
      object: "chat.completion",
      created: response.created_at,
      model: response.model,
      ...(response.usage
        ? {
            usage: {
              prompt_tokens: response.usage.input_tokens,
              completion_tokens: response.usage.output_tokens,
              total_tokens: response.usage.total_tokens,
              completion_tokens_details: {
                reasoning_tokens:
                  response.usage.output_tokens_details?.reasoning_tokens ?? 0,
              },
              prompt_tokens_details: {
                cached_tokens:
                  response.usage.input_tokens_details?.cached_tokens ?? 0,
              },
            },
          }
        : {}),
      choices: [
        {
          index: 0,
          message,
          logprobs: null,
          finish_reason: calls.length ? "tool_calls" : "stop",
        },
      ],
    };
  };
  // Limit the adapter to Fred's routed client; unrelated integrations stay raw.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "chat")
        return {
          ...target.chat,
          completions: new Proxy(target.chat.completions, {
            get(completions, key, completionReceiver) {
              return key === "create"
                ? create
                : Reflect.get(completions, key, completionReceiver);
            },
          }),
        };
      return Reflect.get(target, prop, receiver);
    },
  });
}
