import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const ConfigSchema = z.object({
  version: z.literal(1),
  provider: z.object({
    type: z.enum(['anthropic', 'openrouter', 'local']),
    api_key: z.string().optional(),
    model: z.string().optional(),
    base_url: z.string().optional(),
  }),
  telemetry: z.object({
    enabled: z.boolean(),
    device_id: z.string(),
  }),
  analysis: z.object({
    auto_analyze: z.boolean(),
    min_messages: z.number(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function getDataDir(): string {
  const envDir = process.env.FBL_DATA_DIR || process.env.FEEDBACK_LOOP_DATA_DIR;
  if (envDir) return envDir;
  const newDir = path.join(os.homedir(), '.fbl');
  const legacyDir = path.join(os.homedir(), '.feedback-loop');
  if (!fs.existsSync(newDir) && fs.existsSync(legacyDir)) return legacyDir;
  return newDir;
}

export function getConfigPath(): string {
  return process.env.FBL_CONFIG || process.env.FEEDBACK_LOOP_CONFIG || path.join(getDataDir(), 'config.json');
}

export function ensureDataDirs(): void {
  const dataDir = getDataDir();
  for (const sub of ['', 'analyses', 'suggestions', 'cache']) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export function saveConfig(config: Config): void {
  ConfigSchema.parse(config);
  ensureDataDirs();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
