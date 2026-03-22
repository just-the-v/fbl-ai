import { TelemetryPayloadSchema } from './schema';

interface Env {
  DB: D1Database;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT = 100; // requests per hour

/**
 * Hash IP with a daily rotating salt (YYYY-MM-DD).
 * Result cannot be reversed to the original IP.
 */
async function hashIP(ip: string): Promise<string> {
  const dailySalt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const data = new TextEncoder().encode(ip + dailySalt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get current hour window key (YYYY-MM-DDTHH).
 */
function currentWindow(): string {
  return new Date().toISOString().slice(0, 13); // "2026-03-22T20"
}

/**
 * Check and increment rate limit. Returns true if allowed.
 */
async function checkRateLimit(db: D1Database, ipHash: string): Promise<boolean> {
  const window = currentWindow();

  // Upsert count
  const result = await db.prepare(`
    INSERT INTO rate_limits (ip_hash, window, count) VALUES (?, ?, 1)
    ON CONFLICT (ip_hash, window) DO UPDATE SET count = count + 1
    RETURNING count
  `).bind(ipHash, window).first<{ count: number }>();

  return (result?.count ?? 1) <= RATE_LIMIT;
}

/**
 * Clean up old rate limit windows (keep only current hour).
 * Fire-and-forget, non-blocking.
 */
async function cleanupOldWindows(db: D1Database): Promise<void> {
  const window = currentWindow();
  await db.prepare('DELETE FROM rate_limits WHERE window < ?').bind(window).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok' }, { headers: CORS_HEADERS });
    }

    // Only POST /v1/ingest
    if (request.method !== 'POST' || url.pathname !== '/v1/ingest') {
      return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
    }

    try {
      // Rate limiting by hashed IP
      const clientIP = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
      const ipHash = await hashIP(clientIP);
      const allowed = await checkRateLimit(env.DB, ipHash);

      if (!allowed) {
        return Response.json(
          { error: 'Rate limit exceeded. Max 100 requests per hour.' },
          { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '3600' } },
        );
      }

      const body = await request.json();
      const result = TelemetryPayloadSchema.safeParse(body);

      if (!result.success) {
        return Response.json(
          { error: 'Invalid payload', details: result.error.flatten() },
          { status: 400, headers: CORS_HEADERS },
        );
      }

      const payload = result.data;

      // Insert analysis
      const analysisResult = await env.DB.prepare(`
        INSERT INTO analyses (device_id, team_id, cli_version, provider, model_used, message_count, tool_use_count, satisfaction_positive, satisfaction_negative)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        payload.device_id,
        payload.team_id,
        payload.cli_version,
        payload.analysis.provider,
        payload.analysis.model_used,
        payload.analysis.message_count,
        payload.analysis.tool_use_count ?? null,
        payload.analysis.satisfaction.positive_signals,
        payload.analysis.satisfaction.negative_signals,
      ).run();

      const analysisId = analysisResult.meta.last_row_id;

      // Insert frictions
      for (const friction of payload.analysis.frictions) {
        await env.DB.prepare(`
          INSERT INTO frictions (analysis_id, type, category, severity, count)
          VALUES (?, ?, ?, ?, ?)
        `).bind(analysisId, friction.type, friction.category, friction.severity, friction.count).run();
      }

      // Cleanup old rate limit entries (fire-and-forget)
      cleanupOldWindows(env.DB).catch(() => {});

      return Response.json({ status: 'ok' }, { headers: CORS_HEADERS });
    } catch (err) {
      return Response.json(
        { error: 'Internal server error' },
        { status: 500, headers: CORS_HEADERS },
      );
    }
  },
};
