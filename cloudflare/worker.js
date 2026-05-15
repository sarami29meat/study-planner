// StudyPath Cloudflare Worker — Gemini API proxy
// Deploy: wrangler deploy
// Set secret: wrangler secret put GEMINI_API_KEY

const ALLOWED_ORIGIN = 'https://sarami29meat.github.io';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return json({ error: 'Server misconfiguration: API key not set' }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const { prompt } = body;
    if (!prompt || typeof prompt !== 'string') {
      return json({ error: 'Missing required field: prompt' }, 400, corsHeaders);
    }

    try {
      const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      const data = await geminiRes.json();

      if (!geminiRes.ok) {
        return json({ error: data.error?.message || `Gemini error ${geminiRes.status}` }, geminiRes.status, corsHeaders);
      }

      return json(data, 200, corsHeaders);
    } catch (e) {
      return json({ error: e.message }, 502, corsHeaders);
    }
  }
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
