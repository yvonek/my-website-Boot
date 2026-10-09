import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const tempDirectory = mkdtempSync(join(tmpdir(), 'rwanda-support-'));
const databasePath = join(tempDirectory, 'support.sqlite');
const port = 3117;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = 'support-conversation-test-admin';
let server;
let userCookie;
let adminCookie;
let adminId;
let conversationId;

async function request(path, options = {}, cookie) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { response, body: await response.json(), cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
}

before(async () => {
  const env = { ...process.env, DATABASE_PATH: databasePath, API_PORT: String(port), ADMIN_API_TOKEN: adminToken };
  execFileSync(process.execPath, ['backend/migrate.mjs'], { cwd: root, env, stdio: 'pipe' });
  server = spawn(process.execPath, ['backend/server.mjs'], { cwd: root, env, stdio: 'ignore' });
  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
    try { healthy = (await fetch(`${baseUrl}/api/health`)).ok; } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  assert.equal(healthy, true, 'test API should start');

  const admin = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Support Admin', phoneNumber: '0781234118', password: '123456' }) });
  assert.equal(admin.response.status, 201);
  const promoted = await request('/api/admin/members/role', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ phoneNumber: '0781234118', role: 'ADMIN' }) });
  assert.equal(promoted.response.status, 200);
  const adminLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber: '0781234118', password: '123456' }) });
  assert.equal(adminLogin.response.status, 200);
  adminCookie = adminLogin.cookie;
  adminId = adminLogin.body.user.id;

  const user = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Support User', phoneNumber: '0781234117', password: '123456' }) });
  assert.equal(user.response.status, 201);
  userCookie = user.cookie;

  const conversation = await request('/api/support/conversations', { method: 'POST' }, userCookie);
  assert.equal(conversation.response.status, 201);
  conversationId = conversation.body.conversation.id;
  const userMessage = await request(`/api/support/conversations/${conversationId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'I need help with my account.' }) }, userCookie);
  assert.equal(userMessage.response.status, 201);
});

after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((resolveExit) => server.once('exit', resolveExit)); }
  try { rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { }
});

test('Admin can read and reply to a user support conversation while access stays protected', async () => {
  assert.equal((await request(`/api/admin/support/conversations/${conversationId}/messages`)).response.status, 401);

  const unauthorizedReply = await request(`/api/admin/support/conversations/${conversationId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Unauthorized reply' }) }, userCookie);
  assert.equal(unauthorizedReply.response.status, 401);

  const adminInbox = await request('/api/admin/support/conversations', {}, adminCookie);
  assert.equal(adminInbox.response.status, 200);
  assert.ok(adminInbox.body.conversations.some((conversation) => conversation.id === conversationId));

  const loaded = await request(`/api/admin/support/conversations/${conversationId}/messages`, {}, adminCookie);
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.messages[0].body, 'I need help with my account.');

  const reply = await request(`/api/admin/support/conversations/${conversationId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'I can help with that.' }) }, adminCookie);
  assert.equal(reply.response.status, 201);
  assert.equal(reply.body.message.authorId, adminId);

  const userThread = await request(`/api/support/conversations/${conversationId}/messages`, {}, userCookie);
  assert.equal(userThread.response.status, 200);
  assert.equal(userThread.body.messages.length, 2);
  assert.equal(userThread.body.messages[1].body, 'I can help with that.');
});