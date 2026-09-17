import bcrypt from 'bcryptjs';

const encoder = new TextEncoder();
const API_PREFIX = '/api/';
const DEFAULT_SITE_URL = 'https://www.ezsportsnetting.com';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra
    }
  });
}

function now() { return new Date().toISOString(); }
function id(prefix) { return prefix + '_' + crypto.randomUUID().replaceAll('-', ''); }
function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }
function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function asArray(value) { return Array.isArray(value) ? value : []; }

function base64url(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(String(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64url(value) {
  const raw = String(value);
  const padded = raw.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((raw.length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
}

async function signToken(payload, env) {
  const secret = String(env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iss: 'ezsports', aud: 'ezsports-apps' }));
  const signature = base64url(new Uint8Array(await hmac(secret, header + '.' + body)));
  return header + '.' + body + '.' + signature;
}

async function verifyToken(token, env) {
  const secret = String(env.JWT_SECRET || '').trim();
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = new Uint8Array(await hmac(secret, parts[0] + '.' + parts[1]));
  const actual = fromBase64url(parts[2]);
  if (expected.length !== actual.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ actual[i];
  if (mismatch) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
    if (payload.iss !== 'ezsports' || payload.aud !== 'ezsports-apps') return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function tokenFromRequest(request) {
  const auth = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function currentUser(request, env) {
  const payload = await verifyToken(tokenFromRequest(request), env);
  if (!payload?.id) return null;
  return getRecord(env, 'users', payload.id);
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '').split(',').map(cleanEmail).filter(Boolean);
}

function isAdmin(user, env) {
  return Boolean(user && (user.isAdmin || user.role === 'admin' || adminEmails(env).includes(cleanEmail(user.email))));
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  return user ? { user } : { response: json({ message: 'Unauthorized' }, 401) };
}

async function requireAdmin(request, env) {
  const result = await requireUser(request, env);
  if (result.response) return result;
  return isAdmin(result.user, env)
    ? result
    : { response: json({ message: 'Forbidden' }, 403) };
}

function cookieHeader(token, maxAge = 604800) {
  return 'token=' + encodeURIComponent(token) + '; Max-Age=' + maxAge + '; Path=/; HttpOnly; Secure; SameSite=Lax';
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function db(env) {
  if (!env.DB) throw new Error('D1 binding DB is not configured');
  return env.DB;
}

async function getRecord(env, collection, recordId) {
  const row = await db(env).prepare('SELECT data FROM records WHERE collection = ? AND id = ?')
    .bind(collection, String(recordId)).first();
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

async function listRecords(env, collection) {
  const result = await db(env).prepare('SELECT data FROM records WHERE collection = ? ORDER BY created_at DESC')
    .bind(collection).all();
  return asArray(result.results).map(row => {
    try { return JSON.parse(row.data); } catch { return null; }
  }).filter(Boolean);
}

async function putRecord(env, collection, value) {
  const createdAt = value.createdAt || now();
  const record = {
    ...value,
    id: String(value.id || id(collection.slice(0, 4))),
    createdAt,
    updatedAt: value.updatedAt || now()
  };
  await db(env).prepare(
    'INSERT INTO records (collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ).bind(collection, record.id, JSON.stringify(record), record.createdAt, record.updatedAt).run();
  return record;
}

async function patchRecord(env, collection, recordId, patch) {
  const existing = await getRecord(env, collection, recordId);
  if (!existing) return null;
  return putRecord(env, collection, { ...existing, ...patch, id: existing.id, updatedAt: now() });
}

async function removeRecord(env, collection, recordId) {
  await db(env).prepare('DELETE FROM records WHERE collection = ? AND id = ?')
    .bind(collection, String(recordId)).run();
}

function findBy(items, key, value) {
  const target = String(value || '').toLowerCase();
  return items.find(item => String(item?.[key] || '').toLowerCase() === target) || null;
}

async function staticProducts(env) {
  try {
    const response = await env.ASSETS.fetch(new Request(siteUrl(env) + '/assets/prodList.json'));
    if (!response.ok) return [];
    const source = await response.json();
    const output = [];
    for (const [category, items] of Object.entries(source?.categories || {})) {
      for (const item of asArray(items)) {
        const raw = item.details?.price ?? item.price ?? item.map ?? item.variations?.[0]?.map ?? 0;
        const match = typeof raw === 'string' ? raw.match(/-?\d+(?:\.\d+)?/) : null;
        const price = typeof raw === 'string' ? asNumber(match?.[0]) : asNumber(raw);
        output.push({
          id: String(item.sku || item.id || id('prod')),
          title: item.name || item.title || item.sku,
          name: item.name || item.title || item.sku,
          price,
          category: String(category).toLowerCase(),
          img: item.stripeImg || item.img || item.image || 'assets/img/EZSportslogo.png',
          images: asArray(item.stripeImages).length ? item.stripeImages : asArray(item.images),
          description: item.details?.description || item.description || '',
          features: asArray(item.details?.features || item.features),
          variations: asArray(item.variations),
          stock: item.stock ?? 10,
          isActive: true
        });
      }
    }
    return output;
  } catch { return []; }
}

async function products(env) {
  const stored = await listRecords(env, 'products');
  return stored.length ? stored : staticProducts(env);
}

function normalizeItems(items, catalog) {
  return asArray(items).map(item => {
    const product = catalog.find(p => String(p.id) === String(item.id || item.productId));
    const quantity = Math.max(1, Math.floor(asNumber(item.qty ?? item.quantity, 1)));
    return {
      id: String(item.id || item.productId || product?.id || ''),
      productId: String(item.productId || item.id || product?.id || ''),
      name: item.name || item.title || product?.name || product?.title || item.id || 'Item',
      productName: item.name || item.title || product?.name || product?.title || item.id || 'Item',
      price: asNumber(product?.price ?? item.price),
      qty: quantity,
      quantity,
      ship: asNumber(item.ship ?? item.shipAmount, 100),
      size: item.size || '',
      color: item.color || '',
      category: item.category || product?.category || ''
    };
  }).filter(item => item.id);
}

function calculateTotals(items, address, coupon) {
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const shipping = items.reduce((sum, item) => {
    const accessory = /accessor|cable|twine|rope|vinyl|padding|basket|batting\s*mat/i.test(item.category + ' ' + item.name);
    if (accessory) return sum;
    const perItem = item.ship === 0 ? 0 : (item.ship > 0 ? item.ship : 100);
    return sum + Math.round(perItem * 100) * item.quantity;
  }, 0);
  const gross = subtotal + shipping;
  let discount = 0;
  if (coupon?.type === 'percent') discount = Math.min(gross, Math.round(gross * asNumber(coupon.value) / 100));
  if (coupon?.type === 'fixed') discount = Math.min(gross, Math.round(asNumber(coupon.value) * 100));
  const state = String(address?.state || '').trim().toUpperCase();
  const tax = String(address?.country || 'US').toUpperCase() === 'US' && state === 'GA'
    ? Math.round(Math.max(0, gross - discount) * 0.07) : 0;
  return { subtotal, shipping, discount, tax, total: Math.max(0, gross - discount + tax) };
}

async function resend(env, payload) {
  const key = String(env.RESEND_API_KEY || '').trim();
  if (!key) return { ok: false, status: 0, error: 'RESEND_API_KEY is not configured' };
  const body = {
    from: String(env.RESEND_FROM || 'EZ Sports Netting <orders@ezsportsnetting.com>'),
    to: asArray(payload.to).length ? payload.to : [payload.to],
    subject: String(payload.subject || 'EZ Sports Netting'),
    html: payload.html || '<p>' + String(payload.text || '').replaceAll('\n', '<br>') + '</p>',
    ...(payload.text ? { text: payload.text } : {}),
    ...(payload.replyTo ? { reply_to: payload.replyTo } : {})
  };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, ...result };
}

async function logEmail(env, payload, result) {
  try {
    const recipients = Array.isArray(payload.to) ? payload.to.join(', ') : String(payload.to || '');
    await putRecord(env, 'emails', {
      to: recipients,
      subject: payload.subject,
      status: result.ok ? 'sent' : 'failed',
      provider: 'resend',
      providerId: result.id || null,
      error: result.ok ? null : result.error || result.message || 'Send failed',
      sentAt: result.ok ? now() : null
    });
  } catch {}
}

async function sendAndLog(env, payload) {
  const result = await resend(env, payload);
  await logEmail(env, payload, result);
  return result;
}

async function verifyTurnstile(request, env, body) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  const token = String(body?.turnstileToken || body?.cfTurnstileToken || '').trim();
  if (!secret || !token) return !secret;
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    form.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return Boolean((await response.json())?.success);
  } catch { return false; }
}

async function handleUsers(request, env, path) {
  const body = await readBody(request);
  if (path === '/api/users/register' && request.method === 'POST') {
    if (!(await verifyTurnstile(request, env, body))) return json({ message: 'Verification failed' }, 400);
    const email = cleanEmail(body.email);
    const username = String(body.username || email.split('@')[0] || '').trim();
    const password = String(body.password || '');
    if (!email || !email.includes('@') || password.length < 8) return json({ message: 'A valid email and password of at least 8 characters are required' }, 400);
    const all = await listRecords(env, 'users');
    if (findBy(all, 'email', email) || findBy(all, 'username', username)) return json({ message: 'User already exists' }, 409);
    const user = {
      id: id('usr'), email, username, name: String(body.name || username),
      password: await bcrypt.hash(password, 10), isAdmin: false, role: 'customer', addresses: []
    };
    await putRecord(env, 'users', user);
    const token = await signToken({ id: user.id, email: user.email, isAdmin: false, exp: Math.floor(Date.now() / 1000) + 604800 }, env);
    const { password: _, ...publicUser } = user;
    return json({ user: publicUser, token }, 201, { 'Set-Cookie': cookieHeader(token) });
  }
  if (path === '/api/users/login' && request.method === 'POST') {
    const identity = String(body.email || body.username || '').trim().toLowerCase();
    const users = await listRecords(env, 'users');
    const user = users.find(item => cleanEmail(item.email) === identity || String(item.username || '').toLowerCase() === identity);
    if (!user || !(await bcrypt.compare(String(body.password || ''), String(user.password || '')))) return json({ message: 'Invalid email or password' }, 401);
    const admin = isAdmin(user, env);
    const token = await signToken({ id: user.id, email: user.email, isAdmin: admin, exp: Math.floor(Date.now() / 1000) + 604800 }, env);
    const { password: _, ...publicUser } = { ...user, isAdmin: admin };
    return json({ user: publicUser, token }, 200, { 'Set-Cookie': cookieHeader(token) });
  }
  if (path === '/api/users/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });
  if (path === '/api/users/me' && request.method === 'GET') {
    const result = await requireUser(request, env); if (result.response) return result.response;
    const { password: _, ...publicUser } = result.user; return json({ user: publicUser });
  }
  if (path === '/api/users/admin/all' && request.method === 'GET') {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    return json((await listRecords(env, 'users')).map(({ password, ...user }) => user));
  }
  if (path === '/api/users/me/addresses') {
    const result = await requireUser(request, env); if (result.response) return result.response;
    if (request.method === 'GET') return json({ addresses: asArray(result.user.addresses) });
    if (request.method === 'POST') {
      const address = { ...body, id: body.id || id('addr'), isDefault: Boolean(body.isDefault) };
      const addresses = asArray(result.user.addresses).map(item => address.isDefault ? { ...item, isDefault: false } : item);
      addresses.push(address);
      await patchRecord(env, 'users', result.user.id, { addresses });
      return json({ addresses });
    }
  }
  return json({ message: 'User route not found' }, 404);
}

async function handleProducts(request, env, path) {
  const catalog = await products(env);
  if (path === '/api/products' && request.method === 'GET') return json(catalog.filter(p => p.isActive !== false));
  const match = path.match(/^\/api\/products\/([^/]+)$/);
  if ((path === '/api/products' && request.method === 'POST') || (match && ['PUT', 'DELETE'].includes(request.method))) {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    if (request.method === 'POST') return json(await putRecord(env, 'products', await readBody(request)), 201);
    const productId = decodeURIComponent(match[1]);
    if (request.method === 'DELETE') { await removeRecord(env, 'products', productId); return json({ ok: true }); }
    return json(await patchRecord(env, 'products', productId, await readBody(request)) || { message: 'Product not found' }, 200);
  }
  return json({ message: 'Product route not found' }, 404);
}

async function handleMarketing(request, env, path) {
  const body = await readBody(request);
  if (path === '/api/marketing/subscribe' && request.method === 'POST') {
    if (!(await verifyTurnstile(request, env, body))) return json({ message: 'Verification failed' }, 400);
    const email = cleanEmail(body.email);
    if (!email || !email.includes('@')) return json({ message: 'Valid email required' }, 400);
    const existing = findBy(await listRecords(env, 'subscribers'), 'email', email);
    const subscriber = await putRecord(env, 'subscribers', { ...(existing || {}), email, name: String(body.name || existing?.name || ''), active: true, subscribedAt: existing?.subscribedAt || now() });
    if (env.SEND_WELCOME_EMAIL === 'true') await sendAndLog(env, { to: email, subject: 'Welcome to EZ Sports Netting', text: 'Thanks for subscribing to EZ Sports Netting.' });
    return json({ ok: true, subscriber });
  }
  if (path === '/api/marketing/unsubscribe' && request.method === 'POST') {
    const email = cleanEmail(body.email);
    const existing = findBy(await listRecords(env, 'subscribers'), 'email', email);
    if (existing) await patchRecord(env, 'subscribers', existing.id, { active: false, unsubscribedAt: now() });
    return json({ ok: true });
  }
  if (path === '/api/marketing/contact' && request.method === 'POST') {
    if (!(await verifyTurnstile(request, env, body))) return json({ message: 'Verification failed' }, 400);
    const to = String(env.CONTACT_INBOX || 'info@ezsportsnetting.com').trim();
    const subject = 'Website contact: ' + String(body.subject || 'General inquiry').slice(0, 160);
    const text = 'Name: ' + (body.name || '') + '\nEmail: ' + (body.email || '') + '\n\n' + (body.message || body.text || '');
    const sent = await sendAndLog(env, { to, subject, text, replyTo: cleanEmail(body.email) || undefined });
    return sent.ok ? json({ ok: true }) : json({ ok: false, message: 'Message could not be sent' }, 502);
  }
  if (path === '/api/marketing/validate-coupon' && request.method === 'POST') {
    const code = String(body.code || '').trim().toUpperCase();
    const coupon = findBy(await listRecords(env, 'coupons'), 'code', code);
    const valid = Boolean(coupon && coupon.active !== false && (!coupon.expiresAt || new Date(coupon.expiresAt) > new Date()) && (!coupon.maxUses || asNumber(coupon.uses) < asNumber(coupon.maxUses)));
    return json(valid ? { valid: true, coupon: { code: coupon.code, type: coupon.type, value: coupon.value }, ...coupon } : { valid: false, reason: coupon ? 'inactive' : 'not_found' });
  }
  if (path.startsWith('/api/marketing/admin/')) {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    if (path === '/api/marketing/admin/subscribers') return json((await listRecords(env, 'subscribers')).filter(s => new URL(request.url).searchParams.get('activeOnly') !== 'true' || s.active !== false));
    if (path === '/api/marketing/admin/coupons' && request.method === 'GET') return json(await listRecords(env, 'coupons'));
    if (path === '/api/marketing/admin/coupons' && request.method === 'POST') return json(await putRecord(env, 'coupons', { ...body, code: String(body.code || '').trim().toUpperCase(), active: true, uses: 0 }), 201);
    const couponMatch = path.match(/^\/api\/marketing\/admin\/coupons\/([^/]+)\/deactivate$/);
    if (couponMatch && request.method === 'POST') {
      const coupon = findBy(await listRecords(env, 'coupons'), 'code', decodeURIComponent(couponMatch[1]));
      if (coupon) await patchRecord(env, 'coupons', coupon.id, { active: false });
      return json({ ok: true });
    }
    if (path === '/api/marketing/admin/newsletter' && request.method === 'POST') {
      const subscribers = (await listRecords(env, 'subscribers')).filter(s => s.active !== false);
      const sent = [];
      for (const subscriber of subscribers.slice(0, 250)) sent.push(await sendAndLog(env, { to: subscriber.email, subject: body.subject, html: body.html, text: body.text }));
      return json({ ok: sent.every(item => item.ok), attempted: sent.length, sent: sent.filter(item => item.ok).length });
    }
  }
  return json({ message: 'Marketing route not found' }, 404);
}

async function stripeRequest(env, endpoint, params) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key) throw new Error('Stripe is not configured');
  const form = new URLSearchParams();
  for (const [keyName, value] of Object.entries(params || {})) form.set(keyName, String(value));
  const response = await fetch('https://api.stripe.com/v1/' + endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe request failed');
  return data;
}

async function handleOrders(request, env, path) {
  if ((path === '/api/order' || path === '/api/orders') && request.method === 'POST') {
    const body = await readBody(request);
    const items = normalizeItems(body.items, await products(env));
    const address = body.shipping || body.shippingAddress || {};
    const totals = calculateTotals(items, address, body.coupon);
    const order = await putRecord(env, 'orders', {
      id: body.existingOrderId || id('ord'), items, customerInfo: body.customer || {},
      userEmail: cleanEmail(body.customer?.email), shippingAddress: address, ...totals,
      subtotal: totals.subtotal / 100, shipping: totals.shipping / 100,
      discount: totals.discount / 100, tax: totals.tax / 100, total: totals.total / 100,
      status: 'pending', paymentInfo: {}
    });
    return json({ ...order, orderId: order.id }, 201);
  }
  if (path === '/api/orders/me' && request.method === 'GET') {
    const result = await requireUser(request, env); if (result.response) return result.response;
    return json((await listRecords(env, 'orders')).filter(order => order.userId === result.user.id || cleanEmail(order.userEmail) === cleanEmail(result.user.email)));
  }
  if (path === '/api/orders/public/by-email' && request.method === 'GET') {
    const email = cleanEmail(new URL(request.url).searchParams.get('email'));
    if (!email) return json({ message: 'Email required' }, 400);
    return json((await listRecords(env, 'orders')).filter(order => cleanEmail(order.userEmail || order.customerInfo?.email) === email));
  }
  if (path === '/api/orders/admin/all' && request.method === 'GET') {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    return json(await listRecords(env, 'orders'));
  }
  const match = path.match(/^\/api\/orders\/([^/]+)(?:\/status)?$/);
  if (match && request.method === 'PATCH' && path.endsWith('/status')) {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    const order = await patchRecord(env, 'orders', decodeURIComponent(match[1]), await readBody(request));
    return order ? json(order) : json({ message: 'Order not found' }, 404);
  }
  if (match && request.method === 'GET') {
    const order = await getRecord(env, 'orders', decodeURIComponent(match[1]));
    return order ? json(order) : json({ message: 'Order not found' }, 404);
  }
  return json({ message: 'Order route not found' }, 404);
}

async function handleAnalytics(request, env, path) {
  if (path === '/api/analytics/track' || path === '/api/analytics/event') {
    if (request.method !== 'POST') return json({ message: 'Method not allowed' }, 405);
    const body = await readBody(request);
    await putRecord(env, 'analytics', { ...body, eventName: body.eventName || body.type || 'page_view', path: body.path || new URL(request.url).pathname });
    return json({ ok: true });
  }
  if (path.startsWith('/api/analytics/admin/')) {
    const result = await requireAdmin(request, env); if (result.response) return result.response;
    const rows = await listRecords(env, 'analytics');
    return json({ totalEvents: rows.length, events: rows.slice(0, 500) });
  }
  return json({ message: 'Analytics route not found' }, 404);
}

async function handleAdmin(request, env, path) {
  const result = await requireAdmin(request, env); if (result.response) return result.response;
  if (path === '/api/admin/diagnostics') return json({ ok: true, runtime: 'cloudflare-workers', database: Boolean(env.DB), emailProvider: 'resend', stripe: Boolean(env.STRIPE_SECRET_KEY) });
  if (path === '/api/admin/reports/daily/send' && request.method === 'POST') return json({ ok: true, message: 'Daily reports are sent by the scheduled Worker.' });
  if (path === '/api/admin/emails' && request.method === 'GET') return json(await listRecords(env, 'emails'));
  if (path === '/api/admin/errors' && request.method === 'GET') return json(await listRecords(env, 'errors'));
  if (path === '/api/admin/netting-config' && request.method === 'GET') {
    const stored = await getRecord(env, 'settings', 'netting-config');
    if (stored?.value) return json(stored.value);
    const response = await env.ASSETS.fetch(new Request(siteUrl(env) + '/assets/netting.json'));
    return response.ok ? new Response(await response.text(), { headers: { 'Content-Type': 'application/json' } }) : json({ version: 1, defaults: {}, meshPrices: [] });
  }
  if (path === '/api/admin/netting-config' && request.method === 'PUT') {
    const value = await readBody(request);
    await putRecord(env, 'settings', { id: 'netting-config', value, updatedAt: now() });
    return json(value);
  }
  if (path === '/api/admin/products/sync' && request.method === 'POST') return json({ ok: true, message: 'Products are read from D1 and the static catalog. Use the JSON-to-SQL import script for a bulk catalog refresh.', discovered: 0, wrote: 0 });
  if (path === '/api/admin/prodlist/bulk-update' && request.method === 'POST') return json({ ok: true, changed: 0, message: 'Bulk source-file edits are disabled in Workers; update D1 records instead.' });
  if (path === '/api/admin/stripe/summary' || path === '/api/admin/stripe/payouts-local' || path === '/api/admin/stripe/invoices') return json({ items: [], summary: { gross: 0, refunds: 0, fees: 0, net: 0 }, message: 'Stripe reporting can be added with the Stripe API credentials.' });
  return json({ message: 'Admin route not found' }, 404);
}

async function handleErrors(request, env, path) {
  if (path === '/api/errors/report' && request.method === 'POST') {
    await putRecord(env, 'errors', await readBody(request));
    return json({ ok: true });
  }
  return json({ message: 'Error route not found' }, 404);
}

async function createPaymentIntent(request, env) {
  const body = await readBody(request);
  const items = normalizeItems(body.items, await products(env));
  const address = body.shipping || {};
  let coupon = null;
  if (body.couponCode) coupon = findBy(await listRecords(env, 'coupons'), 'code', String(body.couponCode).trim().toUpperCase());
  const totals = calculateTotals(items, address, coupon);
  const order = await putRecord(env, 'orders', {
    id: body.existingOrderId || id('ord'), items, customerInfo: body.customer || {},
    userEmail: cleanEmail(body.customer?.email), shippingAddress: address, ...totals,
    subtotal: totals.subtotal / 100, shipping: totals.shipping / 100,
    discount: totals.discount / 100, tax: totals.tax / 100, total: totals.total / 100,
    status: 'pending', paymentInfo: {}
  });
  const intent = await stripeRequest(env, 'payment_intents', {
    amount: totals.total, currency: 'usd', 'automatic_payment_methods[enabled]': 'true',
    receipt_email: cleanEmail(body.customer?.email), 'metadata[order_id]': order.id,
    'metadata[email]': cleanEmail(body.customer?.email), 'metadata[coupon_code]': coupon?.code || ''
  });
  return json({ clientSecret: intent.client_secret, amount: totals.total, orderId: order.id, breakdown: totals, couponApplied: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null });
}

async function stripeWebhook(request, env) {
  const raw = await request.text();
  const signature = request.headers.get('Stripe-Signature') || '';
  const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return json({ message: 'Webhook secret is not configured' }, 503);
  const timestamp = signature.match(/t=(\d+)/)?.[1];
  const sig = signature.match(/v1=([a-f0-9]+)/)?.[1];
  if (!timestamp || !sig || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return json({ message: 'Invalid webhook signature' }, 400);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + raw)));
  const expected = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (expected !== sig) return json({ message: 'Invalid webhook signature' }, 400);
  let event; try { event = JSON.parse(raw); } catch { return json({ message: 'Invalid webhook JSON' }, 400); }
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data?.object || {};
    const orderId = intent.metadata?.order_id;
    if (orderId) {
      const order = await patchRecord(env, 'orders', orderId, {
        status: 'paid',
        paymentInfo: { status: 'paid', intentId: intent.id, amount: asNumber(intent.amount) / 100, currency: intent.currency, method: 'stripe', paidAt: now() }
      });
      const customerEmail = cleanEmail(intent.receipt_email || intent.metadata?.email || order?.userEmail);
      if (customerEmail) await sendAndLog(env, { to: customerEmail, subject: 'EZ Sports Netting order ' + orderId, text: 'Thank you for your order. Your order ' + orderId + ' has been received.' });
      if (env.ORDER_NOTIFY_TO) await sendAndLog(env, { to: env.ORDER_NOTIFY_TO, subject: 'New paid EZ Sports Netting order ' + orderId, text: 'Order ' + orderId + ' was paid by ' + (customerEmail || 'customer') + '.' });
    }
  }
  return json({ received: true });
}

function siteUrl(env) { return String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, ''); }

async function staticResponse(request, env) {
  const url = new URL(request.url);
  const aliases = { '/bats.html': '/index.html#catalog', '/gloves.html': '/index.html#catalog', '/helmets.html': '/index.html#catalog' };
  if (aliases[url.pathname]) return Response.redirect(siteUrl(env) + aliases[url.pathname], 301);
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && (url.pathname === '/' || url.pathname === '')) response = await env.ASSETS.fetch(new Request(url.origin + '/index.html', request));
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (url.pathname === '/' || /\.html$/i.test(url.pathname)) headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleApi(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/health') return json({ ok: true, service: 'ezsportsnetting', runtime: 'cloudflare-workers', time: now() });
  if (path === '/api/config') return json({ enabled: Boolean(env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_SECRET_KEY), pk: env.STRIPE_PUBLISHABLE_KEY || null, maintenance: String(env.MAINTENANCE || '').toLowerCase() === 'true' });
  if (path === '/api/maps-config') return json({ googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || null });
  if (path === '/api/create-payment-intent' && request.method === 'POST') { try { return await createPaymentIntent(request, env); } catch (error) { return json({ error: error.message || 'Payment setup failed' }, 502); } }
  if (path.startsWith('/api/users')) { try { return await handleUsers(request, env, path); } catch (error) { return json({ message: error.message || 'User request failed' }, 500); } }
  if (path.startsWith('/api/products')) { try { return await handleProducts(request, env, path); } catch (error) { return json({ message: error.message || 'Product request failed' }, 500); } }
  if (path.startsWith('/api/marketing')) { try { return await handleMarketing(request, env, path); } catch (error) { return json({ message: error.message || 'Marketing request failed' }, 500); } }
  if (path === '/api/order' || path.startsWith('/api/orders')) { try { return await handleOrders(request, env, path); } catch (error) { return json({ message: error.message || 'Order request failed' }, 500); } }
  if (path.startsWith('/api/analytics')) { try { return await handleAnalytics(request, env, path); } catch (error) { return json({ message: error.message || 'Analytics request failed' }, 500); } }
  if (path.startsWith('/api/admin')) { try { return await handleAdmin(request, env, path); } catch (error) { return json({ message: error.message || 'Admin request failed' }, 500); } }
  if (path.startsWith('/api/errors')) { try { return await handleErrors(request, env, path); } catch (error) { return json({ message: error.message || 'Error report failed' }, 500); } }
  return json({ message: 'API route not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'ezsportsnetting.com') return Response.redirect(siteUrl(env) + url.pathname + url.search, 301);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': url.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '86400' } });
      if (url.pathname === '/webhook/stripe') return await stripeWebhook(request, env);
      if (url.pathname.startsWith(API_PREFIX) || url.pathname === '/health') return await handleApi(request, env);
      return await staticResponse(request, env);
    } catch (error) {
      console.error('Unhandled Worker error', error);
      return json({ message: 'Internal server error', requestId: id('req') }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    if (String(env.DAILY_REPORT_ENABLED || '').toLowerCase() !== 'true' || !env.ALERT_EMAIL_TO) return;
    ctx.waitUntil((async () => {
      const rows = await listRecords(env, 'analytics');
      await sendAndLog(env, { to: env.ALERT_EMAIL_TO, subject: 'EZ Sports Netting daily activity report', text: 'Tracked events in the current database: ' + rows.length });
    })());
  }
};
