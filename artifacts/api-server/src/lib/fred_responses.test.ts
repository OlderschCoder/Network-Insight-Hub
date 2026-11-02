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
      reasoning: { effort: "low" },
      max_output_tokens: 8192,
      tool_choice: { type: "function", name: "probe" },
      tools: [{ strict: false }],
    });
    expect(responses.mock.calls[1][0].input).toContainEqual(reasoning);
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
