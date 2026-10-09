import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/[...path].js';

function createRequest({ url, method = 'GET', headers = {}, body = '' }) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { url, method, headers });
  return request;
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = Buffer.isBuffer(body) ? body.toString() : String(body); },
  };
}

test('Vercel API proxy returns a JSON setup error when no backend is configured', async () => {
  const originalBackendUrl = process.env.BACKEND_API_URL;
  delete process.env.BACKEND_API_URL;
  try {
    const response = createResponse();
    await handler(createRequest({ url: '/api/auth/login', method: 'POST' }), response);
    assert.equal(response.statusCode, 503);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.match(JSON.parse(response.body).error, /BACKEND_API_URL/);
  } finally {
    if (originalBackendUrl === undefined) delete process.env.BACKEND_API_URL;
    else process.env.BACKEND_API_URL = originalBackendUrl;
  }
});

test('Vercel API proxy forwards paths, JSON bodies, cookies, and upstream sessions', async () => {
  const originalBackendUrl = process.env.BACKEND_API_URL;
  const originalFetch = globalThis.fetch;
  const requests = [];
  process.env.BACKEND_API_URL = 'https://account-api.example.test';
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', 'rw_session=test-session; Path=/; HttpOnly; SameSite=Lax; Secure');
    return new Response('{"user":{"id":"user-1"}}', { status: 200, headers });
  };

  try {
    const response = createResponse();
    await handler(createRequest({
      url: '/api/auth/login?mode=phone',
      method: 'POST',
      headers: { host: 'frontend.example.test', cookie: 'rw_session=old-session', 'content-type': 'application/json' },
      body: '{"phoneNumber":"0780000000","password":"123456"}',
    }), response);

    assert.equal(requests[0].url, 'https://account-api.example.test/api/auth/login?mode=phone');
    assert.equal(requests[0].options.headers.get('cookie'), 'rw_session=old-session');
    assert.equal(requests[0].options.headers.get('host'), null);
    assert.equal(requests[0].options.body.toString(), '{"phoneNumber":"0780000000","password":"123456"}');
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).user.id, 'user-1');
    assert.match(response.headers['set-cookie'][0], /rw_session=test-session/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBackendUrl === undefined) delete process.env.BACKEND_API_URL;
    else process.env.BACKEND_API_URL = originalBackendUrl;
  }
});