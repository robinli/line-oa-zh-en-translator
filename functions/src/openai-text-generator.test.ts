import {describe, expect, it, vi} from "vitest";
import {OpenAiTextGenerator, OpenAiServiceError} from "./openai-text-generator.js";
import {BusinessTranslator} from "./business-translator.js";

const completed = (text = '{"translation":"請確認。"}') => ({
  status: "completed", output: [
    {type: "reasoning", summary: []},
    {type: "message", role: "assistant", status: "completed", content: [{type: "output_text", text}]},
  ], usage: {input_tokens: 200, output_tokens: 80},
});
describe("OpenAI feasibility adapter", () => {
  it("requests a strict schema without persisted conversations, tools or SDK retries", async () => {
    const usage = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(completed()));
    const generator = new OpenAiTextGenerator({apiKey: "test-only", model: "gpt-6-sol", onUsage: usage}, fetcher);
    expect(await new BusinessTranslator(generator).translate("Please confirm.", "en", "zh-TW")).toBe("請確認。");
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(options!.body as string);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({model: "gpt-6-sol", store: false, max_output_tokens: 4096,
      reasoning: {effort: "low"}, text: {format: {type: "json_schema", strict: true,
        schema: {additionalProperties: false, required: ["translation"]}}}});
    expect(body.instructions).toContain("translation");
    expect(body.tools).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(usage).toHaveBeenCalledWith({inputTokens: 200, outputTokens: 80});
  });
  it.each([
    {...completed(), status: "incomplete"},
    {...completed(), error: {message: "PRIVATE"}},
    {status: "completed", output: []},
    {status: "completed", output: [{type: "message", role: "assistant", status: "completed",
      content: [{type: "refusal", refusal: "PRIVATE"}]}]},
    {status: "completed", output: [{type: "function_call", name: "anything"}]},
    null,
  ])("fails closed for refusal or incomplete response", async data => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
    await expect(new OpenAiTextGenerator({apiKey: "test-only", model: "gpt-6-luna"}, fetcher)
      .generate({input: "private data", systemInstruction: "rules"})).rejects.toThrow(OpenAiServiceError);
  });
  it.each([401, 403, 404, 429, 500])("sanitizes HTTP %s and does not retry", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("SECRET private source", {status}));
    const generator = new OpenAiTextGenerator({apiKey: "test-only", model: "gpt-6-astra"}, fetcher);
    await expect(generator.generate({input: "data", systemInstruction: "rules"}))
      .rejects.toMatchObject({status, message: "Business translation service is unavailable."});
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("retains existing quality retry and number protection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const input = JSON.parse(JSON.parse(options!.body as string).input);
      const token = input.protectedValues[0].token;
      return Response.json(completed(JSON.stringify({translation:
        fetcher.mock.calls.length === 1 ? "金額是 999。" : "金額是 " + token + "。"})));
    });
    const retry = vi.fn();
    const translator = new BusinessTranslator(new OpenAiTextGenerator({
      apiKey: "test-only", model: "gpt-6-sol",
    }, fetcher), {onValidationRetry: retry});
    expect(await translator.translate("The amount is 320.", "en", "zh-TW")).toBe("金額是 320。");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenCalledOnce();
  });
  it("sanitizes transport errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Bearer SECRET private source"));
    await expect(new OpenAiTextGenerator({apiKey: "test-only", model: "gpt-6-sol"}, fetcher)
      .generate({input: "data", systemInstruction: "rules"})).rejects.toThrow("Business translation service is unavailable.");
  });
});
