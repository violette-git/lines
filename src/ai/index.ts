import type { AiClient } from '@/domain/contracts';
import type { AppSettings } from '@/domain/types';

import { createDirectClient } from './claudeDirect';
import { createProxyClient } from './claudeProxy';
import { getApiKey } from './keyStore';
import { DEFAULT_AI_MODEL } from './prompt';

/** Returns a client for the configured AI mode, or null when AI is off or not configured. */
export async function createAiClient(settings: AppSettings): Promise<AiClient | null> {
  const model = settings.aiModel?.trim() || DEFAULT_AI_MODEL;
  if (settings.aiMode === 'direct') {
    const apiKey = await getApiKey();
    return apiKey ? createDirectClient({ apiKey, model }) : null;
  }
  if (settings.aiMode === 'proxy') {
    const url = settings.proxyUrl?.trim();
    return url ? createProxyClient({ url, model }) : null;
  }
  return null;
}

export { applyAiResult, coerceFieldValue, MIN_AI_CONFIDENCE } from './applyAiResult';
export { getApiKey, maskApiKey, setApiKey } from './keyStore';
export { setProxyAuthTokenProvider, createProxyClient, type AuthTokenProvider } from './claudeProxy';
export { createDirectClient } from './claudeDirect';
export { AiError, type AiErrorCode } from './http';
export {
  DEFAULT_AI_MODEL,
  RECORD_NODE_TOOL,
  SYSTEM_PROMPT,
  aiFieldDefsFor,
  buildRecordNodeTool,
  buildUserPrompt,
  normalizeAiResult,
} from './prompt';
