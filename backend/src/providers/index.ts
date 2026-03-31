import { env } from "../config.js";
import type { AnalysisProvider } from "../types.js";
import { MockAnalysisProvider } from "./mockAnalysisProvider.js";

export function createAnalysisProvider(): AnalysisProvider {
  return new MockAnalysisProvider(env.MOCK_PROVIDER_DELAY_MS);
}
