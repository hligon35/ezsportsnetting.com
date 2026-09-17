// Stripe Payment Element integration for cards, Apple Pay, Google Pay, PayPal
// Publishable key will be provided by a config endpoint or fallback (dev)
import './tracking.js';

let stripe;
let stripeEnabled = false;
// Enable verbose logging with ?debug=1 or by setting window.__CHECKOUT_DEBUG = true
const DEBUG = (() => {
  try {
    const qd = new URLSearchParams(window.location.search);
    return qd.get('debug') === '1' || !!window.__CHECKOUT_DEBUG;
  } catch { return false; }
})();
// API base configuration: prefer window.__API_BASE or <meta name="api-base" content="https://api.example.com">
// Cloudflare migration uses same-origin API requests. Keep an optional API base
// only for local testing or an explicitly supplied meta tag.
const __META_API = (function(){ try{ return (document.querySelector('meta[name="api-base"]')?.content||'').trim(); }catch{ return ''; } })();
const GUESSED_BASES = [];
let API_BASE = (typeof window !== 'undefined' && window.__API_BASE ? String(window.__API_BASE) : __META_API).replace(/\/$/, '');
if (DEBUG) { try { console.info('[checkout] initial API_BASE =', API_BASE || '(same-origin)'); } catch {} }

async function fetchJsonWithFallback(path, options){
  // Prefer same-origin first so local/dev/test servers don't accidentally hang on a remote API base.
  // If same-origin isn't serving APIs, it will typically 404 quickly and we'll fall back to API_BASE.
  const bases = [ '', API_BASE || '', ...GUESSED_BASES.filter(b => b && b !== API_BASE) ];
  const timeoutMs = Number(window.__API_TIMEOUT_MS || 12000);
  let lastErr = null;
  for (const base of bases) {
    const url = base ? (base + path) : path;
    try {
      // Add a timeout to prevent hanging forever on an unavailable base.
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let res;
      try {
        res = await fetch(url, controller ? { ...(options||{}), signal: controller.signal } : options);
      } finally {
        if (t) clearTimeout(t);
      }
      // Success path
      if (res.ok) {
        // If we succeeded using a guessed base, persist it for subsequent calls
        if (base && base !== API_BASE) {
          API_BASE = base;
          if (DEBUG) { try { console.info('[checkout] API_BASE switched to', API_BASE); } catch {} }
        }
        return await res.json();
      }
      // If 404 and we haven't tried all, continue to next base
      if (res.status === 404) {
        if (DEBUG) { try { console.warn('[checkout] 404 at', url, 'trying next base'); } catch {} }
        continue;
      }
      // Other HTTP errors: return parsed error payload if possible
      try { return await res.json(); } catch {
        if (DEBUG) { try { console.error('[checkout] HTTP error', res.status, 'at', url); } catch {} }
        return { error: `HTTP ${res.status}` };
      }
    } catch (e) {
      lastErr = e;
      if (DEBUG) { try { console.warn('[checkout] fetch failed at', url, e?.message||e); } catch {} }
      // Try next base
    }
  }
  // If everything failed, surface a generic error
  if (lastErr) {
    if (DEBUG) { try { console.error('[checkout] all bases failed for', path, lastErr?.message||lastErr); } catch {} }
    return { error: lastErr.message || 'Network error' };
  }
  return { error: 'Request failed' };
}
async function getStripe() {
  if (stripe) return stripe;
  try {
  const cfg = await fetchJsonWithFallback('/api/config', { method: 'GET', cache: 'no-store' });
    try { window.__stripeCfg = cfg; } catch {}
    stripeEnabled = !!cfg.enabled;
    if (DEBUG) { try { console.info('[checkout] /api/config ->', cfg); } catch {} }
    stripe = Stripe(cfg.pk || 'pk_test_your_publishable_key');
  } catch {
    stripeEnabled = false;
    if (DEBUG) { try { console.warn('[checkout] /api/config failed; falling back to test pk'); } catch {} }
    stripe = Stripe('pk_test_your_publishable_key');
  }
  return stripe;
}

function currencyFmt(cents){ return (cents/100).toLocaleString(undefined,{style:'currency',currency:'USD'}); }
function readCart(){ try{ return JSON.parse(localStorage.getItem('cart')||'[]'); }catch{ return []; } }
function variantText(i){
  const parts = [];
  if ((i.size||'').trim()) parts.push(`Size ${i.size}`);
  const isNetting = (String(i.category||'').toLowerCase()==='netting') || (String(i.id||'').toLowerCase().startsWith('custom-net-'));
  if ((i.color||'').trim()) parts.push(`${isNetting ? 'Spec' : 'Color'} ${i.color}`);
  return parts.join(', ');
}

function toCents(n){ return Math.round(Number(n||0) * 100); }
function fromCents(c){ return Math.max(0, Math.round(Number(c||0))); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cartFingerprint(items) {
  const normalized = (Array.isArray(items) ? items : []).map(item => ({
    id: String(item.id || item.productId || '').trim(),
    qty: Math.max(1, Number(item.qty || item.quantity || 1) || 1),
    price: Number(item.price || 0) || 0,
    size: String(item.size || '').trim(),
    color: String(item.color || '').trim()
  }));
  return stableStringify(normalized);
}

function buildTrackingItems(cart) {
  return (Array.isArray(cart) ? cart : []).map(item => ({
    productId: item.id,
    quantity: item.qty,
    price: Number(item.price) || 0,
    name: item.title || item.name || item.id,
    category: item.category || '',
    size: item.size || '',
    color: item.color || ''
  }));
}

function trackCheckoutEvent(eventName, meta = {}, options = {}) {
  if (!window.EZTrack) return Promise.resolve({ ok: false, skipped: true });
  return window.EZTrack.track(eventName, meta, options);
}
function calcSubtotalCents(cart){
  return cart.reduce((sum,i)=> sum + (toCents(i.price||0) * (i.qty||0)), 0);
}
function normalizeShippingMethod(value) {
  const v = String(value || '').toLowerCase().trim();
  return (v === 'expedited') ? 'expedited' : 'standard';
}

function isAccessoryCartItem(i){
  try {
    const cat = String(i?.category || '').toLowerCase();
    if (cat === 'accessories' || cat === 'pad-kits' || cat === 'bullet-pad-kits') return true;
    const id = String(i?.id || '').toUpperCase();
    if (/^CABLE/.test(id)) return true;
    // Heuristic fallback by title
    const t = String(i?.title || i?.name || '').toLowerCase();
    if (/\bcable\b|\btwine\b|\brope\b|\bvinyl\b|\bpadding\b|\bbasket\b|\bbatting\s*mat\b|screen\s*bulletz|armor/.test(t)) return true;
  } catch {}
  return false;
}

function getShippingMethod() {
  try {
    const el = document.getElementById('shipping-method');
    if (el && el.value) return normalizeShippingMethod(el.value);
  } catch {}
  try {
    const v = localStorage.getItem('shippingMethod');
    if (v) return normalizeShippingMethod(v);
  } catch {}
  return 'standard';
}

function setShippingMethod(value) {
  const v = normalizeShippingMethod(value);
  try { localStorage.setItem('shippingMethod', v); } catch {}
  try {
    const el = document.getElementById('shipping-method');
    if (el) el.value = v;
  } catch {}
  return v;
}

function calcShippingCentsForCart(cart, shippingMethod = 'standard'){
  // Base policy: per-item shipping: if item has dsr (ship), use it; otherwise default $100 per item
  // Expedited: +$100 per item on top of standard shipping
  const method = normalizeShippingMethod(shippingMethod);
  const expeditedSurchargeCentsPerItem = (method === 'expedited') ? 10000 : 0;
  let total = 0;
  for (const i of cart) {
    // Accessories: shipping disabled (call-to-order)
    if (isAccessoryCartItem(i)) continue;
    const raw = (typeof i.ship !== 'undefined') ? i.ship : i.shipAmount;
    const dsr = Number(raw);
    // Respect explicit zero as free shipping
    const per = Number.isFinite(dsr) ? (dsr === 0 ? 0 : (dsr > 0 ? dsr : 100)) : 100; // $100 default
    const qty = Math.max(1, Number(i.qty) || 1);
    total += (Math.round(per * 100) * qty) + (expeditedSurchargeCentsPerItem * qty);
  }
  return total;
}
function taxRateForAddress(addr){
  // Mirror server defaults: GA 7%, else 0 unless overridden in future
  const country = String(addr?.country || 'US').toUpperCase();
  // Normalize common full state names to 2-letter codes for client-side fallback
  const RAW = String(addr?.state || '').trim();
  const MAP = { 'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','DISTRICT OF COLUMBIA':'DC' };
  let state = RAW.toUpperCase();
  if (state.length > 2) state = MAP[state] || state;
  if (country === 'US' && state === 'GA') return 0.07;
  return 0;
}

function updateSummary(cart, applied, shippingAddr, shippingMethod){
  const sub = calcSubtotalCents(cart);
  const ship = calcShippingCentsForCart(cart, shippingMethod);
  let discount = 0;
  if (applied && applied.type && applied.value) {
    if (applied.type === 'percent') {
      discount = Math.round((sub + ship) * (Number(applied.value)||0) / 100);
    } else if (applied.type === 'fixed') {
      discount = Math.round(Number(applied.value||0) * 100);
    }
    if (discount > (sub + ship)) discount = (sub + ship);
  }
  // Tax is calculated on (sub + ship - discount)
  const taxBase = Math.max(0, sub + ship - discount);
  const rate = taxRateForAddress(shippingAddr||{});
  const tax = Math.round(taxBase * rate);
  const total = sub + ship - discount + tax;
  const el = (id) => document.getElementById(id);
  if (el('sum-subtotal')) el('sum-subtotal').textContent = currencyFmt(fromCents(sub));
  if (el('sum-shipping')) el('sum-shipping').textContent = ship === 0 ? 'Free' : currencyFmt(fromCents(ship));
  const taxRow = document.getElementById('tax-row');
  if (taxRow) taxRow.hidden = !(tax > 0);
  const taxEl = document.getElementById('sum-tax');
  if (taxEl) taxEl.textContent = currencyFmt(fromCents(tax));
  if (discount > 0) {
    const row = document.getElementById('discount-row');
    if (row) row.hidden = false;
    const dEl = document.getElementById('sum-discount');
    if (dEl) dEl.textContent = '-' + currencyFmt(fromCents(discount));
  } else {
    const row = document.getElementById('discount-row');
    if (row) row.hidden = true;
  }
  if (el('sum-total')) el('sum-total').textContent = currencyFmt(fromCents(total));
  return { sub, ship, discount, tax, total };
}

function computeDiscountCents(sub, ship, applied) {
  let discount = 0;
  if (applied && applied.type && applied.value) {
    if (applied.type === 'percent') {
      discount = Math.round((sub + ship) * (Number(applied.value)||0) / 100);
    } else if (applied.type === 'fixed') {
      discount = Math.round(Number(applied.value||0) * 100);
    }
    if (discount > (sub + ship)) discount = (sub + ship);
  }
  return discount;
}

async function initialize() {
  const form = document.getElementById('payment-form');
  const cart = readCart();
  const hasAccessories = Array.isArray(cart) && cart.some(isAccessoryCartItem);
  const trackingItems = buildTrackingItems(cart);
  const fingerprint = cartFingerprint(cart);
  let appliedCoupon = null; // { code, type, value }
  let clientSecret = null;
  let amount = 0;
  let elements = null;
  let orderId = null;
  let serverBreakdown = null; // latest server-provided breakdown
  let checkoutCompleting = false;
  let beginCheckoutTracked = false;

  const syncCheckoutIdentity = () => {
    if (!window.EZTrack || !form) return;
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    if (!email && !name) return;
    void window.EZTrack.identify({
      name,
      email,
      source: 'checkout'
    });
  };

  const currentCheckoutValue = () => {
    if (Number.isFinite(Number(amount)) && Number(amount) > 0) return Number(amount) / 100;
    const breakdown = updateSummary(cart, appliedCoupon, getShippingAddress(), getShippingMethod());
    return Number((breakdown.total || 0) / 100) || 0;
  };

  const savePendingCheckout = (extra = {}) => {
    if (!window.EZTrack) return;
    window.EZTrack.setCheckoutPending({
      orderId: orderId || null,
      email: String(new FormData(form).get('email') || '').trim() || null,
      path: location.pathname,
      cartFingerprint: fingerprint,
      value: currentCheckoutValue(),
      items: trackingItems,
      shippingMethod: getShippingMethod(),
      ...extra
    });
  };

  const ensureBeginCheckoutTracked = () => {
    if (beginCheckoutTracked || hasAccessories) return;
    beginCheckoutTracked = true;
    syncCheckoutIdentity();
    savePendingCheckout({ status: 'active' });
    void trackCheckoutEvent('begin_checkout', {
      ecommerce: {
        value: currentCheckoutValue(),
        orderId: orderId || null,
        items: trackingItems
      },
      cartFingerprint: fingerprint,
      shippingMethod: getShippingMethod(),
      couponCode: appliedCoupon?.code || null
    });
  };

  const emitCheckoutAbandon = (reason) => {
    if (checkoutCompleting || hasAccessories || !window.EZTrack) return;
    const pending = window.EZTrack.getCheckoutPending();
    if (!pending) return;
    if (window.EZTrack.hasCompletedPurchase(orderId || pending.orderId || null, clientSecret || null)) return;
    syncCheckoutIdentity();
    void trackCheckoutEvent('checkout_abandon', {
      ecommerce: {
        value: Number(pending.value || currentCheckoutValue()) || 0,
        orderId: orderId || pending.orderId || null,
        items: trackingItems
      },
      cartFingerprint: pending.cartFingerprint || fingerprint,
      shippingMethod: pending.shippingMethod || getShippingMethod(),
      reason,
      pendingAgeMs: pending.updatedAt ? Math.max(0, Date.now() - Date.parse(pending.updatedAt)) : 0
    }, { useBeacon: true });
  };

  ['pagehide', 'beforeunload'].forEach(eventName => {
    window.addEventListener(eventName, () => emitCheckoutAbandon(eventName));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') emitCheckoutAbandon('visibility_hidden');
  });

  // Prefill for logged-in users: name/email + default shipping address
  try {
    const user = JSON.parse(localStorage.getItem('currentUser')||'null');
    const guestPrompt = document.getElementById('guest-prompt');
    if (user && user.id) {
      if (guestPrompt) guestPrompt.hidden = true;
      const nm = document.getElementById('name'); if (nm && !nm.value) nm.value = user.name || `${user.firstName||''} ${user.lastName||''}`.trim();
      const em = document.getElementById('email'); if (em && !em.value) em.value = user.email || '';
      try {
        const data = await fetchJsonWithFallback('/api/users/me/addresses', { method: 'GET', credentials: 'include', cache: 'no-store' });
        const list = Array.isArray(data?.addresses) ? data.addresses : [];
        const def = list.find(a=>a.isDefault) || list[0];
        if (def) {
          const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value) el.value = v || ''; };
          set('address1', def.address1);
          set('address2', def.address2);
          set('city', def.city);
          set('state', def.state);
          set('postal', def.postal);
          const country = document.getElementById('country'); if (country && !country.value) country.value = def.country || 'US';
        }
      } catch {}
    } else {
      if (guestPrompt) guestPrompt.hidden = false;
    }
  } catch {}

  // Render order lines with price and quantity
  const initialShippingMethod = getShippingMethod();
  const lines = cart.map(i => {
    const title = i.title || i.id;
    const unit = Number(i.price) || 0;
    const qty = i.qty || 0;
    const unitCents = toCents(unit);
    const lineCents = unitCents * qty;
    const isAcc = isAccessoryCartItem(i);
    const raw = (typeof i.ship !== 'undefined') ? i.ship : i.shipAmount;
    const shipPer = Number(raw);
    const shipEach = Number.isFinite(shipPer) ? (shipPer === 0 ? 0 : (shipPer > 0 ? shipPer : 100)) : 100;
    const shipEachWithMethod = shipEach + (initialShippingMethod === 'expedited' ? 100 : 0);
    const shipCents = toCents(shipEach) * qty;
    const variant = variantText(i);
    return `
      <div class="flex-row items-start gap-075 space-between">
        <div>
          <strong>${title}</strong>
          ${variant ? `<div class="muted">${variant}</div>` : ''}
          <div class="muted text-xs">SKU: ${i.id}</div>
          <div class="muted">${currencyFmt(unitCents)} × ${qty}</div>
          ${isAcc ? `<div class="muted">Shipping: Call to order</div>` : `<div class="muted">Shipping: ${shipEachWithMethod===0 ? 'Free' : currencyFmt(toCents(shipEachWithMethod))} × ${qty}${initialShippingMethod === 'expedited' ? ' (expedited)' : ''}</div>`}
        </div>
        <div class="text-right">
          <strong>${currencyFmt(lineCents)}</strong>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('order-lines').innerHTML = lines || '<p>Your cart is empty.</p>';

  // If cart contains Accessories, disable shipping + online checkout and show Call To Order CTA
  if (hasAccessories) {
    try {
      // Hide shipping method selector (not applicable)
      const shipMethodEl = document.getElementById('shipping-method');
      const shipMethodRow = shipMethodEl ? shipMethodEl.closest('.field-row') : null;
      if (shipMethodRow) shipMethodRow.style.display = 'none';

      // Remove required constraints so users can still view the page without validation issues
      ['address1','city','state','postal','name','email'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.required = false;
      });

      // Replace payment UI with call-to-order CTA
      const pe = document.getElementById('payment-element');
      if (pe) {
        pe.innerHTML = `
          <div class="stack-03">
            <p class="muted">Accessories must be ordered by phone or email.</p>
            <div class="stack-02">
              <div class="row gap-06" style="flex-wrap:wrap;">
                <a class="btn btn-primary" href="tel:+13868373131" aria-label="Call to order at 386-837-3131">Call To Order</a>
                <a class="btn btn-ghost" href="mailto:info@ezsportsnetting.com" aria-label="Email EZ Sports Netting">Email</a>
              </div>
            </div>
          </div>
        `;
      }
      const submit = document.getElementById('submit');
      if (submit) {
        submit.disabled = true;
        submit.setAttribute('aria-disabled','true');
        submit.style.display = 'none';
      }
      const msg = document.getElementById('payment-message');
      if (msg) msg.textContent = '';

      // Force summary shipping display to a neutral placeholder
      const shipSum = document.getElementById('sum-shipping');
      if (shipSum) shipSum.textContent = '—';
      // Compute totals with shipping disabled
      updateSummary(cart, appliedCoupon, getShippingAddress(), 'standard');

      // Prevent any submission attempts and default to tel:
      form?.addEventListener('submit', (e) => {
        try { e.preventDefault(); } catch {}
        try { window.location.href = 'tel:+13868373131'; } catch {}
      });
    } catch {}
    return;
  }

  ensureBeginCheckoutTracked();

  const getPayload = () => {
    const fd = new FormData(form);
    const customer = { name: fd.get('name'), email: fd.get('email') };
    const shipping = { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state: fd.get('state'), postal: fd.get('postal'), country: fd.get('country') };
    // Send minimal items shape to backend
    // Include unit price and per-item shipping to help the server price variation-only items when DB/fallback lacks a product-level price
    const items = cart.map(i=>({
      id: i.id,
      qty: i.qty,
      price: Number(i.price)||0,
      ship: (Number(i.shipAmount) || undefined),
      // Variation details for confirmation/email
      size: i.size || '',
      color: i.color || '',
      category: i.category || '',
      name: i.title || ''
    }));
    return { items, customer, shipping, shippingMethod: getShippingMethod(), couponCode: appliedCoupon?.code || '', existingOrderId: orderId };
  };

  function getShippingAddress(){
    const fd = new FormData(form);
    // Normalize state to uppercase (and ideally to 2-letter if user typed code)
    let state = (fd.get('state')||'').toString().trim();
    if (state.length === 2) state = state.toUpperCase();
    return { address1: fd.get('address1'), address2: fd.get('address2'), city: fd.get('city'), state, postal: fd.get('postal'), country: fd.get('country') };
  }

  function debounce(fn, wait){ let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); }; }
  let lastClientSecret = null;
  let lastAddrBasis = '';

  async function createOrUpdatePaymentIntent() {
    await getStripe();
    if (!stripeEnabled) return;
    try {
      const intentResp = await fetchJsonWithFallback('/api/create-payment-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getPayload()), cache: 'no-store'
      });
      if (DEBUG) { try { console.info('[checkout] PI response', intentResp); } catch {} }
      if (intentResp && !intentResp.error) {
        const newSecret = intentResp.clientSecret;
        const secretChanged = newSecret && newSecret !== clientSecret;
        clientSecret = newSecret;
        amount = intentResp.amount;
        orderId = intentResp.orderId || orderId;
        savePendingCheckout({
          status: 'payment_intent_ready',
          orderId: orderId || null,
          clientSecret: clientSecret || null,
          amount: Number(amount || 0) / 100
        });
        if (intentResp.couponApplied) {
          appliedCoupon = intentResp.couponApplied;
          document.getElementById('discount-row').style.display = '';
          document.getElementById('discount-code-label').textContent = `(${appliedCoupon.code})`;
        }
        // If server provides a pricing breakdown, render it exactly
        try {
          const bd = intentResp.breakdown || null;
          serverBreakdown = bd || null;
          const set = (id, cents) => { const el = document.getElementById(id); if (el && Number.isFinite(cents)) el.textContent = currencyFmt(fromCents(cents)); };
          if (bd) {
            set('sum-subtotal', bd.subtotal);
            // Shipping: show Free when zero for consistency
            const shipEl = document.getElementById('sum-shipping');
            if (shipEl) shipEl.textContent = (bd.shipping === 0) ? 'Free' : currencyFmt(fromCents(bd.shipping));
            const taxRow = document.getElementById('tax-row');
            if (taxRow) taxRow.hidden = !(bd.tax && bd.tax > 0);
            if (Number.isFinite(bd.tax)) set('sum-tax', bd.tax);
            if (bd.discount && bd.discount > 0) {
              const row = document.getElementById('discount-row');
              if (row) row.hidden = false;
              const dEl = document.getElementById('sum-discount');
              if (dEl) dEl.textContent = '-' + currencyFmt(fromCents(bd.discount));
            }
            const totalEl = document.getElementById('sum-total');
            if (totalEl) totalEl.textContent = currencyFmt(fromCents(bd.total));
          }
        } catch {}
        const _stripe = await getStripe();
        // Only recreate Elements if the clientSecret changed or Elements not initialized
        try {
          if (secretChanged || !elements) {
            if (elements) {
              try { const host = document.getElementById('payment-element'); host && (host.innerHTML = ''); } catch {}
            }
            elements = _stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
            const paymentElement = elements.create('payment', { layout: 'tabs' });
            paymentElement.mount('#payment-element');
            lastClientSecret = clientSecret;
          }
        } catch {}
      }
      if (intentResp && intentResp.error) {
        if (DEBUG) { try { console.error('[checkout] PI error', intentResp.error); } catch {} }
        const msg = document.getElementById('payment-message');
        if (msg) msg.textContent = intentResp.error || 'Could not initialize payment.';
      }
    } catch (_) { /* ignore */ }
  }

  // Initialize Stripe and create PaymentIntent on backend if Stripe is enabled
  await createOrUpdatePaymentIntent();

  // Always show a computed summary (even in test mode). Server breakdown overrides this during PI creation.
  const { total: computedTotal } = updateSummary(cart, appliedCoupon, getShippingAddress());
  if (amount > 0) {
    document.getElementById('sum-total').textContent = currencyFmt(amount);
  } else {
    document.getElementById('sum-total').textContent = currencyFmt(fromCents(computedTotal));
  }
  if (!clientSecret) {
    const pe = document.getElementById('payment-element');
    const submit = document.getElementById('submit');
    if (stripeEnabled) {
      // Stripe is configured, but PI could not be created. Do NOT silently fall back to test checkout.
      if (DEBUG) { try { console.warn('[checkout] Stripe enabled but no clientSecret — PI init failed, keeping real checkout disabled UI.'); } catch {} }
      if (pe) pe.innerHTML = '<p class="muted">Card payments are temporarily unavailable. Please verify your details and try again in a moment. If the problem persists, contact support.</p>';
      if (submit) submit.textContent = 'Try Again';
      const msg = document.getElementById('payment-message');
      if (msg && !msg.textContent) msg.textContent = 'Unable to initialize payment. Please retry.';
    } else {
      // Stripe disabled: enable explicit test checkout fallback
      if (DEBUG) { try { console.warn('[checkout] Stripe disabled (cfg.enabled=false) — switching to test checkout fallback. API_BASE =', API_BASE||'(same-origin)'); } catch {} }
      if (pe) pe.innerHTML = '<p class="muted">Test checkout active (no card required)</p>';
      if (submit) submit.textContent = 'Place Order';
      // If Stripe is disabled due to server config, surface a helpful note
      try {
        const cfg = window.__stripeCfg;
        if (cfg && cfg.missing && (cfg.missing.secret || cfg.missing.publishable)) {
          const m2 = document.getElementById('payment-message');
          if (m2) m2.textContent = 'Card payments are temporarily unavailable. You can still place your order and we will follow up to complete payment.';
        }
      } catch {}
    }
  }

  // Shipping method selection removed; totals depend only on cart contents and coupon
  // Shipping method affects shipping total only.

  const shipMethodEl = document.getElementById('shipping-method');
  if (shipMethodEl) {
    shipMethodEl.value = getShippingMethod();
    shipMethodEl.addEventListener('change', async () => {
      syncCheckoutIdentity();
      setShippingMethod(shipMethodEl.value);
      updateSummary(cart, appliedCoupon, getShippingAddress(), getShippingMethod());
      savePendingCheckout({ status: 'active' });
      await createOrUpdatePaymentIntent();
      if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
    });
  }

  ['name', 'email', 'address1', 'city', 'state', 'postal', 'country'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      syncCheckoutIdentity();
      savePendingCheckout({ status: 'active' });
    });
    if (id === 'email' || id === 'name') {
      el.addEventListener('input', syncCheckoutIdentity);
    }
  });

  // Promo code apply handler
  const applyBtn = document.getElementById('apply-code');
  if (applyBtn) applyBtn.addEventListener('click', async () => {
    const codeInput = document.getElementById('promo-code');
    const msg = document.getElementById('promo-msg');
    const code = (codeInput?.value || '').trim();
    if (!code) { msg.textContent = 'Enter a code.'; return; }
    try {
      const currentUser = (function(){ try { return JSON.parse(localStorage.getItem('currentUser')||'null'); } catch { return null; } })();
      const payload = { code, email: (new FormData(form)).get('email')||'' };
      if (currentUser?.id) payload.userId = currentUser.id;
      const data = await fetchJsonWithFallback('/api/marketing/validate-coupon', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (data.valid) {
        appliedCoupon = data.coupon ? { code: data.coupon.code, type: data.coupon.type, value: data.coupon.value, restricted: !!data.restricted, matchedBy: data.matchedBy||null } : { code, type:'percent', value:0 };
        const label = document.getElementById('discount-code-label');
        if (label) {
          label.textContent = `(${appliedCoupon.code}${appliedCoupon.restricted ? ' • account' : ''})`;
          label.title = appliedCoupon.restricted ? 'This code is bound to your account.' : '';
        }
        updateSummary(cart, appliedCoupon, getShippingAddress());
        savePendingCheckout({ status: 'active', couponCode: appliedCoupon.code });
        await createOrUpdatePaymentIntent();
        if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
        msg.textContent = appliedCoupon.restricted ? 'Code applied to your account.' : 'Code applied.';
      } else {
        appliedCoupon = null;
        updateSummary(cart, appliedCoupon, getShippingAddress());
        const reason = String(data.reason||'');
        if (reason === 'expired') msg.textContent = 'This code has expired.';
        else if (reason === 'restricted') msg.innerHTML = 'This code is only available for a specific account. <a href="login.html">Sign in</a> and try again.';
        else msg.textContent = 'Invalid code.';
      }
    } catch (e) {
      msg.textContent = 'Could not validate code.';
    }
  });

  // Recalculate when address changes (debounced, with minimal completeness)
  const onAddrChange = debounce(async () => {
    const addr = getShippingAddress();
    // Only trigger PI update when address is minimally complete
    const postal = String(addr.postal||'').trim();
    const state = String(addr.state||'').trim();
    const country = String(addr.country||'').trim() || 'US';
    const basis = JSON.stringify({ postal: postal.slice(0,5), state, country });
    // Always update the visible summary quickly
    updateSummary(cart, appliedCoupon, addr);
    // If the basis hasn't changed, skip network churn
    if (basis === lastAddrBasis) return;
    // Require at least state + 5-digit postal for US to price tax properly
    if ((country === 'US') && (postal.replace(/\D/g,'').length < 5 || state.length < 2)) {
      lastAddrBasis = basis; // record to avoid repeated checks
      return;
    }
    lastAddrBasis = basis;
    await createOrUpdatePaymentIntent();
    if (amount > 0) document.getElementById('sum-total').textContent = currencyFmt(amount);
  }, 800);
  // Use change for long text fields to avoid per-character refresh; allow input for state/postal/country
  ;['address1','address2','city'].forEach(id => {
    const el = document.getElementById(id); if (el) el.addEventListener('change', onAddrChange);
  });
  ;['state','postal','country'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.addEventListener('input', onAddrChange); el.addEventListener('change', onAddrChange); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('submit').disabled = true;
    syncCheckoutIdentity();
    savePendingCheckout({ status: 'submit_attempted' });
    // Decide mode: Real Stripe when we have a clientSecret; else only allow test fallback when Stripe is disabled
    const testMode = !clientSecret && !stripeEnabled;
    if (testMode) {
      try {
        const payload = getPayload();
        // Try to create order via backend (unauthenticated endpoint)
        const respJson = await fetchJsonWithFallback('/api/order', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        // Compute totals locally for confirmation
        const sub = calcSubtotalCents(cart);
        const ship = calcShippingCentsForCart(cart, getShippingMethod());
        const discount = computeDiscountCents(sub, ship, appliedCoupon);
        const tax = Math.round(Math.max(0, sub + ship - discount) * taxRateForAddress(getShippingAddress()));
        const total = sub + ship - discount + tax;
        let orderId = Date.now();
        if (respJson && respJson.orderId) { orderId = respJson.orderId; }
        // Build a local order snapshot for confirmation
  const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0), size: i.size||'', color: i.color||'', category: i.category||'' }));
        const order = {
          id: orderId,
          items,
          total: Math.round(total)/100,
          subtotal: Math.round(sub)/100,
          shipping: Math.round(ship)/100,
          discount: Math.round(discount)/100,
          tax: Math.round(tax)/100,
          couponCode: appliedCoupon?.code || null,
          shippingMethod: getShippingMethod()
        };
        // Save for confirmation page
        try{ sessionStorage.setItem('lastOrder', JSON.stringify(order)); }catch{}
  checkoutCompleting = true;
  if (window.EZTrack) {
    window.EZTrack.markPurchaseCompleted(order.id, null);
  }
  localStorage.removeItem('cart');
  const dest = new URL('order-confirmation.html?id=' + encodeURIComponent(order.id), window.location.href);
  window.location.href = dest.href;
      } catch (err) {
        void trackCheckoutEvent('payment_failure', {
          ecommerce: {
            value: currentCheckoutValue(),
            orderId: orderId || null,
            items: trackingItems
          },
          reason: err?.message || 'test_checkout_failed'
        });
        document.getElementById('payment-message').textContent = err.message || 'Checkout failed.';
        document.getElementById('submit').disabled = false;
      }
      return;
    }

    // Real Stripe flow
    // Save a lightweight snapshot for confirmation page UI
    try {
  const items = cart.map(i=>({ productName: i.title || i.id, id: i.id, quantity: i.qty, price: Number(i.price)||0, subtotal: (Number(i.price)||0) * (i.qty||0), size: i.size||'', color: i.color||'', category: i.category||'' }));
      const sub = calcSubtotalCents(cart);
      const ship = calcShippingCentsForCart(cart);
      const fallbackTotal = sub + ship;
      const totalCents = typeof amount === 'number' && amount > 0 ? amount : fallbackTotal;
      const discount = Math.max(0, fallbackTotal - totalCents);
      // Prefer server-provided tax if available
      const taxCents = serverBreakdown && Number.isFinite(serverBreakdown.tax) ? serverBreakdown.tax : Math.max(0, totalCents - (sub + ship - discount));
      const order = {
        id: orderId,
        items,
        total: Math.round(totalCents)/100,
        subtotal: Math.round(sub)/100,
        shipping: Math.round(ship)/100,
        discount: Math.round(discount)/100,
        tax: Math.round(taxCents)/100,
        couponCode: appliedCoupon?.code || null
      };
      sessionStorage.setItem('lastOrder', JSON.stringify(order));
    } catch {}
    checkoutCompleting = true;
    savePendingCheckout({ status: 'payment_confirmation_started' });
    const _stripe = await getStripe();
    const { error } = await _stripe.confirmPayment({
      elements,
      confirmParams: { return_url: new URL('order-confirmation.html' + (orderId ? ('?id=' + encodeURIComponent(orderId)) : ''), window.location.href).href },
    });
    if (error) {
      checkoutCompleting = false;
      void trackCheckoutEvent('payment_failure', {
        ecommerce: {
          value: currentCheckoutValue(),
          orderId: orderId || null,
          items: trackingItems,
          paymentIntentId: clientSecret || null
        },
        reason: error.message || 'stripe_confirm_failed'
      });
      document.getElementById('payment-message').textContent = error.message;
      document.getElementById('submit').disabled = false;
    }
  });

  // Handle success message if redirected back
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    document.getElementById('payment-message').style.color = 'green';
    document.getElementById('payment-message').textContent = 'Payment successful! Thank you for your order.';
    checkoutCompleting = true;
    if (window.EZTrack) {
      window.EZTrack.markPurchaseCompleted(orderId || params.get('id') || null, clientSecret || null);
      window.EZTrack.clearCheckoutPending();
    }
    // Save order to localStorage for order history
    try {
      const cart = readCart();
      const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (cart && cart.length) {
        const orders = JSON.parse(localStorage.getItem('orders') || '[]');
        // For demo, use id as timestamp
        const id = Date.now();
        // For price, use static PRODUCTS from shop page if available
        let PRODUCTS = window.PRODUCTS;
        if (!PRODUCTS && window.parent && window.parent.PRODUCTS) PRODUCTS = window.parent.PRODUCTS;
        if (!PRODUCTS) PRODUCTS = [];
        const items = cart.map(i => {
          let price = 0;
          if (PRODUCTS && PRODUCTS.length) {
            const prod = PRODUCTS.find(p => p.id === i.id);
            price = prod ? prod.price : 0;
          }
          return { ...i, price };
        });
        const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
        const order = { 
          id, 
          date: new Date().toISOString(), 
          items, 
          total,
          userEmail: user ? user.email : 'guest@example.com' // Associate with user
        };
        orders.push(order);
        localStorage.setItem('orders', JSON.stringify(orders));
      }
    } catch(e) { /* ignore */ }
    localStorage.removeItem('checkoutTotalCents');
    localStorage.removeItem('cart');
  }
}

// Optional: Google Maps Places Autocomplete for address fields (if configured on server)
async function initAddressAutocomplete(){
  try {
    // Avoid duplicate loads
    if (window.google && window.google.maps && window.google.maps.places) return true;
    const cfg = await fetchJsonWithFallback('/api/maps-config', { method: 'GET', cache: 'no-store' });
    const key = cfg && cfg.googleMapsApiKey;
    if (!key) return false;
    // Load the script once with a bootstrap callback
    if (window.__mapsLoading) return true;
    window.__mapsLoading = true;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__initPlaces`;
      s.async = true; s.defer = true;
      window.__initPlaces = () => { resolve(true); };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    // Attach autocomplete to address line 1
    const line1 = document.getElementById('address1');
    if (!line1 || !(window.google && window.google.maps && window.google.maps.places)) return false;
    const ac = new google.maps.places.Autocomplete(line1, {
      types: ['address'],
      componentRestrictions: { country: ['US'] },
      fields: ['address_components']
    });
    ac.addListener('place_changed', () => {
      try {
        const place = ac.getPlace();
        const comps = place && place.address_components ? place.address_components : [];
        const get = (type) => {
          const c = comps.find(x => Array.isArray(x.types) && x.types.includes(type));
          return c ? (c.long_name || c.short_name || '') : '';
        };
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const city = get('locality') || get('sublocality') || get('administrative_area_level_3');
        const state = get('administrative_area_level_1');
        const postal = get('postal_code');
        const country = get('country') || 'US';
        const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v || ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
        if (street) set('address1', street);
        if (city) set('city', city);
        if (state) set('state', state);
        if (postal) set('postal', postal);
        const ce = document.getElementById('country'); if (ce) ce.value = country || 'US';
      } catch {}
    });
    return true;
  } catch { return false; }
}

(async () => { try { await initialize(); } finally { initAddressAutocomplete(); } })();
