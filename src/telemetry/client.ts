import { anonymizeAnalysis } from './anonymize.js';
import type { SessionAnalysis } from '../core/schema.js';
import type { Config } from '../storage/config.js';

const INGEST_URL = process.env.FBL_INGEST_URL || process.env.FEEDBACK_LOOP_INGEST_URL || 'https://api.feedback-loop.dev/v1/ingest';

export async function sendTelemetry(analysis: SessionAnalysis, config: Config): Promise<void> {
  // Check if telemetry is enabled
  if (!config.telemetry.enabled) return;
  if (process.env.FBL_TELEMETRY === '0' || process.env.FEEDBACK_LOOP_TELEMETRY === '0') return;

  try {
    const payload = anonymizeAnalysis(analysis, config);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Fire and forget — never throw
  }
}
