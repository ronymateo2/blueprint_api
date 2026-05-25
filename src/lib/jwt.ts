export interface JwtPayload {
  sub: string;
  email: string;
  timezone: string;
  iat: number;
  exp: number;
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + 60 * 60 * 24 * 30 };
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const [headerB64, body, sig] = parts;

  // Validate header alg/typ before trusting any payload
  const headerJson = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
  if (headerJson.alg !== 'HS256' || headerJson.typ !== 'JWT') throw new Error('Invalid JWT algorithm');

  const key = await getKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(sig),
    new TextEncoder().encode(`${headerB64}.${body}`),
  );
  if (!valid) throw new Error('Invalid JWT signature');

  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('JWT expired');
  // Reject tokens issued more than 60s in the future (clock skew guard)
  if (payload.iat > now + 60) throw new Error('JWT issued in the future');
  return payload;
}
