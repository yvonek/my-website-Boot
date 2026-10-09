const hopByHopHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  const backendUrl = process.env.BACKEND_API_URL;
  if (!backendUrl) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Backend API is not configured. Set BACKEND_API_URL in Vercel.' }));
    return;
  }

  try {
    const incoming = new URL(request.url ?? '/api', 'http://localhost');
    const rewrittenPath = incoming.searchParams.get('__proxy_path');
    if (rewrittenPath !== null && (rewrittenPath.startsWith('/') || rewrittenPath.split('/').some((segment) => segment === '..'))) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'Invalid API path.' }));
      return;
    }
    const pathname = rewrittenPath === null ? incoming.pathname : `/api/${rewrittenPath}`;
    incoming.searchParams.delete('__proxy_path');
    const query = incoming.searchParams.toString();
    const target = new URL(`${pathname}${query ? `?${query}` : ''}`, backendUrl);
    const headers = new Headers();
    for (const [name, rawValue] of Object.entries(request.headers)) {
      if (name.toLowerCase() === 'host' || hopByHopHeaders.has(name.toLowerCase()) || rawValue === undefined) continue;
      headers.set(name, Array.isArray(rawValue) ? rawValue.join(', ') : rawValue);
    }

    const method = request.method ?? 'GET';
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, { method, headers, body });
    response.statusCode = upstream.status;
    for (const [name, value] of upstream.headers) {
      if (name.toLowerCase() !== 'set-cookie' && !hopByHopHeaders.has(name.toLowerCase())) response.setHeader(name, value);
    }
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length) response.setHeader('Set-Cookie', cookies);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: error instanceof Error ? `Backend API request failed: ${error.message}` : 'Backend API request failed.' }));
  }
}