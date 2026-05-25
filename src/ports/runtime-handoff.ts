export interface RuntimeHandoffResult {
  delivered: boolean;
  error?: string;
}

export interface RuntimeHandoffPort {
  handoffToSession(prompt: string): Promise<RuntimeHandoffResult>;
}
