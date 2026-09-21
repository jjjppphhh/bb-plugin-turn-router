import { z } from 'zod';
export const settingsSchema = z.object({
  classifier: z.enum(['luna', 'compatible-api']).default('luna'),
  classifierModel: z.string().min(1).max(150).default('gpt-5.6-luna'),
  apiBaseUrl: z.string().max(500).default(''),
  codexBinary: z.string().max(500).default('codex'),
  premium: z.number().int().min(0).max(100).default(50),
  timeoutMs: z.number().int().min(2000).max(60000).default(15000),
}).strict();
export { defaults, type Settings } from './shared-settings';
