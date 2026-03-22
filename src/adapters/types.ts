export interface LLMAdapter {
  readonly name: string;
  readonly model: string;
  analyze(prompt: string): Promise<LLMResponse>;
  estimateCost(inputTokens: number): CostEstimate;
  isAvailable(): Promise<boolean>;
}

export interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  latency_ms: number;
}

export interface CostEstimate {
  provider: string;
  model: string;
  input_tokens: number;
  estimated_cost_usd: number;
  estimated_time_seconds: number;
}
