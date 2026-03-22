import { TelemetryPayloadSchema } from './schema';

interface Env {
  DB: D1Database;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Only POST /v1/ingest
    if (request.method !== 'POST' || url.pathname !== '/v1/ingest') {
      return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS });
    }

    try {
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

      return Response.json({ status: 'ok' }, { headers: CORS_HEADERS });
    } catch (err) {
      return Response.json(
        { error: 'Internal server error' },
        { status: 500, headers: CORS_HEADERS },
      );
    }
  },
};
