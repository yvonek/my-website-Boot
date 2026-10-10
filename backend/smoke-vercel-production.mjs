const baseUrl = (process.argv[2] ?? 'https://my-website-boot-7eqw.vercel.app').replace(/\/+$/, '');

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') ?? '';
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`${path} returned non-JSON content (${response.status}, ${contentType}).`); }
  return { response, contentType, body };
}

const health = await request('/api/health');
if (!health.response.ok || health.body.status !== 'ok') throw new Error('/api/health did not return status=ok.');
console.log(JSON.stringify({ path: '/api/health', status: health.response.status, workflow: health.body.workflow }));

const countries = await request('/api/public/countries?mode=login');
if (!countries.response.ok || !Array.isArray(countries.body.countries) || countries.body.countries.length !== 3) throw new Error('Country list did not return the three supported countries.');
console.log(JSON.stringify({ path: '/api/public/countries', status: countries.response.status, count: countries.body.countries.length }));

const session = await request('/api/auth/me');
if (!session.response.ok || session.body.user !== null) throw new Error('Unauthenticated session check did not return user=null.');
console.log(JSON.stringify({ path: '/api/auth/me', status: session.response.status, user: null }));

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '0780000000', countryCode: 'RW', password: '000000' }),
});
if (login.response.status !== 401 || !login.body.error) throw new Error(`Invalid-credential login returned unexpected HTTP ${login.response.status}.`);
console.log(JSON.stringify({ path: '/api/auth/login', status: login.response.status, jsonError: true }));
