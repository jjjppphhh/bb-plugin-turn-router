import { z } from 'zod';
export const settingsSchema = z.object({
  classifier: z.enum(['luna', 'jev', 'compatible-api']).default('luna'),
  classifierModel: z.string().min(1).max(150).default('gpt-5.6-luna'),
  jevModel: z.string().regex(/^jev-\d+\.\d+\.\d+$/, 'Use a pinned Jev version such as jev-1.13.0.').default('jev-1.13.0'),
  apiBaseUrl: z.string().max(500).default(''),
  codexBinary: z.string().max(500).default('codex'),
  premium: z.number().int().min(0).max(100).default(50),
  timeoutMs: z.number().int().min(2000).max(60000).default(15000),
}).strict();
export { defaults, type Settings } from './shared-settings';
