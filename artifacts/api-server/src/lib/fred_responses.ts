import type OpenAI from "openai";

type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Input = OpenAI.Responses.ResponseInputItem;

/** Keep Responses reasoning beside the in-flight message, never in saved chat. */
export function withFredResponses(client: OpenAI): OpenAI {
  const outputByMessage = new WeakMap<object, Input[]>();
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
      max_output_tokens: Math.max(8192, params.max_completion_tokens ?? 0),
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };
    let response = await client.responses.create(request, options);
    // A message-limit stop is retryable, but its output may contain unfinished
    // function arguments. Discard it and regenerate before any handler runs.
    // Bound the retry and serialize calls to avoid another multi-message burst.
    if (
      response.status === "incomplete" &&
      String(response.incomplete_details?.reason) === "max_messages"
    ) {
      response = await client.responses.create(
        {
          ...request,
          parallel_tool_calls: false,
          input: [
            ...(request.input as Input[]),
            {
              role: "developer",
              content:
                "Return the next required function call or the final answer directly. Omit progress commentary. Do not repeat earlier messages.",
            },
          ],
        },
        options,
      );
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
