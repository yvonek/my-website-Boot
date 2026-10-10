const baseUrl = (process.argv[2] ?? process.env.NEON_FUNCTION_URL ?? '').replace(/\/+$/, '');
if (!baseUrl) throw new Error('Pass the Neon Function URL as the first argument or set NEON_FUNCTION_URL.');

for (const path of ['/api/health', '/api/public/countries?mode=login']) {
  const response = await fetch(`${baseUrl}${path}`);
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.json();
  console.log(JSON.stringify({ path, status: response.status, contentType, keys: Object.keys(body), countryCount: body.countries?.length }));
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
}

const phoneNumber = `07${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
const credentials = { fullName: 'Neon Rehearsal Smoke', phoneNumber, countryCode: 'RW', password: '123456' };
const registration = await fetch(`${baseUrl}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(credentials),
});
const registrationBody = await registration.json();
if (registration.status !== 201) throw new Error(`Registration smoke test returned HTTP ${registration.status}: ${registrationBody.error}`);

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(credentials),
});
const loginBody = await login.json();
if (login.status !== 200 || loginBody.user?.id !== registrationBody.user?.id) throw new Error(`Login smoke test returned HTTP ${login.status}: ${loginBody.error ?? 'wrong user'}`);

const cookie = login.headers.getSetCookie().find((value) => value.startsWith('rw_session='))?.split(';', 1)[0];
if (!cookie) throw new Error('Login did not return the rw_session cookie.');
const session = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
const sessionBody = await session.json();
const sessionHasUser = Boolean(sessionBody.user);
const sessionMatches = sessionBody.user?.id === registrationBody.user.id;
console.log(JSON.stringify({ registration: registration.status, login: login.status, sessionRestore: session.status, sessionHasUser, sessionMatches }));
if (session.status !== 200 || !sessionMatches) throw new Error('Cookie-based session restore did not return the registered user.');
