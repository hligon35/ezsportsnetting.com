const TRACKING_SCHEMA_VERSION = 2;
const TRACKING_SOURCE = 'web_client';
const STORAGE_KEYS = {
  visitorId: 'eztrack.visitorId',
  sessionId: 'eztrack.sessionId',
  identity: 'eztrack.identity',
  firstTouch: 'eztrack.firstTouch',
  lastTouch: 'eztrack.lastTouch',
  dedupe: 'eztrack.dedupe',
  checkoutPending: 'eztrack.checkoutPending',
  completedPurchases: 'eztrack.completedPurchases'
};

const API_BASES = (() => {
  const bases = [];
  try {
    if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, ''));
  } catch {}
  try {
    const meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) bases.push(String(meta.content).replace(/\/$/, ''));
  } catch {}
  if (location.protocol.startsWith('http')) bases.push(`${location.protocol}//${location.host}`);
  ['127.0.0.1', 'localhost'].forEach(host => {
    [4243, 4242, 4244, 4245, 4246, 4247].forEach(port => {
      bases.push(`http://${host}:${port}`);
    });
  });
  return Array.from(new Set(bases.filter(Boolean)));
})();

function nowIso() {
  return new Date().toISOString();
}

function readStorage(kind, key, fallback = null) {
  try {
    const bucket = kind === 'session' ? sessionStorage : localStorage;
    const raw = bucket.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(kind, key, value) {
  try {
    const bucket = kind === 'session' ? sessionStorage : localStorage;
    bucket.setItem(key, JSON.stringify(value));
  } catch {}
}

function readText(kind, key) {
  try {
    const bucket = kind === 'session' ? sessionStorage : localStorage;
    return bucket.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeText(kind, key, value) {
  try {
    const bucket = kind === 'session' ? sessionStorage : localStorage;
    bucket.setItem(key, String(value || ''));
  } catch {}
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase() || null;
}

function pickUserId() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (currentUser && currentUser.id !== undefined && currentUser.id !== null) return String(currentUser.id);
  } catch {}
  return null;
}

function getVisitorId() {
  let visitorId = readText('local', STORAGE_KEYS.visitorId);
  if (!visitorId) {
    visitorId = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    writeText('local', STORAGE_KEYS.visitorId, visitorId);
  }
  return visitorId;
}

function getSessionId() {
  let sessionId = readText('session', STORAGE_KEYS.sessionId);
  if (!sessionId) {
    sessionId = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    writeText('session', STORAGE_KEYS.sessionId, sessionId);
  }
  return sessionId;
}

async function hashEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    if (crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `fallback_${Math.abs(hash)}`;
}

function parseAttribution() {
  const params = new URLSearchParams(location.search);
  const payload = {
    landingPath: `${location.pathname}${location.search}`,
    referrer: document.referrer || '',
    utmSource: params.get('utm_source') || '',
    utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || '',
    utmContent: params.get('utm_content') || '',
    utmTerm: params.get('utm_term') || '',
    gclid: params.get('gclid') || '',
    fbclid: params.get('fbclid') || '',
    msclkid: params.get('msclkid') || ''
  };
  const hasCampaignData = Object.values(payload).some(Boolean);
  return hasCampaignData ? payload : { landingPath: `${location.pathname}${location.search}`, referrer: document.referrer || '' };
}

function updateAttribution() {
  const current = parseAttribution();
  const firstTouch = readStorage('local', STORAGE_KEYS.firstTouch, null);
  if (!firstTouch) {
    writeStorage('local', STORAGE_KEYS.firstTouch, { ...current, capturedAt: nowIso() });
  }
  writeStorage('local', STORAGE_KEYS.lastTouch, { ...current, capturedAt: nowIso() });
  return {
    firstTouch: readStorage('local', STORAGE_KEYS.firstTouch, null),
    lastTouch: readStorage('local', STORAGE_KEYS.lastTouch, null)
  };
}

function getIdentity() {
  return readStorage('local', STORAGE_KEYS.identity, {});
}

async function identify(identityPatch = {}) {
  const current = getIdentity();
  const next = {
    ...current,
    visitorId: current.visitorId || getVisitorId(),
    sessionId: getSessionId(),
    userId: identityPatch.userId !== undefined && identityPatch.userId !== null
      ? String(identityPatch.userId)
      : (current.userId || pickUserId() || null),
    email: normalizeEmail(identityPatch.email || current.email || null),
    name: String(identityPatch.name || current.name || '').trim() || null,
    phone: String(identityPatch.phone || current.phone || '').trim() || null,
    source: String(identityPatch.source || current.source || TRACKING_SOURCE),
    updatedAt: nowIso()
  };
  next.emailHash = next.email ? await hashEmail(next.email) : (current.emailHash || null);
  writeStorage('local', STORAGE_KEYS.identity, next);
  return next;
}

function getCompletedPurchases() {
  return readStorage('local', STORAGE_KEYS.completedPurchases, {});
}

function markPurchaseCompleted(orderId, paymentIntentId = null) {
  if (!orderId && !paymentIntentId) return;
  const purchases = getCompletedPurchases();
  const key = String(orderId || paymentIntentId);
  purchases[key] = { orderId: orderId || null, paymentIntentId: paymentIntentId || null, completedAt: nowIso() };
  writeStorage('local', STORAGE_KEYS.completedPurchases, purchases);
  try { localStorage.removeItem(STORAGE_KEYS.checkoutPending); } catch {}
}

function hasCompletedPurchase(orderId, paymentIntentId = null) {
  const purchases = getCompletedPurchases();
  return !!(purchases[String(orderId || '')] || purchases[String(paymentIntentId || '')]);
}

function setCheckoutPending(payload) {
  writeStorage('local', STORAGE_KEYS.checkoutPending, { ...payload, updatedAt: nowIso() });
}

function getCheckoutPending() {
  return readStorage('local', STORAGE_KEYS.checkoutPending, null);
}

function clearCheckoutPending() {
  try { localStorage.removeItem(STORAGE_KEYS.checkoutPending); } catch {}
}

function summarizeItems(items = []) {
  return (Array.isArray(items) ? items : []).map(item => ({
    productId: String(item.productId || item.id || '').trim() || null,
    sku: String(item.sku || item.productId || item.id || '').trim() || null,
    quantity: Math.max(1, Number(item.quantity || item.qty || 1) || 1),
    price: Number(item.price || item.unitPrice || 0) || 0,
    name: String(item.name || item.productName || item.title || '').trim() || null,
    category: String(item.category || '').trim() || null,
    size: String(item.size || item.option || '').trim() || null,
    color: String(item.color || '').trim() || null
  }));
}

function buildDedupeKey(eventName, payload) {
  const pageKey = payload.path || location.pathname;
  switch (eventName) {
    case 'page_view':
      return `page_view:${getSessionId()}:${pageKey}`;
    case 'checkout_abandon':
      return `checkout_abandon:${payload.meta?.cartFingerprint || 'na'}:${payload.meta?.reason || 'unknown'}`;
    case 'email_capture':
      return `email_capture:${payload.emailHash || payload.email || getVisitorId()}:${payload.meta?.captureType || 'unknown'}`;
    case 'quote_submit':
      return `quote_submit:${payload.emailHash || payload.email || getVisitorId()}:${payload.meta?.submissionType || 'unknown'}`;
    default:
      return `${eventName}:${getSessionId()}:${pageKey}:${payload.productId || payload.meta?.ctaName || payload.meta?.orderId || ''}`;
  }
}

function shouldSuppressClientEvent(dedupeKey, ttlMs) {
  if (!dedupeKey || !ttlMs) return false;
  const bucket = readStorage('local', STORAGE_KEYS.dedupe, {});
  const cutoff = Date.now() - ttlMs;
  Object.keys(bucket).forEach(key => {
    if (!bucket[key] || bucket[key] < cutoff) delete bucket[key];
  });
  writeStorage('local', STORAGE_KEYS.dedupe, bucket);
  return Number(bucket[dedupeKey] || 0) >= cutoff;
}

function markClientEvent(dedupeKey) {
  if (!dedupeKey) return;
  const bucket = readStorage('local', STORAGE_KEYS.dedupe, {});
  bucket[dedupeKey] = Date.now();
  writeStorage('local', STORAGE_KEYS.dedupe, bucket);
}

async function sendJson(path, payload, { useBeacon = false } = {}) {
  const isDevSplit = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    && String(location.port) === '5500'
    && location.protocol.startsWith('http');
  if (isDevSplit) return false;

  const body = JSON.stringify(payload);
  if (useBeacon && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      for (const base of API_BASES) {
        if (navigator.sendBeacon(`${base}${path}`, blob)) return true;
      }
    } catch {}
  }

  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body
      });
      if (res.ok) {
        try { window.__API_BASE = base; } catch {}
        return true;
      }
    } catch {}
  }
  return false;
}

function basePayload(identity, attribution, eventName, meta = {}, source = TRACKING_SOURCE) {
  const items = summarizeItems(meta.items || meta.products || []);
  const ecommerce = meta.ecommerce || {};
  const lead = meta.lead || {};
  const path = `${location.pathname}${location.search}`;
  const payload = {
    schemaVersion: TRACKING_SCHEMA_VERSION,
    eventName,
    source,
    eventId: (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    occurredAt: nowIso(),
    path,
    url: location.href,
    title: document.title || '',
    referrer: document.referrer || '',
    visitorId: identity.visitorId || getVisitorId(),
    sessionId: identity.sessionId || getSessionId(),
    userId: identity.userId || pickUserId() || null,
    email: identity.email || null,
    emailHash: identity.emailHash || null,
    productId: meta.productId || meta.id || items[0]?.productId || null,
    attribution,
    ecommerce: {
      currency: ecommerce.currency || 'USD',
      value: Number(ecommerce.value || meta.value || 0) || 0,
      orderId: ecommerce.orderId || meta.orderId || null,
      paymentIntentId: ecommerce.paymentIntentId || meta.paymentIntentId || null,
      items
    },
    lead: {
      submissionType: lead.submissionType || meta.submissionType || null,
      topic: lead.topic || meta.topic || null,
      quoteType: lead.quoteType || meta.quoteType || null,
      formId: lead.formId || meta.formId || null,
      estimatedValue: Number(lead.estimatedValue || meta.estimatedValue || 0) || 0
    },
    meta
  };
  payload.dedupeKey = buildDedupeKey(eventName, payload);
  return payload;
}

function dedupeWindowFor(eventName) {
  switch (eventName) {
    case 'page_view': return 30 * 60 * 1000;
    case 'checkout_abandon': return 12 * 60 * 60 * 1000;
    case 'email_capture': return 24 * 60 * 60 * 1000;
    case 'quote_submit': return 10 * 60 * 1000;
    default: return 0;
  }
}

async function track(eventName, meta = {}, options = {}) {
  const normalizedEvent = String(eventName || '').trim().toLowerCase() === 'pageview' ? 'page_view' : String(eventName || '').trim().toLowerCase();
  if (!normalizedEvent) return false;

  updateAttribution();
  const identity = await identify(options.identity || {});
  const attribution = {
    firstTouch: readStorage('local', STORAGE_KEYS.firstTouch, null),
    lastTouch: readStorage('local', STORAGE_KEYS.lastTouch, null)
  };
  const payload = basePayload(identity, attribution, normalizedEvent, meta, options.source || TRACKING_SOURCE);
  const dedupeWindowMs = options.dedupeWindowMs ?? dedupeWindowFor(normalizedEvent);
  if (shouldSuppressClientEvent(payload.dedupeKey, dedupeWindowMs)) return { ok: true, deduped: true };

  try {
    const raw = localStorage.getItem('analyticsCounters');
    const counters = raw ? JSON.parse(raw) : { view_item: {}, add_to_cart: {} };
    const productId = payload.productId || payload.ecommerce?.items?.[0]?.productId || null;
    if (normalizedEvent === 'view_item' && productId) {
      counters.view_item[productId] = (counters.view_item[productId] || 0) + 1;
    }
    if (normalizedEvent === 'add_to_cart' && productId) {
      counters.add_to_cart[productId] = (counters.add_to_cart[productId] || 0) + 1;
    }
    localStorage.setItem('analyticsCounters', JSON.stringify(counters));
  } catch {}

  const endpoint = normalizedEvent === 'page_view' ? '/api/analytics/track' : '/api/analytics/event';
  const ok = await sendJson(endpoint, payload, { useBeacon: !!options.useBeacon });
  if (ok) markClientEvent(payload.dedupeKey);
  return { ok, payload };
}

async function trackLegacy(eventName, payload = {}) {
  const meta = {};
  const normalized = String(eventName || '').trim();
  if (normalized === 'view_item_list' && Array.isArray(payload)) {
    meta.items = payload.map(item => ({
      productId: item.id || item.productId,
      price: item.price,
      stripePrice: item.stripePrice || null,
      quantity: item.qty || 1
    }));
  } else if (typeof payload === 'string') {
    meta.productId = payload;
  } else if (payload && typeof payload === 'object') {
    Object.assign(meta, payload);
    if (payload.id && !payload.productId) meta.productId = payload.id;
  }
  return track(normalized, meta);
}

function bindClickTracking() {
  if (window.__EZTRACK_CLICK_BOUND__) return;
  window.__EZTRACK_CLICK_BOUND__ = true;
  document.addEventListener('click', (event) => {
    try {
      const element = event.target?.closest?.('a,button,[data-track]');
      if (!element || element.hasAttribute('data-no-track')) return;
      const href = element.tagName === 'A' ? (element.getAttribute('href') || '') : '';
      const isTrackedCta = element.matches('[data-track="cta"], .btn, .cart-btn, [data-add], [data-add-detail], [data-checkout]')
        || /checkout|contact|mailto:|tel:|product\.html/i.test(href);
      if (!isTrackedCta) return;
      void track('cta_click', {
        ctaName: element.getAttribute('data-cta-name') || (element.textContent || '').trim().slice(0, 120),
        href,
        elementId: element.id || null,
        className: typeof element.className === 'string' ? element.className.slice(0, 200) : null,
        productId: element.getAttribute('data-product-id') || element.getAttribute('data-add') || null
      });
    } catch {}
  }, { capture: true, passive: true });
}

function boot(options = {}) {
  updateAttribution();
  void identify({});
  bindClickTracking();
  if (options.trackPageView !== false) {
    void track('page_view', options.pageMeta || {}, { dedupeWindowMs: 30 * 60 * 1000 });
  }
}

const api = {
  schemaVersion: TRACKING_SCHEMA_VERSION,
  boot,
  track,
  trackPageView: (meta = {}, options = {}) => track('page_view', meta, options),
  identify,
  getVisitorId,
  getSessionId,
  getIdentity,
  markPurchaseCompleted,
  hasCompletedPurchase,
  setCheckoutPending,
  getCheckoutPending,
  clearCheckoutPending,
  trackLegacy
};

window.EZTrack = api;
window.trackEvent = function(eventName, payload) {
  void api.trackLegacy(eventName, payload);
};

export default api;
export {
  boot,
  track,
  identify,
  getVisitorId,
  getSessionId,
  getIdentity,
  markPurchaseCompleted,
  hasCompletedPurchase,
  setCheckoutPending,
  getCheckoutPending,
  clearCheckoutPending
};