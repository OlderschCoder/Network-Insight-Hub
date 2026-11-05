import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { withFredResponses } from "./fred_responses";

function setup(outputs: unknown[][]) {
  const responses = vi.fn().mockImplementation(async () => ({
    id: "response-test",
    created_at: 1,
    model: "gpt-6-astra",
    status: "completed",
    output: outputs.shift() ?? [],
  }));
  const chat = vi.fn().mockResolvedValue({ legacy: true });
  const client = withFredResponses({
    responses: { create: responses },
    chat: { completions: { create: chat } },
  } as unknown as OpenAI);
  return { client, responses, chat };
}

describe("Fred Astra adapter", () => {
  it("preserves tools, forced selection, reasoning and multiple tool results between rounds", async () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_test",
      summary: [],
      encrypted_content: "opaque-test",
    };
    const calls = ["a", "b"].map((id) => ({
      type: "function_call",
      call_id: id,
      name: "probe",
      arguments: '{"host":"test"}',
    }));
    const { client, responses, chat } = setup([
      [reasoning, ...calls],
      [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Verified synthetic probes." },
          ],
        },
      ],
    ]);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "Use evidence." },
      { role: "user", content: "Check test hosts." },
    ];
    const first = await client.chat.completions.create({
      model: "gpt-6-astra",
      messages,
      max_completion_tokens: 1400,
      tools: [
        {
          type: "function",
          function: {
            name: "probe",
            parameters: {
              type: "object",
              properties: { host: { type: "string" } },
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "probe" } },
    });
    expect(first.choices[0].finish_reason).toBe("tool_calls");
    messages.push(first.choices[0].message);
    messages.push(
      { role: "tool", tool_call_id: "a", content: "up" },
      { role: "tool", tool_call_id: "b", content: "up" },
    );
    const final = await client.chat.completions.create({
      model: "gpt-6-astra",
      messages: [...messages, { role: "system", content: "Conclude now." }],
    });
    expect(final.choices[0].message.content).toBe("Verified synthetic probes.");
    expect(responses.mock.calls[0][0]).toMatchObject({
      store: false,
      reasoning: { effort: "high" },
      max_output_tokens: 8192,
      tool_choice: { type: "function", name: "probe" },
      tools: [{ strict: false }],
    });
    expect(responses.mock.calls[1][0].input).toContainEqual(reasoning);
    expect(responses.mock.calls[1][0].reasoning).toEqual({ effort: "high" });
    expect(responses.mock.calls[1][0].input).toContainEqual({
      type: "function_call_output",
      call_id: "b",
      output: "up",
    });
    expect(JSON.stringify(first.choices[0].message)).not.toContain(
      "opaque-test",
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it("passes other models and request options through unchanged", async () => {
    const { client, responses, chat } = setup([]);
    const params = {
      model: "gpt-5.6-sol",
      messages: [{ role: "user" as const, content: "Hello" }],
    };
    await client.chat.completions.create(params, { timeout: 1234 });
    expect(chat).toHaveBeenCalledWith(params, { timeout: 1234 });
    expect(responses).not.toHaveBeenCalled();
  });

  it("refuses incomplete output rather than executing partial tool arguments", async () => {
    const { client, responses } = setup([]);
    responses.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
    await expect(
      client.chat.completions.create({ model: "gpt-6-astra", messages: [] }),
    ).rejects.toThrow("max_output_tokens");
    expect(responses).toHaveBeenCalledTimes(1);
  });

  it("stops max_messages without retrying or exposing interrupted tool arguments", async () => {
    const { client, responses } = setup([]);
    responses.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "max_messages" },
      output: [
        {
          type: "function_call",
          call_id: "partial",
          name: "probe",
          arguments: '{"host":',
        },
      ],
    });
    const params = {
      model: "gpt-6-astra",
      messages: [
        { role: "system" as const, content: "Use evidence." },
        { role: "user" as const, content: "Check test." },
      ],
    };
    const result = await client.chat.completions.create(params, {
      timeout: 1234,
      maxRetries: 5,
    });
    expect(result.choices[0].message.tool_calls).toBeUndefined();
    expect(result.choices[0].message.content).toContain("no automatic retry");
    expect(result.choices[0].finish_reason).toBe("stop");
    await client.chat.completions.create({
      ...params,
      messages: [...params.messages],
    });
    expect(responses).toHaveBeenCalledTimes(1);
    expect(responses.mock.calls[0][1]).toEqual({
      timeout: 1234,
      maxRetries: 0,
    });
    expect(responses.mock.calls[0][0].reasoning).toEqual({ effort: "high" });
    await client.chat.completions.create({
      ...params,
      messages: [{ role: "user", content: "New independent turn." }],
    });
    expect(responses).toHaveBeenCalledTimes(2);
  });

  function history(
    results: string[],
    args: string[] = [],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "Use evidence." },
      { role: "user", content: "Check test." },
    ];
    results.forEach((output, index) => {
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            type: "function",
            id: `call-${index}`,
            function: {
              name: "probe",
              arguments: args[index] ?? '{"host":"test"}',
            },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: `call-${index}`,
        content: output,
      });
    });
    return messages;
  }

  it("stops three identical completed tool rounds before another paid request", async () => {
    const { client, responses } = setup([]);
    const result = await client.chat.completions.create({
      model: "gpt-6-astra",
      messages: history(['{"a":1,"b":2}', '{"b":2,"a":1}', '{"a":1,"b":2}']),
    });
    expect(result.choices[0].message.content).toContain(
      "three consecutive tool rounds",
    );
    expect(result.choices[0].message.tool_calls).toBeUndefined();
    expect(responses).not.toHaveBeenCalled();
  });

  it("allows repeated tools when their arguments or returned evidence change", async () => {
    for (const messages of [
      history(["running", "running", "finished"]),
      history(
        ["up", "up", "up"],
        ['{"host":"a"}', '{"host":"b"}', '{"host":"c"}'],
      ),
      history(["unchanged", "unchanged"]),
      [
        ...history(["unchanged", "unchanged", "unchanged"]),
        { role: "user" as const, content: "Check again now." },
      ],
    ]) {
      const { client, responses } = setup([]);
      await client.chat.completions.create({ model: "gpt-6-astra", messages });
      expect(responses).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps independent turns separate and enforces the per-call output ceiling", async () => {
    const { client, responses } = setup([]);
    await client.chat.completions.create({
      model: "gpt-6-astra",
      messages: history(["same", "same", "same"]),
    });
    await client.chat.completions.create({
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "Independent request." }],
      max_completion_tokens: 50000,
    });
    expect(responses).toHaveBeenCalledTimes(1);
    expect(responses.mock.calls[0][0].max_output_tokens).toBe(8192);
  });

  it("reports usage including reasoning without logging conversation content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { client, responses } = setup([]);
      responses.mockResolvedValueOnce({
        id: "response-usage",
        created_at: 1,
        model: "gpt-6-astra",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 40 },
          output_tokens_details: { reasoning_tokens: 15 },
        },
      });
      const result = await client.chat.completions.create({
        model: "gpt-6-astra",
        messages: [{ role: "user", content: "PRIVATE_SENTINEL" }],
      });
      expect(result.usage).toMatchObject({
        prompt_tokens: 100,
        completion_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 15 },
      });
      const log = info.mock.calls
        .map(([line]) => JSON.parse(line))
        .find((item) => item.event === "fred_ai_usage");
      expect(log).toMatchObject({
        event: "fred_ai_usage",
        reasoning: "high",
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        reasoningTokens: 15,
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    } finally {
      info.mockRestore();
    }
  });

  it("does not retry content filtering or other failed responses", async () => {
    for (const response of [
      {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      },
      { status: "failed", error: { code: "server_error" } },
    ]) {
      const { client, responses } = setup([]);
      responses.mockResolvedValueOnce(response);
      await expect(
        client.chat.completions.create({ model: "gpt-6-astra", messages: [] }),
      ).rejects.toThrow("Fred Astra response");
      expect(responses).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves image input and does not send sampling parameters", async () => {
    const { client, responses } = setup([[]]);
    await client.chat.completions.create({
      model: "gpt-6-astra",
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect" },
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.png" },
            },
          ],
        },
      ],
    });
    expect(responses.mock.calls[0][0].input[0].content[1]).toEqual({
      type: "input_image",
      image_url: "https://example.com/image.png",
      detail: "auto",
    });
    expect(responses.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
