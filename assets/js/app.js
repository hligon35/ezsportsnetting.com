import './tracking.js';

// EZ Sports Netting — tiny storefront demo (no backend)
// Lightweight state + rendering so you can drop this in and it just works.

// During local development, ensure any previously-registered Service Worker is disabled to avoid live-reload loops
try {
  if ('serviceWorker' in navigator) {
    const isProd = (location.protocol === 'https:') && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    if (!isProd) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
      if (window.caches && caches.keys) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
      }
    }
  }
} catch {}

// Lightweight client-side "Coming Soon" gate with hidden unlock
// (Removed obsolete minimal Store skeleton to prevent duplicate declaration; see full Store definition later in file.)

// or query params: ?gate=on to enable, ?gate=off to disable, ?unlock=1 to grant temporary access
(function comingSoonGate(){
  try {
    const sp = new URLSearchParams(location.search);
    const path = location.pathname.replace(/^\\/,'/');
    const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    const isDevSplit = isLocal && String(location.port) === '5500' && location.protocol.startsWith('http');
    if (sp.get('gate') === 'on') localStorage.setItem('__COMING_SOON__','on');
    if (sp.get('gate') === 'off') localStorage.setItem('__COMING_SOON__','off');
    if (sp.has('unlock')) localStorage.setItem('comingSoonUnlocked', JSON.stringify({ at: Date.now() }));

    // Avoid redirect loop on gate page & API/asset routes
    if (/coming-soon\.html$/i.test(path)) return;
    if (/^\/(api|assets|server|database)\b/.test(path)) return;

    // 24h unlock token check
    let unlocked = false;
    try {
      const raw = localStorage.getItem('comingSoonUnlocked');
      if (raw) {
        const { at } = JSON.parse(raw);
        if (at && (Date.now() - at) < 24*60*60*1000) unlocked = true;
      }
    } catch {}
    if (unlocked) return;

    // Local override via query/localStorage always wins
    const override = String(localStorage.getItem('__COMING_SOON__') || '').toLowerCase();
    if (override === 'on') {
      if (!isLocal) { location.replace('coming-soon.html'); }
      return;
    }
    if (override === 'off') { return; }

    // Server-controlled flag via /api/config (MAINTENANCE or COMING_SOON env)
    const controller = (window.AbortController ? new AbortController() : null);
    const timer = controller ? setTimeout(()=>controller.abort(), 1500) : null;
    const fetchConfig = async () => {
      const opts = { cache: 'no-store', signal: controller ? controller.signal : undefined };
      // When running the frontend on Live Server (5500), /api/* does not exist on 5500.
      // Try common backend ports instead.
      if (isDevSplit) {
        const bases = [
          'http://127.0.0.1:4243','http://localhost:4243',
          'http://127.0.0.1:4242','http://localhost:4242',
          'http://127.0.0.1:4244','http://localhost:4244',
          'http://127.0.0.1:4245','http://localhost:4245',
          'http://127.0.0.1:4246','http://localhost:4246',
          'http://127.0.0.1:4247','http://localhost:4247'
        ];
        for (const b of bases) {
          try {
            const res = await fetch(`${b}/api/config`, opts);
            if (res.ok) return res.json();
          } catch {}
        }
        return null;
      }

      const res = await fetch('/api/config', opts);
      if (!res.ok) return null;
      return res.json();
    };

    Promise.resolve(fetchConfig())
      .then(cfg => {
        if (timer) clearTimeout(timer);
        const remoteOn = !!(cfg && cfg.maintenance === true);
        if (remoteOn && !isLocal) {
          location.replace('coming-soon.html');
        }
      })
      .catch(() => {
        // On failure, default to gate OFF to avoid accidental lockout
        // Admins can still force ON via ?gate=on
      });
  } catch {}
})();

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
let FEATURED = [];
let PRODUCTS = [];

function sanitizeDescription(html) {
  try {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = String(html);
    div.querySelectorAll('script,style,noscript').forEach(n=>n.remove());
    div.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); });
    });
    let txt = div.textContent || '';
    txt = txt.replace(/\s{2,}/g, ' ').trim();
    const MAX_LEN = 800;
    if (txt.length > MAX_LEN) txt = txt.slice(0, MAX_LEN) + '…';
    return txt;
  } catch { return ''; }
}
async function fetchProducts() {
  try {
    // Attempt multiple API bases so that when developing with Live Server (port 5500)
    // and the backend on different ports we still succeed. Try common server ports first.
    const bases = [ 
      'http://127.0.0.1:4244', 'http://localhost:4244',
      'http://127.0.0.1:4243', 'http://localhost:4243', 
      'http://127.0.0.1:4242', 'http://localhost:4242',
      '' // same origin as fallback
    ];
    let data = [];
    let lastErr = null;
    // Attempt to fetch from first responsive base
    for (const base of bases) {
      const url = (base ? base.replace(/\/$/,'') : '') + '/api/products';
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP '+res.status);
        const json = await res.json();
        if (Array.isArray(json) && json.length) { data = json; break; }
      } catch (err) { lastErr = err; }
    }
    PRODUCTS = Array.isArray(data) ? data : [];
    if (!PRODUCTS.length && lastErr) console.warn('All product API attempts failed, will use fallbacks:', lastErr?.message||lastErr);
  } catch (e) {
    console.warn('fetchProducts() unrecoverable error:', e);
  }
}
  // Cloudflare Turnstile site key (public). Provided by user.
  window.TURNSTILE_SITE_KEY = window.TURNSTILE_SITE_KEY || '0x4AAAAAAB5rtUiQ1MiqGIxp';

  // Lightweight Turnstile script loader and token fetcher (invisible)
  async function loadTurnstile() {
    if (window.turnstile) return true;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    // small wait for global to attach
    await new Promise(r=>setTimeout(r,50));
    return !!window.turnstile;
  }

  async function getTurnstileToken() {
    try {
      const ok = await loadTurnstile();
      if (!ok || !window.TURNSTILE_SITE_KEY) return '';
      // Use a global singleflight so multiple modules/pages don't double-execute()
      if (window.__turnstileTokenPromise) return await window.__turnstileTokenPromise;
      window.__turnstileTokenPromise = new Promise(resolve => {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(host);
        let cleaned = false;
        const cleanup = (id) => { if (cleaned) return; cleaned = true; try { window.turnstile.remove(id); } catch {} try { host.remove(); } catch {} };
        let wid = null;
        try {
          wid = window.turnstile.render(host, {
            sitekey: window.TURNSTILE_SITE_KEY,
            // Turnstile no longer supports size "invisible"; use a valid size and keep the widget off-screen
            size: 'compact',
            // Auto-execute on render so we don't need to call execute() manually
            appearance: 'execute',
            callback: (token) => { resolve(token||''); cleanup(wid); },
            'error-callback': () => { resolve(''); cleanup(wid); },
            'timeout-callback': () => { resolve(''); cleanup(wid); }
          });
        } catch(err) { resolve(''); cleanup(wid); return; }
        setTimeout(()=>{ resolve(''); cleanup(wid); }, 8000);
      }).finally(()=>{ window.__turnstileTokenPromise = null; });
      return await window.__turnstileTokenPromise;
    } catch { return ''; }
  }

  // Expose a single shared token getter for other modules (e.g., forms.js) to reuse
  if (!window.getTurnstileToken) {
    try { window.getTurnstileToken = getTurnstileToken; } catch {}
  }

  // Timestamp for bot timing check (added to form submissions)
  try { window.__formStarted = Date.now(); } catch {}

// Augment PRODUCTS with locally built L-Screens catalog (screens-catalog.json) if present.
(async function mergeLocalScreens(){
  try {
    // Avoid 404s in dev: only fetch local catalogs when explicitly enabled
    if (!(window.ENABLE_LOCAL_CATALOG || /[?&]local-catalog=1\b/.test(location.search))) return;
    // Wait a tick for initial fetch to complete
    await new Promise(r=>setTimeout(r,300));
    const res = await fetch('assets/info/prodInfo/screens-catalog.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const local = await res.json();
    if (!Array.isArray(local) || !local.length) return;
    const existingIds = new Set(PRODUCTS.map(p=>p.id));
    let added = 0;
    local.forEach(p => {
      if (!existingIds.has(p.id)) {
        PRODUCTS.push({
          id: p.id,
          title: p.title || p.name || p.id,
          price: typeof p.price === 'number' ? p.price : Number(p.price) || 0,
          category: (p.category||'').toLowerCase() || 'misc',
          img: p.img || p.image || 'assets/img/EZSportslogo.png',
          images: Array.isArray(p.images) ? p.images.slice(0,8) : (p.image?[p.image]:[]),
          description: sanitizeDescription(p.description||''),
          features: Array.isArray(p.features) ? p.features.slice(0,25) : [],
          stock: p.stock
        });
        added++;
      }
    });
    if (added) { try { window.dispatchEvent(new CustomEvent('products:merged',{ detail:{ added } })); } catch {} }
  } catch(e) { /* silent */ }
})();

// Fallback: If no products loaded from API, try loading from local prodList.json
(async function fallbackToProdList(){
  try {
    await new Promise(r=>setTimeout(r,500)); // Wait for API and other merges
    if (PRODUCTS.length > 0) return; // Already have products, no need for fallback
    
  const res = await fetch('assets/prodList.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const prodList = await res.json();
    
    if (!prodList.categories) return;
    
    const fallbackProducts = [];
    Object.keys(prodList.categories).forEach(categoryName => {
      const products = prodList.categories[categoryName];
      products.forEach(product => {
        // Convert prodList format to app format
        const detailsPrice = product.details?.price;
        let mainPrice = 299; // fallback
        let priceRange = null;
        
        // Handle price range string (e.g., "399.95 - 549.95") or variations
        if (typeof detailsPrice === 'string' && detailsPrice.includes(' - ')) {
          priceRange = `$${detailsPrice}`;
          // Extract the first price as the main price for sorting/filtering
          const firstPrice = parseFloat(detailsPrice.split(' - ')[0]);
          if (!isNaN(firstPrice)) mainPrice = firstPrice;
        } else if (detailsPrice && !isNaN(detailsPrice)) {
          mainPrice = parseFloat(detailsPrice);
        } else if (product.variations?.[0]?.map) {
          mainPrice = product.variations[0].map;
        }
        
        fallbackProducts.push({
          id: product.sku,
          title: product.name || product.sku,
          price: mainPrice,
          priceRange: priceRange,
          category: 'netting',
          img: product.stripeImg || (Array.isArray(product.stripeImages) && product.stripeImages[0]) || product.img || 'assets/img/EZSportslogo.png',
          images: (Array.isArray(product.stripeImages) && product.stripeImages.length)
            ? product.stripeImages.slice()
            : (product.images || (product.img ? [product.img] : [])),
          description: sanitizeDescription(product.details?.description || ''),
          features: product.details?.features || [],
          variations: product.variations,
          stock: 10
        });
      });
    });
    
    if (fallbackProducts.length > 0) {
      PRODUCTS = fallbackProducts;
      try { 
        window.dispatchEvent(new CustomEvent('products:loaded', { 
          detail: { count: PRODUCTS.length, source: 'fallback' } 
        })); 
      } catch {}
    }
  } catch(e) { 
    console.warn('Fallback prodList.json also failed:', e);
  }
})();

// --- Telemetry helpers (analytics + error reporting) ---
function getVisitorId(){
  try {
    if (window.EZTrack && typeof window.EZTrack.getVisitorId === 'function') {
      return window.EZTrack.getVisitorId();
    }
  } catch {
    return 'v_' + Math.random().toString(16).slice(2);
  }
  return 'v_' + Math.random().toString(16).slice(2);
}

async function postToApi(path, payload){
  // When developing with Live Server (port 5500), avoid telemetry writes entirely.
  // Those writes can trigger live-reload loops (because JSON DB files change), and
  // POSTing to 5500 yields noisy 405s.
  const isDevSplit = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) && String(location.port) === '5500' && location.protocol.startsWith('http');
  if (isDevSplit) return false;

  const tryFetch = async (base) => {
    const url = (base ? base.replace(/\/$/,'') : '') + path;
    const controller = (window.AbortController ? new AbortController() : null);
    const t = controller ? setTimeout(()=>controller.abort(), 1500) : null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload || {}),
        keepalive: true,
        signal: controller ? controller.signal : undefined
      });
      return res && res.ok;
    } finally {
      if (t) clearTimeout(t);
    }
  };

  // Same-origin first
  try {
    if (await tryFetch('')) return true;
  } catch {}

  return false;
}

if (typeof window.trackEvent !== 'function') {
  window.trackEvent = function(eventName, payload) {
    try {
      if (window.EZTrack && typeof window.EZTrack.trackLegacy === 'function') {
        void window.EZTrack.trackLegacy(eventName, payload);
      }
    } catch {}
  };
}

function computeFeatured(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  // Pull counters
  let counters = { view_item: {}, add_to_cart: {} };
  try { counters = JSON.parse(localStorage.getItem('analyticsCounters')) || counters; } catch {}
  const totalEvents = Object.values(counters.view_item).reduce((a,b)=>a+b,0) + Object.values(counters.add_to_cart).reduce((a,b)=>a+b,0);
  const TARGET = 12;
  if (totalEvents < 30) { // Not enough signal yet → random unique selection
    const shuffled = products.slice().sort(()=>Math.random()-0.5);
    return shuffled.slice(0, Math.min(TARGET, shuffled.length));
  }
  // Popularity score: add_to_cart * 3 + view_item
  const score = (id) => (counters.add_to_cart[id]||0)*3 + (counters.view_item[id]||0);
  return products.slice().sort((a,b)=> score(b.id) - score(a.id)).slice(0, Math.min(TARGET, products.length));
}

const Store = {
  state: {
    filter: 'all',
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
    user: null,
  },

  // Helper to robustly derive the current page key (handles trailing slash and .html)
  getPageKey() {
    try {
      let path = (location.pathname || '').toLowerCase();
      if (path.endsWith('/')) path = path.slice(0, -1);
      const last = path.split('/').pop() || '';
      return last.replace(/\.html$/, '');
    } catch { return ''; }
  },

  // Expose a way to retrieve the current products list (admin-managed or defaults)
  getProducts() {
    // Previously this called a removed helper `getProducts()` which caused a ReferenceError
    // and stopped script execution before products could render. Now we simply return the
    // in‑memory PRODUCTS array populated by fetchProducts().
    return PRODUCTS;
  },

  keyFor(item) {
    const size = (item.size || '').trim() || '-';
    const color = (item.color || '').trim() || '-';
    return `${item.id}__${size}__${color}`;
  },

  init() {
    // Load current user
    try {
      this.state.user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch {
      this.state.user = null;
    }

    // Page classes for targeted styling
    try {
      const pageKey = this.getPageKey();
      if (pageKey) document.body.classList.add(`page-${pageKey}`);
      if (pageKey === 'l-screens') document.body.classList.add('lscreens-hub');
      const LS_PAGES = new Set(['baseball-l-screens','baseball-l-screen','protective-screens','pitchers-pocket','replacement-screens','bullet-pad-kits']);
      if (LS_PAGES.has(pageKey)) document.body.classList.add('lscreens-subnav');
    } catch {}

    this.ui = {
      grid: document.getElementById('product-grid'),
      count: document.getElementById('cart-count'),
      items: document.getElementById('cart-items'),
      subtotal: document.getElementById('cart-subtotal'),
      dialog: document.getElementById('mini-cart'),
    };

    // Ensure layout and nav
    try {
      // Global head/perf tweaks first
      try { this.ensurePerformanceOptimizations(); } catch {}
      try { this.ensureServiceWorkerRegistered(); } catch {}

      // Promo banner (must run before header/nav reveal)
      try { this.ensurePromoBanner(); } catch {}

      // Header and primary navigation
      try { this.ensureHeaderLayout(); } catch {}
      try { this.ensureCoreNav(); } catch {}
      try { this.ensureHomeFirst(); } catch {}

      // Account/login presence in header
      try { this.updateNavigation(); } catch {}

      // Page-level product grids (Accessories, Pre-Made Cages, etc.)
      try { this.ensurePageProductGrid(); } catch {}

      // Signal that navigation is ready so CSS can reveal the header bar
      try {
        document.documentElement.classList.add('nav-ready');
        document.body.classList.add('nav-ready');
      } catch {}

      // Accessibility, SEO, breadcrumbs, and footer
      try { this.ensureSkipLink(); } catch {}
      try { this.ensureBreadcrumbs(); } catch {}
      try { this.ensureSEO(); } catch {}
  try { this.ensureUniformFooter(); } catch {}
  try { this.attachSubscribeHandlers(); } catch {}

      // Page-specific enhancements (safe to call when not applicable)
      try { this.ensureNettingSubnav(); } catch {}
      try { this.ensureNettingCarousel(); } catch {}
      try { this.ensureFacilityDesignCarousel(); } catch {}
      try { this.ensureHeroRotator(); } catch {}
      try { this.ensureTypeTileImagesMatchSku(); } catch {}

      // Telemetry (analytics + error reporting)
      try { this.ensureTelemetry(); } catch {}

      const toggle = document.querySelector('.menu-toggle');
      const nav = document.getElementById('primary-nav');
      if (toggle && nav) {
        toggle.addEventListener('click', () => {
          const open = nav.classList.toggle('is-open');
          document.body.classList.toggle('nav-open', open);
          toggle.setAttribute('aria-expanded', String(open));
        });
        // Close nav when a link is chosen
        nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
          if (nav.classList.contains('is-open')) {
            nav.classList.remove('is-open');
            document.body.classList.remove('nav-open');
            toggle.setAttribute('aria-expanded', 'false');
          }
        }));
        // Close when clicking outside (mobile overlay)
        document.addEventListener('click', (e) => {
          if (!nav.classList.contains('is-open')) return;
          if (e.target === nav || nav.contains(e.target) || e.target === toggle || toggle.contains(e.target)) return;
          nav.classList.remove('is-open');
          document.body.classList.remove('nav-open');
          toggle.setAttribute('aria-expanded','false');
        });
      }

      // Keep responsive nav usable across resizes (especially around breakpoints)
      try { this.enforceResponsiveBehaviors && this.enforceResponsiveBehaviors(); } catch {}

      // Immediately sync cart UI on load so the header count reflects existing items
      try { this.renderCart(); } catch {}

      // Keep cart UI in sync across browser events and tabs
      try {
        // BFCache restore (back/forward, some refresh behaviors)
        window.addEventListener('pageshow', () => { try { this.rehydrateCart(); this.renderCart(); } catch {} });
        // Cross-tab/localStorage updates
        window.addEventListener('storage', (e) => {
          if (e && e.key === 'cart') {
            try { this.rehydrateCart(); this.renderCart(); } catch {}
          }
        });
      } catch {}

      // Delegate cart action clicks (inc/dec/remove) to the container once
      try {
        if (this.ui.items && !this.ui.items.__delegated) {
          this.ui.items.addEventListener('click', (ev) => {
            const btn = ev.target && (ev.target.closest('[data-inc], [data-dec], [data-remove]'));
            if (!btn) return;
            // Remove
            if (btn.dataset && btn.dataset.remove) {
              this.removeByKey(btn.dataset.remove);
              return;
            }
            // Increment
            if (btn.dataset && btn.dataset.inc) {
              const it = this.state.cart.find(x => this.keyFor(x) === btn.dataset.inc);
              if (it) { it.qty++; this.persist(); this.renderCart(); }
              return;
            }
            // Decrement
            if (btn.dataset && btn.dataset.dec) {
              const it = this.state.cart.find(x => this.keyFor(x) === btn.dataset.dec);
              if (it) {
                it.qty = Math.max(0, it.qty - 1);
                if (it.qty === 0) this.removeByKey(this.keyFor(it));
                else { this.persist(); this.renderCart(); }
              }
            }
          }, { passive: true });
          this.ui.items.__delegated = true;
        }
      } catch {}
    } catch {}
  },

  ensureTelemetry(){
    try {
      try {
        if (window.EZTrack && typeof window.EZTrack.boot === 'function') {
          window.EZTrack.boot({ trackPageView: true });
        }
      } catch {}

      const visitorId = getVisitorId();
      const shouldIgnoreClientError = (err, extra = {}) => {
        try {
          const message = String(err?.message || err || '').toLowerCase();
          const stack = String(err?.stack || '').toLowerCase();
          const filename = String(extra?.filename || '').toLowerCase();
          return message.includes("can't find variable: _autofillcallbackhandler")
            || stack.includes('_autofillcallbackhandler')
            || filename.includes('_autofillcallbackhandler');
        } catch {
          return false;
        }
      };

      // Client error reporting
      if (!window.__errorTelemetryBound) {
        window.__errorTelemetryBound = true;
        const report = (kind, err, extra = {}) => {
          try {
            const e = (err instanceof Error) ? err : new Error(String(err || 'Unknown error'));
            if (shouldIgnoreClientError(e, extra)) return;
            postToApi('/api/errors/report', {
              kind,
              severity: 'error',
              name: e.name,
              message: e.message,
              stack: e.stack,
              url: location.href,
              path: location.pathname,
              userAgent: navigator.userAgent,
              visitorId,
              userId: this.state.user ? this.state.user.id : null,
              meta: extra,
              ts: new Date().toISOString()
            }).catch(()=>{});
          } catch {}
        };

        window.addEventListener('error', (ev) => {
          try {
            // ev.error may be undefined for resource errors
            if (ev && ev.error) report('window.onerror', ev.error, { filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
            else report('window.onerror', new Error(String(ev?.message || 'Script error')), { filename: ev?.filename, lineno: ev?.lineno, colno: ev?.colno });
          } catch {}
        });
        window.addEventListener('unhandledrejection', (ev) => {
          try { report('unhandledrejection', ev && ev.reason ? ev.reason : 'Unhandled promise rejection'); } catch {}
        });
      }
    } catch {}
  },

  // Re-read cart from localStorage and discard invalid shapes
  rehydrateCart() {
    try {
      const raw = localStorage.getItem('cart');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) this.state.cart = arr;
    } catch {}
  },

// Build or normalize a canonical footer structure across all pages (Store method)
ensureUniformFooter() {
    try {
      let footer = document.querySelector('footer.site-footer');
      if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'site-footer';
        document.body.appendChild(footer);
      }
      // Canonical footer markup
      const html = `
        <div class="container footer-grid">
          <div class="footer-brand-block">
            <img src="assets/img/footLogo.png" height="168" alt="EZ Sports Netting logo"/>
            <div class="socials" aria-label="social links">
              <a href="https://www.facebook.com/profile.php?id=61572098432539" aria-label="Facebook" target="_blank" rel="noopener"><img src="assets/img/facebook.png?v=20251009" alt="Facebook"/></a>
              <a href="https://www.instagram.com/official_ezsportsnetting" aria-label="Instagram" target="_blank" rel="noopener"><img src="assets/img/instagram.png?v=20251009" alt="Instagram"/></a>
            </div>
          </div>
          <div>
            <h4>Shop</h4>
            <a href="ez-nets.html">EZ Custom Nets</a><br/>
            <a href="pre-made-cages.html">Pre-Made Cages</a><br/>
            <a href="l-screens.html">L-Screens</a><br/>
            <a href="accessories.html">Accessories</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="about.html">About</a><br/>
            <a href="contactus.html">Contact Us</a><br/>
            <a href="privacy-policy.html">Privacy Policy</a>
          </div>
          <form class="subscribe" method="post" action="#" autocomplete="off" novalidate>
            <h4>Get deals in your inbox</h4>
            <input type="text" name="hp" style="display:none" tabindex="-1" aria-hidden="true" autocomplete="off" />
            <input type="hidden" name="started" value="" />
            <input type="hidden" name="finger" value="ok" />
            <div class="row">
              <input type="email" placeholder="you@email.com" aria-label="Email address" required/>
              <button class="btn btn-primary" type="submit">Subscribe</button>
            </div>
          </form>
        </div>`;
      // Replace footer content only if different to avoid layout thrash
      if (footer.innerHTML.trim() !== html.trim()) {
        footer.innerHTML = html;
      }
    } catch {}
},

// Subscribe form: AJAX submit to /api/marketing/subscribe with basic UX
attachSubscribeHandlers() {
    try {
      const forms = document.querySelectorAll('form.subscribe');
      forms.forEach((form) => {
        if (form.__wired) return; // avoid duplicate bindings
        form.__wired = true;
        // Remove any inline onsubmit attributes added by legacy markup to prevent alert-only behavior
        try { form.removeAttribute('onsubmit'); } catch {}
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = form.querySelector('button[type="submit"]');
          const emailInput = form.querySelector('input[type="email"]');
          const hp = (form.querySelector('input[name="hp"]')?.value || '').trim();
          const email = (emailInput?.value || '').trim();
          if (!email) {
            emailInput?.focus();
            return;
          }
          if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }
          try {
            const payload = { email, source: 'footer', referer: location.href, hp };
            // Prefer calling the Render backend directly to ensure emails queue server-side
            // Build candidate API bases similar to analytics module
            const bases = [];
            try { if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, '')); } catch {}
            try { const meta = document.querySelector('meta[name="api-base"]'); if (meta && meta.content) bases.push(String(meta.content).replace(/\/$/, '')); } catch {}
            // Default Render base as final fallback
            bases.push('https://ezsportsapp.onrender.com');

            let lastErr = '';
            let ok = false;
            for (const base of bases) {
              try {
                const url = `${base}/api/marketing/subscribe`;
                const res = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'text/plain' },
                  body: JSON.stringify(payload),
                });
                if (res.ok) { ok = true; break; }
                lastErr = await res.text().catch(()=>`HTTP ${res.status}`);
              } catch (err) {
                lastErr = err?.message || 'Network error';
              }
            }
            if (ok) {
              form.innerHTML = '<h4>Thanks for subscribing!</h4><p>Check your inbox for a confirmation.</p>';
            } else {
              alert('Subscription failed. Please try again later.' + (lastErr ? `\n${lastErr}` : ''));
              if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
            }
          } catch (err) {
            alert('Network error. Please try again.');
            if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
          }
        }, { passive: false });
      });
    } catch {}
},

// Accessibility: ensure a skip link exists for keyboard users (Store method)
ensureSkipLink() {
    try {
      if (document.querySelector('a.skip')) return;
      const a = document.createElement('a');
      a.className = 'skip';
      a.href = '#main';
      a.textContent = 'Skip to content';
      // Insert as the first child of body
      document.body.insertAdjacentElement('afterbegin', a);
    } catch {}
},

// SEO: canonical/robots/OG/Twitter and JSON-LD (Organization + Breadcrumbs) (Store method)
ensureSEO() {
    try {
      const head = document.head;
      // Canonical
      if (!head.querySelector('link[rel="canonical"]')) {
        const link = document.createElement('link');
        link.rel = 'canonical';
        const base = location.origin || (location.protocol + '//' + location.host);
        link.href = base + location.pathname;
        head.appendChild(link);
      }
      // Robots
      if (!head.querySelector('meta[name="robots"]')) {
        const m = document.createElement('meta');
        m.name = 'robots';
        m.content = 'index,follow';
        head.appendChild(m);
      }
      // OG/Twitter fallback
      const title = document.title || 'EZ Sports Netting';
      const descEl = head.querySelector('meta[name="description"]');
        const desc = (descEl && descEl.getAttribute('content')) || 'Shop custom sports netting, pre-made cages, L-screens, replacement nets, bullet pad kits & accessories.';
      const url = (head.querySelector('link[rel="canonical"]')?.getAttribute('href')) || location.href;
  const defaultImage = (location.origin || '') + '/assets/img/EZSportslogo.png';
      const og = {
        'og:site_name': 'EZ Sports Netting',
        'og:type': 'website',
        'og:title': title,
        'og:description': desc,
        'og:url': url,
        'og:image': defaultImage
      };
      Object.entries(og).forEach(([p, v]) => {
        if (!head.querySelector(`meta[property="${p}"]`)) {
          const m = document.createElement('meta');
          m.setAttribute('property', p);
          m.setAttribute('content', v);
          head.appendChild(m);
        }
      });
      const tw = {
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:description': desc,
        'twitter:image': defaultImage
      };
      Object.entries(tw).forEach(([n, v]) => {
        if (!head.querySelector(`meta[name="${n}"]`)) {
          const m = document.createElement('meta');
          m.setAttribute('name', n);
          m.setAttribute('content', v);
          head.appendChild(m);
        }
      });
      // Ensure favicon uses current brand image
      let fav = head.querySelector('link[rel="icon"]');
      if (!fav) {
        fav = document.createElement('link');
        fav.rel = 'icon';
        fav.type = 'image/png';
        head.appendChild(fav);
      }
  const desiredFavicon = 'assets/img/EZSportslogo.png';
      if (fav.getAttribute('href') !== desiredFavicon) {
        fav.setAttribute('href', desiredFavicon);
      }
      // JSON-LD Organization (if not already present)
      const hasOrg = Array.from(head.querySelectorAll('script[type="application/ld+json"]')).some(s => /"@type"\s*:\s*"Organization"/i.test(s.textContent || ''));
      if (!hasOrg) {
        const s = document.createElement('script');
        s.type = 'application/ld+json';
        s.text = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'EZ Sports Netting',
          url: (location.origin || '') + '/',
          logo: (location.origin || '') + '/assets/img/EZSportslogo.png',
          sameAs: []
        });
        head.appendChild(s);
      }
      // JSON-LD Breadcrumbs when breadcrumbs nav exists
      const crumbsNav = document.querySelector('nav.breadcrumbs .crumbs');
      if (crumbsNav) {
        const items = Array.from(crumbsNav.querySelectorAll('li'));
        const list = items.map((li, idx) => {
          const a = li.querySelector('a');
          return {
            '@type': 'ListItem',
            position: idx + 1,
            name: (a ? a.textContent : li.textContent || '').trim(),
            item: a ? (new URL(a.getAttribute('href'), location.href)).href : (location.href)
          };
        });
        const hasBreadcrumb = Array.from(head.querySelectorAll('script[type="application/ld+json"]')).some(s => /"@type"\s*:\s*"BreadcrumbList"/i.test(s.textContent || ''));
        if (!hasBreadcrumb) {
          const s = document.createElement('script');
          s.type = 'application/ld+json';
          s.text = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list });
          head.appendChild(s);
        }
      }

      // Manifest and theme-color for PWA hints
      if (!head.querySelector('link[rel="manifest"]')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = 'manifest.webmanifest';
        head.appendChild(link);
      }
      if (!head.querySelector('meta[name="theme-color"]')) {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = '#0f2f50';
        head.appendChild(m);
      }
    } catch {}
},

// Performance: fonts/stripe preconnect, stylesheet preload, image lazy loading with LCP protection
ensurePerformanceOptimizations() {
    try {
      const head = document.head;
      const ensureLink = (attrs) => {
        const selector = Object.entries(attrs).map(([k, v]) => `[${k}="${v}"]`).join('');
        if (!head.querySelector(`link${selector}`)) {
          const l = document.createElement('link');
          Object.entries(attrs).forEach(([k, v]) => l.setAttribute(k, v));
          head.appendChild(l);
        }
      };
      // Feature detection and conditional compat.css load (runs once)
      (function compatDetect(){
        try {
          const html = document.documentElement;
          // flex-gap detection
          let flexGap = true;
          try {
            const d = document.createElement('div');
            d.style.display = 'flex'; d.style.gap = '1px';
            d.appendChild(document.createElement('div'));
            d.appendChild(document.createElement('div'));
            document.body.appendChild(d);
            flexGap = (d.scrollHeight === 1) || (d.getBoundingClientRect().height <= 2);
            d.remove();
          } catch { flexGap = false; }
          if (!flexGap) html.classList.add('no-flex-gap');

          // aspect-ratio support
          if (!CSS || !CSS.supports || !CSS.supports('aspect-ratio: 4/3')) {
            html.classList.add('no-aspect-ratio');
          }
          // color-mix support
          try {
            if (!(CSS && CSS.supports && CSS.supports('background: color-mix(in oklab, #fff 50%, #000 50%)'))) {
              html.classList.add('no-color-mix');
            }
          } catch { html.classList.add('no-color-mix'); }
          // backdrop-filter support
          try {
            if (!(CSS && CSS.supports && (CSS.supports('backdrop-filter: blur(2px)') || CSS.supports('-webkit-backdrop-filter: blur(2px)')))) {
              html.classList.add('no-backdrop-filter');
            }
          } catch { html.classList.add('no-backdrop-filter'); }

          // If any no-* class applied, ensure compat.css is loaded
          const needCompat = html.classList.contains('no-flex-gap')
            || html.classList.contains('no-aspect-ratio')
            || html.classList.contains('no-color-mix')
            || html.classList.contains('no-backdrop-filter');
          if (needCompat && !head.querySelector('link[rel="stylesheet"][href*="assets/css/compat.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'assets/css/compat.css';
            head.appendChild(link);
          }
        } catch {}
      })();
      // Preconnects
      ensureLink({ rel: 'preconnect', href: 'https://fonts.googleapis.com' });
      ensureLink({ rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' });
      // Stripe only where likely used; add generically as it’s cheap
      ensureLink({ rel: 'preconnect', href: 'https://js.stripe.com' });

      // Ensure Google Fonts CSS present (Outfit) to reduce FOUT inconsistencies
      const hasOutfit = Array.from(head.querySelectorAll('link[href*="fonts.googleapis.com"]')).some(l => /Outfit/i.test(l.href));
      if (!hasOutfit) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800;900&display=swap';
        head.appendChild(l);
      }

      // Preload main stylesheet
      const cssLink = head.querySelector('link[rel="stylesheet"][href*="assets/css/styles.css"]');
      if (cssLink && !head.querySelector('link[rel="preload"][as="style"][href="' + cssLink.getAttribute('href') + '"]')) {
        ensureLink({ rel: 'preload', as: 'style', href: cssLink.getAttribute('href') });
      }

      // Image loading tweaks
      const isHero = (img) => img.closest('.hero, .hero-art, .net-hero, .netting-hero, .turf-hero');
      // Promote first hero/primary image
      const lcpCandidate = document.querySelector('.hero-art img, .net-hero img, .netting-hero img, main img');
      if (lcpCandidate) {
        lcpCandidate.setAttribute('fetchpriority', 'high');
        lcpCandidate.setAttribute('loading', 'eager');
        lcpCandidate.setAttribute('decoding', 'async');
      }
      // Lazy load all other images
      document.querySelectorAll('img').forEach(img => {
        if (img === lcpCandidate) return;
        if (!isHero(img)) {
          if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
          img.setAttribute('decoding', 'async');
        }
      });
  } catch {}
},

// PWA: register Service Worker for production only
ensureServiceWorkerRegistered() {
    try {
      const isProd = (location.protocol === 'https:') && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
      if (!('serviceWorker' in navigator) || !isProd) return;
      navigator.serviceWorker.getRegistration().then(reg => {
        if (!reg) navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
      }).catch(()=>{});
  } catch {}
},

// Sitewide promo banner (fixed top, attention grabbing)
ensurePromoBanner() {
    try {
      const defaults = {
        // UX request: keep promo banner hidden by default.
        // To re-enable later without code changes, set `window.PROMO_BANNER = { enabled: true, ... }`
        // before this script runs.
        enabled: false,
        id: 'promo-2026-01',
        message: 'Limited-time promo: Free training facility design consult.',
        ctaText: 'Request Quote',
        href: 'contactus.html',
        postDismissText: 'Call Us Now. Start your design today!',
        postDismissHref: 'contactus.html',
        phoneText: '(386) 837-3131',
        phoneHref: 'tel:+13868373131',
        dismissible: true,
      };
      const cfg = (window.PROMO_BANNER && typeof window.PROMO_BANNER === 'object')
        ? { ...defaults, ...window.PROMO_BANNER }
        : defaults;
      if (!cfg.enabled) return;

      const key = `promoDismissed:${cfg.id}`;
      let dismissed = false;
      try { dismissed = (cfg.dismissible && localStorage.getItem(key) === '1'); } catch {}

      if (document.querySelector('.promo-banner')) return;

      const bar = document.createElement('div');
      bar.className = 'promo-banner';
      bar.setAttribute('role', 'region');

      const safeMsg = String(cfg.message || '').trim();
      const ctaText = String(cfg.ctaText || '').trim();
      const href = String(cfg.href || '').trim();

      const renderPromo = () => {
        bar.classList.remove('is-cta');
        bar.setAttribute('aria-label', 'Promotion');
        bar.innerHTML = `
          <div class="container promo-inner">
            <div class="promo-left">
              <span class="promo-text">${safeMsg}</span>
            </div>
            <div class="promo-right">
              ${href ? `<a class="promo-cta" href="${href}">${ctaText || 'Learn more'}</a>` : ''}
              ${cfg.dismissible ? `<button type="button" class="promo-close" aria-label="Dismiss promotion">×</button>` : ''}
            </div>
          </div>`;
      };

      const renderPostDismissCta = () => {
        const postText = String(cfg.postDismissText || '').trim() || 'Call Us Now. Start your design today!';
        const postHref = String(cfg.postDismissHref || '').trim() || 'contactus.html';
        const phoneText = String(cfg.phoneText || '').trim() || '(386) 837-3131';
        const phoneHref = String(cfg.phoneHref || '').trim() || 'tel:+13868373131';

        bar.classList.add('is-cta');
        bar.setAttribute('aria-label', 'Call to action');
        bar.innerHTML = `
          <div class="container promo-inner">
            <div class="promo-title"><a href="${postHref}">${postText}</a></div>
            <a class="promo-phone" href="${phoneHref}" aria-label="Call EZ Sports Netting at ${phoneText}">${phoneText}</a>
          </div>`;
      };

      const setTopBannerOffset = () => {
        try {
          const h = Math.ceil(bar.getBoundingClientRect().height || 0);
          const px = `${h}px`;
          document.documentElement.style.setProperty('--top-banner-height', px);
          document.body.style.setProperty('--top-banner-height', px);
        } catch {}
      };

      const enableTopBannerLayout = () => {
        try {
          document.documentElement.classList.add('has-top-banner');
          document.body.classList.add('has-top-banner');
          // Backwards-compat for older CSS selectors
          document.documentElement.classList.add('has-promo-banner');
          document.body.classList.add('has-promo-banner');
        } catch {}
      };

      const disableTopBannerLayout = () => {
        try {
          document.documentElement.classList.remove('has-top-banner');
          document.body.classList.remove('has-top-banner');
          document.documentElement.classList.remove('has-promo-banner');
          document.body.classList.remove('has-promo-banner');
          document.documentElement.style.removeProperty('--top-banner-height');
          document.body.style.removeProperty('--top-banner-height');
        } catch {}
      };

      enableTopBannerLayout();
      dismissed ? renderPostDismissCta() : renderPromo();

      // Keep skip-link first for accessibility if present
      const skip = document.querySelector('a.skip');
      if (skip && skip.parentNode) {
        skip.insertAdjacentElement('afterend', bar);
      } else {
        document.body.insertBefore(bar, document.body.firstChild);
      }

      // Apply the correct top offset so the whole page shifts down (not just the header)
      setTopBannerOffset();
      try {
        window.addEventListener('resize', () => setTopBannerOffset(), { passive: true });
      } catch {}

      // Dismiss handling
      const btn = bar.querySelector('.promo-close');
      if (btn) {
        btn.addEventListener('click', () => {
          try { localStorage.setItem(key, '1'); } catch {}
          try { renderPostDismissCta(); } catch {}
          try { setTopBannerOffset(); } catch {}
        });
      }
    } catch {}
  },

ensureHeaderLayout() {
    const header = document.querySelector('.site-header .header-bar');
    if (!header) return;

    // Ensure actions container exists
    let actions = document.getElementById('header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'header-actions';
      actions.className = 'header-actions';
      const search = header.querySelector('.search');
      if (search && search.nextSibling) {
        header.insertBefore(actions, search.nextSibling);
      } else {
        header.appendChild(actions);
      }
    }

    // Ensure cart button lives in the header-actions (right side), not inside the nav
    try {
      const nav = document.getElementById('primary-nav') || header.querySelector('nav.quick-links');
      const cartBtnInNav = nav ? nav.querySelector('.cart-btn') : null;
      const cartBtnLoose = header.querySelector('.cart-btn');
      const cartBtn = cartBtnInNav || cartBtnLoose;
      if (cartBtn && actions && cartBtn.parentElement !== actions) {
        actions.appendChild(cartBtn);
      }
      // If no cart button exists at all (legacy markup removed it), create one
      if (!actions.querySelector('.cart-btn')) {
        const btn = document.createElement('button');
        btn.className = 'cart-btn';
        btn.type = 'button';
        btn.setAttribute('aria-haspopup','dialog');
        btn.setAttribute('aria-controls','mini-cart');
        btn.innerHTML = `<span class="icon">🛒</span> <span class="cart-count" id="cart-count">0</span>`;
        btn.addEventListener('click', () => this.toggleCart());
        actions.appendChild(btn);
        // Update UI refs if they weren't bound yet
        this.ui.count = document.getElementById('cart-count');
      }
    } catch {}

    // Standardize search bar (placeholder, button classes/text)
    const search = header.querySelector('.search');
    if (search) {
      const input = search.querySelector('input[type="search"]');
      if (input) input.placeholder = 'Search bats, gloves, helmets…';
      let btn = search.querySelector('button[type="submit"]');
      if (!btn) {
        btn = document.createElement('button');
        // Decorative search icon sits inside input; submission still via Enter key
        btn.type = 'button';
        search.appendChild(btn);
      }
  btn.className = 'btn btn-primary search-icon-btn';
  btn.textContent = '';
  btn.setAttribute('aria-hidden','true');
  btn.tabIndex = -1;

      // Ensure search submission navigates to Search Results page
      search.removeAttribute('onsubmit');
      search.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = (input?.value || '').trim();
        const url = 'search-results.html' + (q ? `?q=${encodeURIComponent(q)}` : '');
        window.location.href = url;
      }, { once: false });
    }

    // Ensure menu toggle has aria-label when icon-only on very small screens
    const menuToggle = header.querySelector('.menu-toggle');
    if (menuToggle && !menuToggle.getAttribute('aria-label')) {
      menuToggle.setAttribute('aria-label','Toggle navigation');
    }
},

ensureCoreNav() {
  let nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    // If no nav exists, synthesize one inside the header bar so layout stays consistent
    if (!nav) {
      const headerBar = document.querySelector('.site-header .header-bar');
      if (!headerBar) return;
      nav = document.createElement('nav');
      nav.id = 'primary-nav';
      nav.className = 'quick-links';
      nav.setAttribute('aria-label','Primary');
      headerBar.appendChild(nav);
    }

    // Deactivate legacy nav (kept for later reference):
    // const legacy = [ 'Deals','Bats','Gloves','Batting Gloves','Drip','Gear','Apparel','Facility & Field','Turf' ];

    // Clear any pre-existing anchors (static markup or earlier scripts) to enforce a canonical nav
  // Preserve a cart button if it already exists inside nav so we can re-append after links
  let cartBtn = nav.querySelector('.cart-btn');
  try { while (nav.firstChild) nav.removeChild(nav.firstChild); } catch {}

    // Canonical nav definition (mirrors ez-nets.html requirement and applied site‑wide)
    const canonical = [
      { href: 'index.html', text: 'Home' },
      { href: 'about.html', text: 'About' },
      { href: 'ez-nets.html', text: 'EZ Custom Nets' },
      { href: 'training-facility-design.html', text: 'Training Facility Design' },
      { href: 'pre-made-cages.html', text: 'Pre-Made Cages' },
      { href: 'l-screens.html', text: 'L-Screens' },
      { href: 'accessories.html', text: 'Accessories' },
      { href: 'contactus.html', text: 'Contact Us' }
    ];
    canonical.forEach(item => {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.text;
      nav.appendChild(a);
    });
    if (cartBtn) nav.appendChild(cartBtn);

  // Cart button is handled by ensureHeaderLayout (moved into header-actions)

    // Active link highlighting
    const path = location.pathname.split('/').pop() || 'index.html';
    const candidates = Array.from(nav.querySelectorAll('a')).filter(a => a.getAttribute('href') && !a.closest('.nav-submenu'));
    const active = candidates.find(a => (a.getAttribute('href') || '').endsWith(path));
    if (active) { active.classList.add('is-active'); active.setAttribute('aria-current','page'); }

    // (De-duplication obsolete after hard reset, retained defensively for any runtime injections)
    try {
      const seen = new Set();
      Array.from(nav.querySelectorAll(':scope > a')).forEach(a => {
        const key = (a.getAttribute('href')||'').trim() + '::' + (a.textContent||'').trim().toLowerCase();
        if (seen.has(key)) a.remove(); else seen.add(key);
      });
    } catch {}

    // Page-specific nav adjustment: On L-Screens page, hide Netting Calculator link if present
    try {
      const basePage = path.toLowerCase();
      if (basePage === 'l-screens.html' || basePage === 'l-screens') {
        const calc = Array.from(nav.querySelectorAll('a')).find(a => /netting-calculator\.html$/i.test(a.getAttribute('href')||''));
        if (calc) calc.remove();
      }
  } catch {}
},

// Guarantee the Home link exists and is first in the primary nav
ensureHomeFirst() {
    try {
      const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
      if (!nav) return;
      const children = Array.from(nav.children);
      // Find an existing Home anchor (match by href ending or text content)
      let home = children.find(el => el.tagName === 'A' && /index\.html$/i.test(el.getAttribute('href')||''))
        || children.find(el => el.tagName === 'A' && (el.textContent||'').trim().toLowerCase() === 'home');
      if (!home) {
        home = document.createElement('a');
        home.href = 'index.html';
        home.textContent = 'Home';
      }
      // If Home is not the first child, move or insert it
      if (nav.firstElementChild !== home) {
        nav.insertBefore(home, nav.firstElementChild || null);
      }
    } catch {/* non-fatal */}
  },


  updateNavigation() {
    const actions = document.getElementById('header-actions') || document.querySelector('.header-actions');
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;

    // Clear any existing auth/user elements inside nav to avoid duplicates
    nav.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());
    // Also clear prior ones in actions (legacy)
    if (actions) actions.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());

    if (this.state.user) {
      const userMenu = document.createElement('div');
      userMenu.className = 'user-menu';
      const initials = (this.state.user.name || this.state.user.email || 'U').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
      userMenu.innerHTML = `
        <button class="profile-btn" id="profile-btn" aria-haspopup="menu" aria-expanded="false" title="Account">
          <span class="avatar">${initials}</span>
        </button>
        <div class="user-dropdown" id="user-dropdown" role="menu" aria-hidden="true">
          <div class="user-summary">
            <strong>${this.state.user.name || this.state.user.email}</strong><br/>
            <small>${this.state.user.email || ''}</small>
          </div>
          <a href="account.html" role="menuitem">Account</a>
          <a href="order-history.html" role="menuitem">Orders</a>
          ${this.state.user.isAdmin ? '<a href="admin.html" role="menuitem">Admin</a>' : ''}
          <button type="button" data-logout role="menuitem">Logout</button>
        </div>`;
  // Prefer right-side header actions for the user menu; fallback to nav if needed
  if (actions) actions.appendChild(userMenu); else nav.appendChild(userMenu);

      const btn = userMenu.querySelector('#profile-btn');
      const dd = userMenu.querySelector('#user-dropdown');
      const close = () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded','false'); dd.setAttribute('aria-hidden','true'); };
      const open = () => { dd.classList.add('open'); btn.setAttribute('aria-expanded','true'); dd.setAttribute('aria-hidden','false'); };
      btn.addEventListener('click', (e)=>{ e.stopPropagation(); dd.classList.contains('open')?close():open(); });
      document.addEventListener('click', (e)=>{ if (!userMenu.contains(e.target)) close(); }, { capture:true });
      const logoutBtn = userMenu.querySelector('[data-logout]');
      if (logoutBtn) logoutBtn.addEventListener('click', ()=> this.logout());
    } else {
      const loginLink = document.createElement('a');
      loginLink.href = 'login.html';
      loginLink.className = 'auth-link';
      loginLink.textContent = 'Login';
      if (actions) actions.appendChild(loginLink); else nav.appendChild(loginLink);
    }

  // Hide header-actions if empty
  if (actions && actions.children.length === 0) actions.style.display = 'none';

    // Ensure header break element still exists for layout but not needed for actions now
    (function(){
      try {
        const header = document.querySelector('.site-header .header-bar');
        if (!header) return;
        if (!header.querySelector('.header-break')) {
          const br = document.createElement('span');
          br.className = 'header-break';
          br.setAttribute('aria-hidden','true');
          const menu = header.querySelector('.menu-toggle');
          if (menu) header.insertBefore(br, menu);
          else header.appendChild(br);
        }
      } catch {}
    })();
  },
  async ensureBreadcrumbs() {
    const existing = document.querySelector('nav.breadcrumbs');
    const main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return;
    const base = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

    // Special handling for product detail page: defer until products loaded so we can get title/category
    if (base === 'product.html') {
      // If we already rendered product breadcrumbs, exit
      if (existing && existing.hasAttribute('data-product-bc')) return;
      // Remove any generic breadcrumbs so we can rebuild with product context
      if (existing && !existing.hasAttribute('data-product-bc')) existing.remove();
    } else {
      // Non-product pages: if breadcrumbs already exist, exit
      if (existing) return;
    }
  const TITLES = {
      'index.html': 'Home',
      'about.html': 'About',
    'careers.html': 'Careers',
      'login.html': 'Login',
      'checkout.html': 'Checkout',
      'admin.html': 'Admin',
      'order-history.html': 'Order History',
      'netting-calculator.html': 'Netting Calculator',
    // Primary nav canonical set
    'ez-nets.html': 'EZ Custom Nets',
    'l-screens.html': 'L-Screens',
    'accessories.html': 'Accessories',
    'contactus.html': 'Contact Us',
    // Product category landing pages & legacy/shop links (ensure breadcrumb coverage if linked internally)
    'hitting-facility.html':'Hitting Facility',
    'batting-cage.html':'Batting Cage',
    'foul-ball.html':'Foul Ball Netting',
    'backstop.html':'Backstop Netting',
    // L-Screens subpages
    'baseball-l-screens.html':'Baseball L-Screens',
    'protective-screens.html':'Protective Screens',
    'pitchers-pocket.html':"Pitcher's Pocket",
  'replacement-screens.html':'Replacement Screens',
  'bullet-pad-kits.html': 'Bullet Pad Kits',
  'pre-made-cages.html': 'Pre-Made Cages',
    // Netting categories
    'training-facility.html':'Training Facility',
    'residential-golf.html':'Residential Golf Netting',
    'sports-netting.html':'Sports Netting',
    'basketball.html':'Basketball Netting',
    'hockey.html':'Hockey Netting',
    'softball.html':'Softball Netting',
    'tennis.html':'Tennis Netting',
    'volleyball.html':'Volleyball Netting',
    'commercial-netting.html':'Commercial Netting',
      'baseball-netting.html': 'Baseball Netting',
      'golf-netting.html': 'Golf Netting',
      'lacrosse-netting.html': 'Lacrosse Netting',
      'soccer-netting.html': 'Soccer Netting',
      'bats.html': 'Bats',
      'gloves.html': 'Gloves',
      'batting-gloves.html': 'Batting Gloves',
      'drip.html': 'Drip',
      'gear.html': 'Gear',
      'apparel.html': 'Apparel',
  'l-screens.html': 'L-Screens',
  'accessories.html': 'Accessories',
      'facility-field.html': 'Facility & Field'
    };

    const crumbs = [];
    crumbs.push({ label: 'Home', href: 'index.html' });
  const L_SUBPAGES = new Set(['baseball-l-screens.html','protective-screens.html','pitchers-pocket.html','replacement-screens.html']);
    if (L_SUBPAGES.has(base)) {
      crumbs.push({ label: 'L-Screens', href: 'l-screens.html' });
    }
  // Reparent Bullet Pad Kits under Accessories for non-product page
  if (base === 'bullet-pad-kits.html') {
    crumbs.push({ label: 'Accessories', href: 'accessories.html' });
  }
    if (base === 'product.html') {
      const params = new URLSearchParams(location.search);
      const pid = params.get('pid');
      const pidLower = String(pid || '').toLowerCase();
      // Special-case: Pre-Made Cages grouped product pages
      const pidKey = (pid||'').toLowerCase();
      const GROUP_TITLES = {
        'cages-21nylon': '#21 Nylon',
        'cages-36nylon': '#36 Nylon',
        'cages-36poly': '#36 Poly'
      };
      if (GROUP_TITLES[pidKey]) {
        crumbs.push({ label: 'Pre-Made Cages', href: 'pre-made-cages.html' });
        crumbs.push({ label: GROUP_TITLES[pidKey], href: null });
        // Build DOM immediately for this synthetic product case
        const nav = document.createElement('nav');
        nav.className = 'breadcrumbs container wrap';
        nav.setAttribute('aria-label', 'Breadcrumb');
        const ol = document.createElement('ol');
        ol.className = 'crumbs';
        crumbs.forEach((c, idx) => {
          const li = document.createElement('li');
          if (c.href && idx < crumbs.length - 1) {
            const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
          } else {
            const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
          }
          ol.appendChild(li);
        });
        nav.appendChild(ol);
        nav.setAttribute('data-product-bc','');
        main.parentNode.insertBefore(nav, main);
        try { this.ensureSEO(); } catch {}
        return; // done
      }
      // Special-case: Forever Black Twine Spool grouped product page
      if (pidKey === 'twine-forever-black') {
        crumbs.push({ label: 'Accessories', href: 'accessories.html' });
        crumbs.push({ label: 'Forever Black Twine Spool', href: null });
        const nav = document.createElement('nav');
        nav.className = 'breadcrumbs container wrap';
        nav.setAttribute('aria-label', 'Breadcrumb');
        const ol = document.createElement('ol');
        ol.className = 'crumbs';
        crumbs.forEach((c, idx) => {
          const li = document.createElement('li');
          if (c.href && idx < crumbs.length - 1) {
            const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
          } else {
            const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
          }
          ol.appendChild(li);
        });
        nav.appendChild(ol);
        nav.setAttribute('data-product-bc','');
        main.parentNode.insertBefore(nav, main);
        try { this.ensureSEO(); } catch {}
        return;
      }
      // Special-case: Cable grouped product page
      if (pidKey === 'cable-wire') {
        crumbs.push({ label: 'Accessories', href: 'accessories.html' });
        crumbs.push({ label: 'Cable', href: null });
        const nav = document.createElement('nav');
        nav.className = 'breadcrumbs container wrap';
        nav.setAttribute('aria-label', 'Breadcrumb');
        const ol = document.createElement('ol');
        ol.className = 'crumbs';
        crumbs.forEach((c, idx) => {
          const li = document.createElement('li');
          if (c.href && idx < crumbs.length - 1) {
            const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
          } else {
            const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
          }
          ol.appendChild(li);
        });
        nav.appendChild(ol);
        nav.setAttribute('data-product-bc','');
        main.parentNode.insertBefore(nav, main);
        try { this.ensureSEO(); } catch {}
        return;
      }
      // Special-case: 5/16" Poly Twisted Rope grouped product page
      if (pidKey === 'rope-516-poly') {
        crumbs.push({ label: 'Accessories', href: 'accessories.html' });
        crumbs.push({ label: '5/16" Poly Twisted Rope', href: null });
        const nav = document.createElement('nav');
        nav.className = 'breadcrumbs container wrap';
        nav.setAttribute('aria-label', 'Breadcrumb');
        const ol = document.createElement('ol');
        ol.className = 'crumbs';
        crumbs.forEach((c, idx) => {
          const li = document.createElement('li');
          if (c.href && idx < crumbs.length - 1) {
            const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
          } else {
            const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
          }
          ol.appendChild(li);
        });
        nav.appendChild(ol);
        nav.setAttribute('data-product-bc','');
        main.parentNode.insertBefore(nav, main);
        try { this.ensureSEO(); } catch {}
        return;
      }
      let prod = null;
      let foundCategoryName = '';
      // 1) Try unified catalog if present (product-loader)
      try {
        if (!prod && Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length && pid) {
          const rec = window.CATALOG_PRODUCTS.find(r => {
            const rid = String(r.id || '').toLowerCase();
            const rsku = String(r.sourceSKU || '').toLowerCase();
            return rid === pidLower || rsku === pidLower;
          });
          if (rec) { prod = rec.raw || rec; }
        }
      } catch {}
      // 2) Try API products
      if (!prod && Array.isArray(PRODUCTS) && PRODUCTS.length && pid) {
        prod = PRODUCTS.find(p => {
          const pidish = String(p.id || '').toLowerCase();
          const psku = String(p.sku || '').toLowerCase();
          return pidish === pidLower || psku === pidLower;
        });
      }
      // 3) Fallback to prodList.json
      if (!prod && pid) {
        try {
          const data = await this.fetchProdList();
          if (data && data.categories && typeof data.categories === 'object') {
            for (const [catName, arr] of Object.entries(data.categories)) {
              if (!Array.isArray(arr)) continue;
              const hit = arr.find(p => String(p.sku||p.id||'').toLowerCase() === pidLower);
              if (hit) { prod = hit; foundCategoryName = catName; break; }
            }
          }
        } catch {}
      }
      // Derive category mapping to page
      const resolveCategory = (p) => {
        const name = (p?.name || p?.title || '').toLowerCase();
        const sku = String(p?.sku || p?.id || '').toLowerCase();
        const pathName = (Array.isArray(p?.details?.category_path) && p.details.category_path[0]) || '';
        const categoryField = String(p?.category || p?.__category || '').trim();
        const catName = pathName || foundCategoryName || categoryField;
        // Direct category name mapping
        const direct = {
          "Baseball L-Screens": { label: 'Baseball L-Screens', href: 'baseball-l-screens.html' },
          "Better Baseball L-Screens": { label: 'Baseball L-Screens', href: 'baseball-l-screens.html' },
          "Pitcher's Pocket": { label: "Pitcher's Pocket", href: 'pitchers-pocket.html' },
          "Replacement Nets": { label: 'Replacement Screens', href: 'replacement-screens.html' },
          "Accessories": { label: 'Accessories', href: 'accessories.html' },
          "Pre-Made Cages": { label: 'Pre-Made Cages', href: 'pre-made-cages.html' },
          // Move Bullet Pad Kits under Accessories
          "Bullet Pad Kits": { label: 'Accessories', href: 'accessories.html' }
        };
        if (catName && direct[catName]) return direct[catName];

        // Category field can come in as a lowercase slug from the API (e.g., "accessories")
        const catLower = String(catName || '').toLowerCase();
        if (catLower === 'accessories') return { label: 'Accessories', href: 'accessories.html' };
        if (catLower === 'pre-made cages' || catLower === 'pre-made-cages' || catLower === 'premade cages') return { label: 'Pre-Made Cages', href: 'pre-made-cages.html' };
        if (catLower === 'replacement nets' || catLower === 'replacement-nets') return { label: 'Replacement Screens', href: 'replacement-screens.html' };
        if (catLower === "pitcher's pocket" || catLower === 'pitchers pocket' || catLower === 'pitchers-pocket') return { label: "Pitcher's Pocket", href: 'pitchers-pocket.html' };
        if (catLower === 'baseball l-screens' || catLower === 'baseball-l-screens') return { label: 'Baseball L-Screens', href: 'baseball-l-screens.html' };
        // Heuristics by product name/sku
        if (/replacement/.test(name) || /\brn-/.test(sku)) return { label: 'Replacement Screens', href: 'replacement-screens.html' };
        if (/pitcher|pocket/.test(name) || /bbpp/.test(sku)) return { label: "Pitcher's Pocket", href: 'pitchers-pocket.html' };
        if (/protective\s+screen/.test(name)) return { label: 'Protective Screens', href: 'protective-screens.html' };
        if (/l[- ]?screen/.test(name) || /^bullet/.test(name)) return { label: 'Baseball L-Screens', href: 'baseball-l-screens.html' };
        // Pad kits are now considered Accessories
        if (/pad\s*kit/.test(name) || /^pk-/.test(sku)) return { label: 'Accessories', href: 'accessories.html' };
        // Accessories keyword fallback (covers Batting Mat, Armor Basket, etc.)
        if (/\b(accessor(y|ies)|cable|twine|rope|basket|mat|screen\s*bulletz|armor)\b/.test(name) || /\b(battingmat|armorbasket|wbasket)\b/.test(sku)) {
          return { label: 'Accessories', href: 'accessories.html' };
        }
        return { label: 'EZ Custom Nets', href: 'ez-nets.html' };
      };
      if (prod) {
        const catCrumb = resolveCategory(prod);
        // If this is an L-Screens subpage, also place parent L-Screens hub before category where applicable
        const lScreenPages = new Set(['baseball-l-screens.html','protective-screens.html','pitchers-pocket.html','replacement-screens.html','bullet-pad-kits.html']);
        if (lScreenPages.has(catCrumb.href)) {
          crumbs.push({ label: 'L-Screens', href: 'l-screens.html' });
        }
        crumbs.push(catCrumb);
        const title = String(prod.title || prod.name || pid);
        crumbs.push({ label: title, href: null });
      } else {
        // Fallback without product: just show Product
        crumbs.push({ label: 'Product', href: null });
      }
    } else if (base !== 'index.html') {
      crumbs.push({ label: TITLES[base] || (document.title?.split('—')[0].trim() || 'Current'), href: null });
    }

    // Build DOM
    const nav = document.createElement('nav');
    nav.className = 'breadcrumbs container wrap';
    nav.setAttribute('aria-label', 'Breadcrumb');
    const ol = document.createElement('ol');
    ol.className = 'crumbs';
    crumbs.forEach((c, idx) => {
      const li = document.createElement('li');
      if (c.href && idx < crumbs.length - 1) {
        const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
      } else {
        const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
      }
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    if (base === 'product.html') nav.setAttribute('data-product-bc','');
    main.parentNode.insertBefore(nav, main);
    // Re-run SEO injection now that breadcrumbs exist so JSON-LD BreadcrumbList is added
    try { this.ensureSEO(); } catch {}
  },

  // Standardize the EZ Custom Nets sub-navigation across all netting-related pages and append Expert CTA action
  ensureNettingSubnav() {
    try {
  const container = document.getElementById('netting-subnav');
      if (!container) return;
      // Canonical order for EZ Custom Nets category navigation
  const base = (location.pathname.split('/').pop() || '').toLowerCase();
      // On EZ Nets overview, the calculator is promoted to a dedicated hero panel (not a sub-nav tab).
      const TOP = (base === 'ez-nets.html')
        ? [
            { label: 'Baseball', href: 'baseball-netting.html' },
            { label: 'Training Facility', href: 'training-facility.html' },
            { label: 'Golf', href: 'golf-netting.html' },
            { label: 'Sports', href: 'sports-netting.html' },
            { label: 'Commercial', href: 'commercial-netting.html' }
          ]
        : [
            { label: 'Overview', href: 'ez-nets.html' },
            { label: 'Baseball', href: 'baseball-netting.html' },
            { label: 'Training Facility', href: 'training-facility.html' },
            { label: 'Golf', href: 'golf-netting.html' },
            { label: 'Sports', href: 'sports-netting.html' },
            { label: 'Commercial', href: 'commercial-netting.html' },
            { label: 'Calculator', href: 'netting-calculator.html' }
          ];
      // Rebuild only if markup differs from expected list
  const html = TOP.map(i => `<a href="${i.href}">${i.label}</a>`).join('');
  container.innerHTML = html;
  container.classList.add('is-ready');
      [...container.querySelectorAll('a')].forEach(a => {
        if ((a.getAttribute('href') || '').toLowerCase() === base) a.classList.add('is-active');
      });
  // No extra button per uniform sub-nav requirement
    } catch {}
  },

  // Build a simple gallery grid on netting category pages (no horizontal scroll)
  ensureNettingCarousel() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      // Define slide titles for each netting page. These are intentionally concise for dot aria-labels & captions.
      const DATA = {
        'baseball-netting.html': [ 'Hitting Facility','Batting Cage','Foul Ball','Overhead','Backstop' ],
        'golf-netting.html': [ 'Driving Range','Golf Course','Golf Cube','Residential' ],
        'commercial-netting.html': [ 'Auto-Drone','Drone Enclosure','Warehouse','Safety','Debris','Landfill' ],
        // Split the previous combined label 'Cricket Football' into two separate slides
        'sports-netting.html': [ 'Baseball','Basketball','Cricket','Football','Golf','Hockey','Lacrosse','Multi-Sport','Soccer','Softball','Tennis','Volleyball' ],
        'training-facility.html': [ 'Lane Divider Systems','Impact Panels' ]
      };
      // Provide a broad showcase carousel on overview page if present using a curated subset
      if (base === 'ez-nets.html') {
        DATA[base] = [ 'Baseball','Golf','Lacrosse','Soccer','Softball','Tennis','Volleyball','Warehouse','Safety','Drone','Debris','Multi-Sport' ];
      }
      if (!DATA[base] || DATA[base].length === 0) return;
      // Avoid duplicate build
      if (document.querySelector('.net-gallery')) return;
      // Find hero section to insert after
      const hero = document.querySelector('.net-hero, .netting-hero');
      if (!hero) return;
      const section = document.createElement('section');
      section.className = 'net-gallery-section';
      section.innerHTML = `
        <div class="net-gallery" aria-label="Netting gallery">
          <div class="net-gallery-grid" role="list"></div>
        </div>`;
      hero.insertAdjacentElement('afterend', section);
      const grid = section.querySelector('.net-gallery-grid');
      const slides = DATA[base];
      // Image selection rule: Map normalized slide titles to real filenames in assets/img/eznets.
      // Normalization: lower-case, remove non-alphanumeric. Example: "Foul Ball" -> key "foulball" -> "Foul_Ball.png"
  const IMG_BASE = 'assets/img/eznets/';
      const normalize = (str) => (str||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
      const FILES = {
        // Sports (generic)
        baseball: 'baseball.png', basketball: 'basketball.png', cricket: 'cricket.png', football: 'football.png',
        golf: 'golf.png', hockey: 'hockey.png', lacrosse: 'lacrosse.png', multisport: 'multisport.png', soccer: 'soccer.png',
        softball: 'softball.png', tennis: 'tennis.png', volleyball: 'volleyball.png',
        // Commercial
        autodrone: 'Auto_Drone.png', drone: 'drone.png', droneenclosure: 'Drone_Enclosure.png', warehouse: 'warehouse.png',
        safety: 'safety.png', debris: 'debris.png', landfill: 'Ladndfill.png',
        // Training facility
        lanedividersystems: '../ezproj/facility3.jpg',
        // Baseball subtypes
        foulball: 'Foul_Ball.png', backstop: 'Back_Stop.png', overhead: 'Overhead_Netting.png',
        hittingfacility: '../ezproj/facility2.jpg', battingcage: '../ezproj/battcage1.jpg',
        // Golf subtypes
        drivingrange: 'Driving_Range.png', golfcourse: 'Golf_Course.png', golfcube: 'Golf_Cube.png', residential: 'Residential.png'
      };
      const imageFor = (title) => FILES[normalize(title)] || null;
      slides.forEach((title, idx) => {
        const imgFile = imageFor(title);
        const item = document.createElement('div');
        item.className = 'net-gallery-item';
        item.setAttribute('role', 'listitem');
        // First image eager, others lazy
        const loading = idx === 0 ? 'eager' : 'lazy';
        // If no direct image match, leave placeholder styling (no <img>) with overlayed title text.
        if (imgFile) {
          item.innerHTML = `
            <figure class="gallery-media">
              <img src="${IMG_BASE + imgFile}" alt="${title} netting" loading="${loading}" width="480" height="320" />
              <figcaption class="visually-hidden">${title}</figcaption>
            </figure>
            <h3 class="gallery-title">${title}</h3>`;
          // Graceful fallback if image fails to load
          const imgEl = item.querySelector('img');
          if (imgEl) {
            imgEl.addEventListener('error', () => {
              const fig = item.querySelector('.gallery-media');
              if (fig) fig.innerHTML = `<span>${title}</span><figcaption class="visually-hidden">${title}</figcaption>`;
            }, { once: true });
          }
        } else {
          item.innerHTML = `
            <figure class="gallery-media">
              <span>${title}</span>
              <figcaption class="visually-hidden">${title}</figcaption>
            </figure>
            <h3 class="gallery-title">${title}</h3>`;
        }
        grid?.appendChild(item);
      });
    } catch(e) { /* silent */ }
  },

  // Training Facility Design page: insert an auto-scrolling image carousel below the hero
  // Uses assets/content/ezsports-content-optimized/manifest.json generated by scripts/optimize-ezsports-content.js
  async ensureFacilityDesignCarousel() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      if (base !== 'training-facility-design.html') return;
      if (document.querySelector('.facility-media-carousel')) return;

      const hero = document.querySelector('.facility-hero');
      const anchor = document.getElementById('facility-configurator');
      if (!hero || !anchor || !anchor.parentNode) return;

      const section = document.createElement('section');
      section.className = 'facility-media-carousel wrap';
      section.innerHTML = `
        <div class="auto-carousel" aria-label="Facility photos">
          <div class="auto-carousel__viewport">
            <div class="auto-carousel__track" role="list"></div>
          </div>
        </div>`;

      anchor.parentNode.insertBefore(section, anchor);

      const track = section.querySelector('.auto-carousel__track');
      if (!track) return;

      const manifestUrl = 'assets/content/ezsports-content-optimized/manifest.json';
      const res = await fetch(manifestUrl, { cache: 'force-cache' });
      if (!res.ok) { section.remove(); return; }
      const manifest = await res.json();
      const images = (manifest?.items || []).filter(i => i?.type === 'image' && Array.isArray(i.sources) && i.sources.length);
      if (!images.length) { section.remove(); return; }

      const byWidthAsc = (a, b) => (Number(a?.width) || 0) - (Number(b?.width) || 0);
      const buildItem = (img, idx) => {
        const item = document.createElement('div');
        item.className = 'auto-carousel__item';
        item.setAttribute('role', 'listitem');

        const sources = [...img.sources].sort(byWidthAsc).filter(s => s?.src);
        const src = (sources[sources.length - 1] || sources[0]).src;
        const srcset = sources.map(s => `${s.src} ${s.width}w`).join(', ');

        const picture = document.createElement('picture');
        const source = document.createElement('source');
        source.type = 'image/webp';
        if (srcset) source.setAttribute('srcset', srcset);
        source.setAttribute('sizes', '(max-width: 640px) 80vw, (max-width: 1100px) 45vw, 360px');
        picture.appendChild(source);

        const imageEl = document.createElement('img');
        imageEl.src = src;
        imageEl.alt = img.alt || 'Facility photo';
        imageEl.loading = idx < 2 ? 'eager' : 'lazy';
        imageEl.decoding = 'async';
        if (img.width) imageEl.width = img.width;
        if (img.height) imageEl.height = img.height;
        picture.appendChild(imageEl);

        item.appendChild(picture);
        return item;
      };

      images.forEach((img, idx) => track.appendChild(buildItem(img, idx)));
      // Duplicate the set once for seamless loop
      const originals = Array.from(track.children);
      originals.forEach(node => track.appendChild(node.cloneNode(true)));

      // Tune speed based on item count
      const baseSeconds = images.length * 3;
      const clampedSeconds = Math.max(28, Math.min(90, baseSeconds));
      const seconds = Math.max(10, clampedSeconds - 0.5);
      section.style.setProperty('--carousel-duration', `${seconds}s`);
    } catch {
      // silent
    }
  },

  // On the EZ Custom Nets overview page, inject images into the spec cards based on their titles
  ensureEZNetsSpecImages() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      if (base !== 'ez-nets.html') return;
      const wrap = document.querySelector('.spec-grid');
      if (!wrap) return;
      const FILES = {
        'premium materials': 'premium_materials.png',
        'custom sizing': 'custom_sizing.png',
        'safety first': 'safety_first.png',
        'fast turnaround': 'fast_turnaround.png'
      };
      const IMG_BASE = 'assets/img/eznets/';
      wrap.querySelectorAll('.spec-card').forEach(card => {
        const h = card.querySelector('h3');
        if (!h) return;
        const key = (h.textContent || '').trim().toLowerCase();
        const file = FILES[key];
        if (!file) return;
        // Prevent duplicates
        if (card.querySelector('img.spec-image')) return;
        const img = document.createElement('img');
  img.src = IMG_BASE + file;
  img.alt = h.textContent || 'Illustration';
  img.loading = 'lazy';
        img.className = 'spec-image rounded-sm';
        // Insert image at the top of the card
        card.insertBefore(img, card.firstChild);
      });
    } catch {}
  },

  // Insert a brief category intro + product range chips on L-Screens subcategory pages.
  ensureSubcategoryIntro() {
    // Feature disabled: ensure any existing intro is removed and do not insert a new one
    try {
      const existing = document.getElementById('subcategory-intro') || document.querySelector('.subcategory-intro');
      if (existing) existing.remove();
    } catch {}
  },

  // Soft cross-fade hero rotator on L-Screens hub (screen2 -> screen6, 1s interval)
  ensureHeroRotator() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      if (base !== 'l-screens.html' && base !== 'l-screens') return;
      const rotator = document.querySelector('.hero-rotator');
      if (!rotator) return;
      // Avoid stacking intervals on BFCache restores / repeated init
      if (rotator.__rotating) return;
      rotator.__rotating = true;
      const slides = [...rotator.querySelectorAll('.hr-slide')];
      if (slides.length < 2) return;
      let idx = 0;
      const next = () => {
        slides[idx].classList.remove('is-active');
        idx = (idx + 1) % slides.length;
        slides[idx].classList.add('is-active');
      };
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setInterval(next, 1000); // 1 second fade cadence
      }
    } catch(err) { console.warn('hero rotator failed', err); }
  },

  // On the L-Screens hub, ensure each “Shop by Type” tile image matches its representative SKU.
  // Tiles can declare `data-sku="SKU"` (or a comma-separated list) and we will pull the matching
  // product image from the loaded catalog (preferred) or prodList.json (fallback).
  async ensureTypeTileImagesMatchSku() {
    try {
      const page = (location.pathname.split('/').pop() || '').toLowerCase();
      if (page !== 'l-screens.html' && page !== 'l-screens') return;

      const tilesWrap = document.querySelector('.category-tiles .tiles');
      if (!tilesWrap) return;

      const tiles = Array.from(tilesWrap.querySelectorAll('.tile[data-sku]'));
      if (!tiles.length) return;

      const normalizeSku = (s) => String(s || '').trim().toUpperCase();
      const splitSkus = (s) => String(s || '').split(',').map(v => normalizeSku(v)).filter(Boolean);

      // Prefer unified catalog if present
      const catalogRaw = Array.isArray(window.CATALOG_PRODUCTS)
        ? window.CATALOG_PRODUCTS.map(r => r.raw || r)
        : [];

      let prodListData = null;
      const findInProdList = (sku) => {
        if (!prodListData || !prodListData.categories || typeof prodListData.categories !== 'object') return null;
        for (const arr of Object.values(prodListData.categories)) {
          if (!Array.isArray(arr)) continue;
          const hit = arr.find(p => normalizeSku(p?.sku || p?.id) === sku);
          if (hit) return hit;
        }
        return null;
      };

      for (const tile of tiles) {
        const img = tile.querySelector('.media img');
        if (!img) continue;
        const skus = splitSkus(tile.getAttribute('data-sku'));
        if (!skus.length) continue;

        let matched = null;
        for (const sku of skus) {
          matched = catalogRaw.find(p => normalizeSku(p?.sku || p?.id) === sku) || null;
          if (matched) break;
          if (!prodListData) {
            try { prodListData = await this.fetchProdList(); } catch { prodListData = null; }
          }
          matched = findInProdList(sku);
          if (matched) break;
        }

        if (!matched) continue;
        let resolvedImg = '';
        try {
          resolvedImg = this.normalizeProdListItem(matched)?.img || '';
        } catch {}
        if (!resolvedImg) resolvedImg = matched.img || (Array.isArray(matched.images) ? matched.images[0] : '') || '';
        if (resolvedImg) img.src = resolvedImg;
      }
    } catch (e) {
      console.warn('ensureTypeTileImagesMatchSku failed:', e);
    }
  },

  // Legacy: kept for backward-compatibility; SKU-driven mapping is preferred.
  ensureRandomTypeTileImages() {
    try {
      const page = (location.pathname.split('/').pop() || '').toLowerCase();
      if (page !== 'l-screens.html' && page !== 'l-screens') return;
      const tilesWrap = document.querySelector('.category-tiles .tiles');
      if (!tilesWrap) return;

      // Static manifest of available product images per type (relative URLs)
      // Only minimal, representative sets are needed; add more as assets grow.
      const BASE = 'assets/prodImgs';
      const join = (...parts) => parts.join('/');

      const MANIFEST = {
        baseball: [
          // BULLETCOMBO
          ...[
            'bulletcombo_blacklscreen_a.avif','bulletcombo_columbiabluelscreen_a.avif','bulletcombo_darkgreenlscreen_a.avif','bulletcombo_maroonlscreen_a.avif','bulletcombo_navylscreen_a.avif','bulletcombo_orangelscreen_a.avif','bulletcombo_purplelscreen_a.avif','bulletcombo_redlscreen_a.avif','bulletcombo_royallscreen_a.avif','bulletcombo_yellowlscreen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETCOMBO', n)),
          // BULLETCOP
          ...[
            'bulletcop_black_screen_alt1 (1).avif','bulletcop_columbiablue_screen_alt1 (1).avif','bulletcop_darkgreen_screen_alt1 (1).avif','bulletcop_green_screen_alt1 (1).avif','bulletcop_maroon_screen_alt1 (1).avif','bulletcop_navy_screen_alt1 (1).avif','bulletcop_orange_screen_alt1 (1).avif','bulletcop_purplescreen_alt1 (1).avif','bulletcop_redscreen_alt1 (1).avif','bulletcop_royalscreen_alt1 (1).avif','bulletcop_yellowscreen (1).avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETCOP', n)),
          // BULLETFP
          ...[
            'bulletfp_blackscreen_a.avif','bulletfp_columbiabluescreen_a.avif','bulletfp_darkgreenscreen_a.avif','bulletfp_greenscreen_a.avif','bulletfp_navyscreen_a.avif','bulletfp_orangescreen_a.avif','bulletfp_purplescreen_a.avif','bulletfp_redscreen_a.avif','bulletfp_royalscreen_a.avif','bulletfp_yellowscreen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETFP', n)),
          // BULLETFPOH
          ...[
            'bulletfpoh_blacklscreen_a.avif','bulletfpoh_columbiabluelscreen_a.avif','bulletfpoh_darkgreenlscreen_a.avif','bulletfpoh_greenlscreen_a.avif','bulletfpoh_maroonlscreen_a.avif','bulletfpoh_navylscreen_a.avif','bulletfpoh_orangelscreen_a.avif','bulletfpoh_purplelscreen_a.avif','bulletfpoh_redlscreen_a.avif','bulletfpoh_royallscreen_a.avif','bulletfpoh_yellowlscreen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETFPOH', n)),
          // BULLETFT
          ...[
            'bulletft_blacklscreen_a.avif','bulletft_columbiabluelscreen_a.avif','bulletft_darkgreenlscreen_a.avif','bulletft_greenlscreen_a.avif','bulletft_maroonlscreen_a.avif','bulletft_navylscreen_a.avif','bulletft_orangelscreen_a.avif','bulletft_purplelscreen_a.avif','bulletft_redlscreen_alt.avif','bulletft_royallscreen_a.avif','bulletft_yellowlscreen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETFT', n)),
          // BULLETJRBB (renamed to color-based filenames)
          ...[
            'bulletjrbb_black_a.avif','bulletjrbb_columbia_a.avif','bulletjrbb_darkgreen_a.avif','bulletjrbb_green_a.avif','bulletjrbb_maroon_a.avif','bulletjrbb_navy_a.avif','bulletjrbb_orange_a.avif','bulletjrbb_purple_a.avif','bulletjrbb_red_a.avif','bulletjrbb_royal_.avif','bulletjrbb_yellow_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETJRBB', n)),
          // BULLETL
          ...[
            'bulletl_blacklscreen_a.avif','bulletl_columbiabluelscreen_a.avif','bulletl_darkgreenlscreen_a.avif','bulletl_greenlscreen_a.avif','bulletl_maroonlscreen_a.avif','bulletl_navylscreen_a.avif','bulletl_orangelscreen_a.avif','bulletl_purplelscreen_a.avif','bulletl_redlscreen_a.avif','bulletl_royallscreen_a.avif','bulletl_yellowlscreen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETL', n)),
          // BULLETLOP
          ...[
            'bulletlop_black_screen_a.avif','bulletlop_columbiablue_screen_a.avif','bulletlop_darkgreen_screen_a.avif','bulletlop_green_screen_a.avif','bulletlop_maroon_screen_a.avif','bulletlop_navy_screen_a.avif','bulletlop_orange_screen_a.avif','bulletlop_purple_screen_a.avif','bulletlop_red_screen_a.avif','bulletlop_royal_screen_a.avif','bulletlop_yellow_screen_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'BULLETLOP', n)),
          // SOCKNET7X7
          ...[
            'socknet7x7-black_a.avif','socknet7x7-columbiablue_a.avif','socknet7x7-darkgreen_a.avif','socknet7x7-green_a.avif','socknet7x7-maroon_a.avif','socknet7x7-navy_a.avif','socknet7x7-orange_a.avif','socknet7x7-purple_a.avif','socknet7x7-red_a.avif','socknet7x7-royal_a.avif','socknet7x7-yellow_a.avif'
          ].map(n => join(BASE, 'Baseball_L_Screens', 'SOCKNET7X7', n))
        ],
        protective: [
          // 10x10
          ...[
            'protective10x10_blackscreen (1).avif','protective10x10_columbiabluescreen (1).avif','protective10x10_darkgreenscreen (1).avif','protective10x10_greenscreen (1).avif','protective10x10_maroonscreen (1).avif','protective10x10_navyscreen (1).avif','protective10x10_orangescreen (1).avif','protective10x10_purplescreen (1).avif','protective10x10_redscreen (1).avif','protective10x10_royalscreen (1).avif','protective10x10_yellowscreen (1).avif'
          ].map(n => join(BASE, 'Protective_Screens', 'PROTECTIVE10X10', n)),
          // 7x7
          ...[
            'protective7x7_blackscreen (1).avif','protective7x7_columbiabluescreen (1).avif','protective7x7_darkgreenscreen (1).avif','protective7x7_greenscreen (1).avif','protective7x7_maroonscreen (1).avif','protective7x7_navyscreen (1).avif','protective7x7_orangescreen (1).avif','protective7x7_purplescreen (1).avif','protective7x7_redscreen (1).avif','protective7x7_royalscreen (1).avif','protective7x7_yellowscreen (1).avif'
          ].map(n => join(BASE, 'Protective_Screens', 'PROTECTIVE7X7', n)),
          // 8x8
          ...[
            'protective8x8_blackscreen (1).avif','protective8x8_columbiabluescreen (1).avif','protective8x8_darkgreenscreen (1).avif','protective8x8_greenscreen (1).avif','protective8x8_maroonscreen (1).avif','protective8x8_navyscreen (1).avif','protective8x8_orangescreen (1).avif','protective8x8_purplescreen (1).avif','protective8x8_redscreen (1).avif','protective8x8_royalscreen (1).avif','protective8x8_yellowscreen (1).avif'
          ].map(n => join(BASE, 'Protective_Screens', 'PROTECTIVE8X8', n))
        ],
        pocket: [
          // Pro (renamed to color-based filenames)
          ...[
            'pppro_black_a.avif','pppro__columbia_a.avif','pppro_darkgreen_a.avif','pppro_green_a.avif','pppro_maroon_a.avif','pppro_navy_a.avif','pppro1_orange_a.avif','pppro_purple_a.avif','pppro_red_a.avif','pppro_royal_a.avif','pppro_yellow_a.avif'
          ].map(n => join(BASE, "Pitcher's_Pockets", 'BBPP-PRO', n)),
          // 9-hole
          ...[
            'pitcher_spocket9hole_black_a.avif','pitcher_spocket9hole_columbiablue_a.avif','pitcher_spocket9hole_darkgreen_a.avif','pitcher_spocket9hole_green_a.avif','pitcher_spocket9hole_maroon_a.avif','pitcher_spocket9hole_navy_a.avif','pitcher_spocket9hole_orange_a.avif','pitcher_spocket9hole_purple_a.avif','pitcher_spocket9hole_red_a.avif','pitcher_spocket9hole_royal_a.avif','pitcher_spocket9hole_yellow_a.avif'
          ].map(n => join(BASE, "Pitcher's_Pockets", 'PITCHERSPOCKET9', n))
        ],
        replacement: [
          join(BASE, 'Replacement_Nets', 'RN-10X10 PROTECTIVE', 'replacement_net_10x10_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-7X7 PROTECTIVE', 'replacement_net_7x7_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-8X8 PROTECTIVE', 'replacement_net_8x8_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETCOMBO', 'replacement_net_combo_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETCOP', 'replacement_net_bulletcop_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETFPOH', 'replacement_net_fpoh_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETFT', 'replacement_net_fronttoss_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETJR', 'replacement_net_bulletjr_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETL', 'replacement_net_bulletl_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-BULLETLOP', 'replacement_net_bulletlop_a.avif'),
          join(BASE, 'Replacement_Nets', 'RN-7X7 SOCKNET', 'replacement_net_socknet_a.avif')
        ]
      };

      const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const mapHrefToKey = (href) => {
        const h = (href || '').toLowerCase();
        if (h.endsWith('baseball-l-screens.html')) return 'baseball';
        if (h.endsWith('protective-screens.html')) return 'protective';
        if (h.endsWith('pitchers-pocket.html')) return 'pocket';
        if (h.endsWith('replacement-screens.html')) return 'replacement';
        return null;
      };

      tilesWrap.querySelectorAll('.tile').forEach(tile => {
        const a = tile; // tiles are anchors in current markup
        const key = mapHrefToKey(a.getAttribute('href'));
        if (!key || !Array.isArray(MANIFEST[key]) || MANIFEST[key].length === 0) return;
        const img = tile.querySelector('.media img');
        if (!img) return;
        // If a tile declares a representative SKU, do not override it randomly.
        if (tile.hasAttribute('data-sku')) return;
        const src = pickRandom(MANIFEST[key]);
        if (src) img.src = src;
      });
    } catch (e) {
      console.warn('ensureRandomTypeTileImages failed:', e);
    }
  },

  // Dynamically render products for the current page from unified catalog (product-loader -> prodList.json)
  async ensurePageProductGrid() {
    try {
      const grid = document.getElementById('page-product-grid');
      if (!grid) return; // Only run on pages that declare a page-level grid
      const pageKey = this.getPageKey();

      // Tag body for L-Screens sub nav pages to allow page-specific styling
      try {
        const LS_PAGES = new Set(['baseball-l-screens','baseball-l-screen','protective-screens','pitchers-pocket','replacement-screens']);
        if (LS_PAGES.has(pageKey)) document.body.classList.add('lscreens-subnav');
      } catch {}

      // Prefer unified catalog loaded by product-loader; if not ready yet, wait briefly then fallback to prodList.json
      let catalog = Array.isArray(window.CATALOG_PRODUCTS) ? window.CATALOG_PRODUCTS : [];
      if (!catalog.length) {
        // Wait for catalog:ready up to ~1s
        const awaited = await new Promise(resolve => {
          let done = false;
          const timer = setTimeout(()=>{ if (!done) { done = true; resolve(false); } }, 1000);
          window.addEventListener('catalog:ready', ()=>{ if (!done) { clearTimeout(timer); done = true; resolve(true); } }, { once:true });
          window.addEventListener('catalog:error', ()=>{ if (!done) { clearTimeout(timer); done = true; resolve(false); } }, { once:true });
        });
        if (awaited) catalog = Array.isArray(window.CATALOG_PRODUCTS) ? window.CATALOG_PRODUCTS : [];
      }
      // Fallback to prodList.json legacy shape if catalog still empty
      let prodListData = null;
      if (!catalog.length) {
        prodListData = await this.fetchProdList();
        if (!prodListData || typeof prodListData !== 'object') {
          this.renderEmptyState(grid);
          return;
        }
      }

  // Special collective page: replacement-screens
      if (pageKey === 'replacement-screens') {
        // Gather all replacement nets from unified catalog when available; else scan prodList
        let all = [];
        if (Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length) {
          const raws = window.CATALOG_PRODUCTS.map(r => r.raw || r);
          all = raws.filter(p => {
            const name = (p.name || p.title || '').toLowerCase();
            const sku = String(p.sku || '').toLowerCase();
            if (!(/replacement/.test(name) || /replacement/.test(sku))) return false;
            // Exclude wheels/wheel kits from replacement nets page
            if (/wheel/.test(name) || /wheel/.test(sku)) return false;
            return true;
          });
        } else if (prodListData && prodListData.categories && typeof prodListData.categories === 'object') {
          for (const arr of Object.values(prodListData.categories)) {
            if (!Array.isArray(arr)) continue;
            arr.forEach(p => {
              const name = (p.name || p.title || '').toLowerCase();
              const sku = String(p.sku || '').toLowerCase();
              if ((/replacement/.test(name) || /replacement/.test(sku)) && !(/wheel/.test(name) || /wheel/.test(sku))) all.push(p);
            });
          }
        }
        if (!all.length) { this.renderEmptyState(grid); return; }
        // De-dupe by sku
        const seen = new Set();
        const unique = all.filter(p => { const k = (p.sku||p.id||p.name); if (seen.has(k)) return false; seen.add(k); return true; });
        // Sort predictable order (group by size then name)
        const sizeRank = (p) => {
          const t = (p.name||p.title||'').toLowerCase();
          const m = t.match(/(7x7|8x8|10x10|jr|front toss|combo|overhead|fast pitch|socknet|l\s*w\/\s*overhead)/);
          if (!m) return 999;
          const key = m[1];
          return ({ 'jr':1, '7x7':2, 'socknet':3, '8x8':4, '10x10':5, 'front toss':6, 'combo':7, 'l w/ overhead':8, 'overhead':9, 'fast pitch':10 }[key] || 500);
        };
        unique.sort((a,b)=> sizeRank(a) - sizeRank(b) || (a.name||'').localeCompare(b.name||''));
        // Build single collective card with gallery + model dropdown
        grid.classList.remove('grid','grid-3','product-grid');
        grid.classList.add('collective-list');
        const modelData = unique.map(p => {
          const id = String(p.sku || p.id || p.name || p.title);
          const title = String(p.name || p.title || id);
          const price = Number(p.price ?? p.map ?? p.wholesale ?? 0) || 0;
          const img = this.normalizeProdListItem(p).img;
          const features = Array.isArray(p?.details?.features) ? p.details.features : (Array.isArray(p?.features) ? p.features : []);
          return { id, title, price, img, features };
        });
        const prices = modelData.map(m=>m.price).filter(v=>isFinite(v) && v>0);
        const minP = prices.length? Math.min(...prices):0;
        const maxP = prices.length? Math.max(...prices):0;
        const rangeHtml = prices.length ? (minP===maxP? `${currency.format(minP)}` : `${currency.format(minP)} - ${currency.format(maxP)}`) : '';
        const thumbs = modelData.map((m,i)=>`<button class="thumb" data-index="${i}" data-sku="${m.id}" aria-label="View ${m.title}"><img src="${m.img}" alt="${m.title}" loading="lazy"/></button>`).join('');
        const options = [`<option value="">Choose a Model…</option>`].concat(modelData.map(m=>`<option value="${m.id}" data-price="${m.price}">${m.title} — ${currency.format(m.price)}</option>`)).join('');
        const firstImg = modelData[0]?.img || 'assets/img/EZSportslogo.png';
        grid.innerHTML = `
          <article class="collective-card replacement-aggregator">
            <div class="pd-grid">
              <div class="pd-media">
                <div class="pd-main"><img id="agg-main-img" src="${firstImg}" alt="Replacement screen" loading="eager" decoding="async"/></div>
                <div class="pd-thumbs" role="tablist">${thumbs}</div>
              </div>
              <div class="pd-info">
                <h1 class="pd-title">Replacement Nets</h1>
                <div class="price h3" id="agg-price">${rangeHtml}</div>
                <div class="text-sm text-muted" id="agg-ship"></div>
                <div class="stack-05" style="margin-top:.5rem;">
                  <label class="text-xs" for="agg-model-select" style="font-weight:700;letter-spacing:.4px;">Model</label>
                  <select id="agg-model-select" class="pd-option-select" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">${options}</select>
                  <div id="agg-selected" class="text-sm text-muted"></div>
                  <ul id="agg-features" class="feature-list" style="margin:.5rem 0 0 1rem; padding-left:1rem; list-style:disc;"></ul>
                  <button class="btn btn-primary" id="agg-add">Add to Cart</button>
                </div>
              </div>
            </div>
          </article>`;
        // Wire interactions
        const main = document.getElementById('agg-main-img');
        const priceEl = document.getElementById('agg-price');
        const selectEl = document.getElementById('agg-model-select');
        const selectedEl = document.getElementById('agg-selected');
        const bySku = Object.fromEntries(modelData.map(m=>[m.id,m]));
        const shipEl = document.getElementById('agg-ship');
        const shipFor = (m) => {
          const raw = (typeof m?.dsr !== 'undefined') ? m.dsr : (typeof m?.raw?.dsr !== 'undefined' ? m.raw.dsr : undefined);
          const num = Number(raw);
          if (Number.isFinite(num) && num > 0) return num;
          // Heuristic similar to product page
          const t = String(m?.title||'').toLowerCase();
          if (/replacement/.test(t)) return 75;
          return 100;
        };
        const featuresEl = document.getElementById('agg-features');
        const renderFeatures = (arr) => {
          if (!featuresEl) return;
          const list = Array.isArray(arr) ? arr.filter(x=>typeof x === 'string' && x.trim()) : [];
          if (!list.length) { featuresEl.innerHTML = ''; return; }
          const max = 10; // cap to avoid overly long lists
          featuresEl.innerHTML = list.slice(0, max).map(f=>`<li>${f}</li>`).join('');
        };
        // Initialize shipping text as range across models
        try {
          if (shipEl) {
            const ships = modelData.map(m=>shipFor(m)).filter(n=>Number.isFinite(n) && n>0);
            if (ships.length) {
              const min = Math.min(...ships), max = Math.max(...ships);
              shipEl.textContent = (min===max) ? `Shipping: $${min.toFixed(2)}` : `Shipping: $${min.toFixed(2)} - $${max.toFixed(2)}`;
            }
          }
        } catch {}
        // Thumb click selects corresponding model
        grid.querySelectorAll('.pd-thumbs .thumb').forEach(btn=>{
          btn.addEventListener('click',()=>{
            const i = Number(btn.dataset.index)||0;
            const sku = btn.dataset.sku;
            const m = modelData[i];
            if (m?.img) main.src = m.img;
            if (sku && selectEl) {
              selectEl.value = sku;
              const price = Number(bySku[sku]?.price||0) || 0;
              priceEl.textContent = price>0 ? currency.format(price) : rangeHtml;
              selectedEl.textContent = `${bySku[sku]?.title || ''}`;
              renderFeatures(bySku[sku]?.features);
              if (shipEl) { const ship = shipFor(bySku[sku]); shipEl.textContent = ship ? `Shipping: $${ship.toFixed(2)}` : ''; }
            }
            grid.querySelectorAll('.pd-thumbs .thumb').forEach(b=>b.classList.toggle('is-active', b===btn));
          });
        });
        // Dropdown change updates main image + price + label
        selectEl?.addEventListener('change', ()=>{
          const sku = selectEl.value;
          const m = bySku[sku];
          if (m) {
            if (m.img) main.src = m.img;
            priceEl.textContent = m.price>0 ? currency.format(m.price) : rangeHtml;
            selectedEl.textContent = m.title;
            renderFeatures(m.features);
            if (shipEl) { const ship = shipFor(m); shipEl.textContent = ship ? `Shipping: $${ship.toFixed(2)}` : ''; }
          } else {
            priceEl.textContent = rangeHtml;
            selectedEl.textContent = '';
            renderFeatures([]);
            if (shipEl) shipEl.textContent = '';
          }
        });
        // Add to cart requires a selection
        document.getElementById('agg-add')?.addEventListener('click', ()=>{
          const sku = selectEl?.value;
          const m = sku ? bySku[sku] : null;
          if (!m) { alert('Please choose a model.'); return; }
          const product = { id: sku, title: m.title, price: m.price || 0, img: m.img, category: 'replacement' };
          // Shipping from dsr if present on model or raw, else fallback
          let ship = (typeof m.dsr !== 'undefined') ? m.dsr : (typeof m.raw?.dsr !== 'undefined' ? m.raw.dsr : undefined);
          if (!(Number(ship)>0)) ship = shipFor(m);
          try { window.Store && window.Store.add(product, { ship }); } catch {}
        });
        return; // Skip normal grid rendering
      }

      // Special collective page: bullet-pad-kits (single aggregator card with model + color)
      if (pageKey === 'bullet-pad-kits') {
        // Collect source items from unified catalog when available; else fallback to prodList.json category
        let all = [];
        if (Array.isArray(window.CATALOG_BY_CATEGORY?.['bullet-pad-kits']) && window.CATALOG_BY_CATEGORY['bullet-pad-kits'].length) {
          all = window.CATALOG_BY_CATEGORY['bullet-pad-kits'].map(r => r.raw || r);
        }
        if (!all.length && prodListData && prodListData.categories && Array.isArray(prodListData.categories['Bullet Pad Kits'])) {
          all = prodListData.categories['Bullet Pad Kits'];
        }
        // As a resilient fallback, scan all categories for obvious pad kits (sku starts with PK- or name includes Pad Kit)
        if (!all.length && prodListData && prodListData.categories && typeof prodListData.categories === 'object') {
          for (const arr of Object.values(prodListData.categories)) {
            if (!Array.isArray(arr)) continue;
            arr.forEach(p => {
              const sku = String(p?.sku || '').toUpperCase();
              const name = String(p?.name || p?.title || '').toLowerCase();
              if (sku.startsWith('PK-') || /\bpad\s*kit\b/.test(name)) all.push(p);
            });
          }
        }
        if (!all.length) { this.renderEmptyState(grid); return; }
        // Show all PK* pad kit SKUs (remove previous temporary allow-list)
        // If needed in the future, business rules can refine this list.
        // De-dupe by sku/id
        const seen = new Set();
        all = all.filter(p => { const key = String(p?.sku || p?.id || p?.name || ''); if (!key) return false; if (seen.has(key)) return false; seen.add(key); return true; });
        // Sort predictable order: JR, L, Front Toss, Combo (w/ Overhead first), Fast Pitch, Overhead, then sized Protectives
        const rank = (p) => {
          const t = String(p?.name || p?.title || '').toLowerCase();
          if (/\bjr\b/.test(t)) return 10;
          if (/\bl\b/.test(t) && !/jr/.test(t)) return 20;
          if (/front\s*toss/.test(t)) return 30;
          if (/combo/.test(t) && /overhead/.test(t)) return 40;
          if (/fast\s*pitch|\bfp\b/.test(t)) return 45;
          if (/combo/.test(t)) return 50;
          if (/overhead/.test(t)) return 60;
          if (/7x7/.test(t)) return 70;
          if (/8x8/.test(t)) return 80;
          if (/10x10/.test(t)) return 90;
          return 200;
        };
        all.sort((a,b)=> rank(a) - rank(b) || String(a?.name||'').localeCompare(String(b?.name||'')));

        // Build model dataset
        const modelData = all.map(p => {
          const id = String(p?.sku || p?.id || p?.name || p?.title);
          const title = String(p?.name || p?.title || id);
          const price = Number(p?.map ?? p?.price ?? p?.wholesale ?? 0) || 0;
          const norm = this.normalizeProdListItem(p);
          const img = norm?.img || 'assets/prodImgs/Screens/L-Screen_Padding_Kit/images/l-screen-padding-kit-bulletpadkit_1.jpg';
          const features = Array.isArray(p?.details?.features) ? p.details.features : (Array.isArray(p?.features) ? p.features : []);
          return { id, title, price, img, features };
        });
        const prices = modelData.map(m=>m.price).filter(v=>isFinite(v) && v>0);
        const minP = prices.length? Math.min(...prices):0;
        const maxP = prices.length? Math.max(...prices):0;
        const rangeHtml = prices.length ? (minP===maxP? `${currency.format(minP)}` : `${currency.format(minP)} - ${currency.format(maxP)}`) : '';
  const options = [`<option value="">Choose a Model…</option>`].concat(modelData.map(m=>`<option value="${m.id}" data-price="${m.price}">${m.title} — ${currency.format(m.price)}</option>`)).join('');
  const firstImg = 'assets/prodImgs/Bullet_Pad_Kit/bulletpadkit.avif';
        // Standard 10 color palette used across team products
        const COLORS = [
          { value:'black', label:'Black' },
          { value:'columbiablue', label:'Columbia Blue' },
          { value:'darkgreen', label:'Dark Green' },
          { value:'maroon', label:'Maroon' },
          { value:'navy', label:'Navy' },
          { value:'orange', label:'Orange' },
          { value:'purple', label:'Purple' },
          { value:'red', label:'Red' },
          { value:'royal', label:'Royal' },
          { value:'yellow', label:'Yellow' }
        ];
        const colorOptions = [`<option value="">Choose a Color…</option>`].concat(COLORS.map(c=>`<option value="${c.value}">${c.label}</option>`)).join('');

        grid.classList.remove('grid','grid-3','product-grid');
        grid.classList.add('collective-list');
        grid.innerHTML = `
          <article class="collective-card padkits-aggregator">
            <div class="pd-grid">
              <div class="pd-media">
                <div class="pd-main"><img id="agg-main-img" src="${firstImg}" alt="Bullet Pad Kits" loading="eager" decoding="async"/></div>
              </div>
              <div class="pd-info">
                <h1 class="pd-title">Bullet Pad Kits</h1>
                <div class="price h3" id="agg-price">${rangeHtml}</div>
                <div class="text-sm text-muted" id="agg-expert-contact" style="display:none; margin:.15rem 0 .35rem;">
                  <div><strong>Call:</strong> <a href="tel:+13868373131" aria-label="Call EZ Sports Netting at 386-837-3131">(386) 837-3131</a></div>
                  <div><strong>Email:</strong> <a href="mailto:info@ezsportsnetting.com">info@ezsportsnetting.com</a></div>
                </div>
                <div class="text-sm text-muted" id="agg-ship" style="display:none;"></div>
                <div class="stack-05" style="margin-top:.5rem;">
                  <label class="text-xs" for="agg-model-select" style="font-weight:700;letter-spacing:.4px;">Model</label>
                  <select id="agg-model-select" class="pd-option-select" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;font-weight:600;">${options}</select>
                  <label class="text-xs" for="agg-color-select" style="font-weight:700;letter-spacing:.4px;">Color</label>
                  <select id="agg-color-select" class="pd-option-select" style="padding:.7rem .8rem;border:1px solid var(--border);border-radius:.6rem;">${colorOptions}</select>
                  <div id="agg-selected" class="text-sm text-muted"></div>
                  <ul id="agg-features" class="feature-list" style="margin:.5rem 0 0 1rem; padding-left:1rem; list-style:disc;"></ul>
                  <div class="stack-03">
                    <div class="stack-02">
                      <div class="row gap-06" style="flex-wrap:wrap;">
                        <a class="btn btn-primary" href="tel:+13868373131" aria-label="Call to order at 386-837-3131">Call To Order</a>
                        <a class="btn btn-ghost" href="mailto:info@ezsportsnetting.com" aria-label="Email EZ Sports Netting">Email</a>
                      </div>
                    </div>
                    <button class="btn btn-ghost" id="agg-back">Back</button>
                  </div>
                </div>
              </div>
            </div>
          </article>`;
        // Wire interactions
        const main = document.getElementById('agg-main-img');
        const priceEl = document.getElementById('agg-price');
        const selectEl = document.getElementById('agg-model-select');
        const colorEl = document.getElementById('agg-color-select');
        const selectedEl = document.getElementById('agg-selected');
        const bySku = Object.fromEntries(modelData.map(m=>[m.id,m]));
        const shipEl = document.getElementById('agg-ship');
        const shipFor = (m) => {
          const raw = (typeof m?.dsr !== 'undefined') ? m.dsr : (typeof m?.raw?.dsr !== 'undefined' ? m.raw.dsr : undefined);
          const num = Number(raw);
          if (Number.isFinite(num) && num > 0) return num;
          // Bullet pad kits roughly in L-Screen class
          return 75;
        };
        const featuresEl = document.getElementById('agg-features');
        const expertEl = document.getElementById('agg-expert-contact');
        const addBtn = document.getElementById('agg-add');
        const renderFeatures = (arr) => {
          if (!featuresEl) return;
          const list = Array.isArray(arr) ? arr.filter(x=>typeof x === 'string' && x.trim()) : [];
          if (!list.length) { featuresEl.innerHTML = ''; return; }
          const max = 10;
          featuresEl.innerHTML = list.slice(0, max).map(f=>`<li>${f}</li>`).join('');
        };
        // Initialize shipping text as range across models
        try {
          if (shipEl) {
            const ships = modelData.map(m=>shipFor(m)).filter(n=>Number.isFinite(n) && n>0);
            if (ships.length) {
              const min = Math.min(...ships), max = Math.max(...ships);
              shipEl.textContent = (min===max) ? `Shipping: $${min.toFixed(2)}` : `Shipping: $${min.toFixed(2)} - $${max.toFixed(2)}`;
            }
          }
        } catch {}
        // Back button behavior
        document.getElementById('agg-back')?.addEventListener('click', ()=>{
          try {
            if (history.length > 1) history.back();
            else window.location.href = 'accessories.html';
          } catch { window.location.href = 'accessories.html'; }
        });
        // Dropdown change updates price + label and applies Talk-to-Expert flow for PK selections
        selectEl?.addEventListener('change', ()=>{
          const sku = selectEl.value;
          const m = bySku[sku];
          if (m) {
            // Keep hero static; only update price, label and features
            // For PK* SKUs: replace price with Talk to an Expert, blank shipping, and disable Add to Cart
            const isPk = /^PK[-\s]?/i.test(String(sku||''));
            if (isPk) {
              priceEl.textContent = 'Talk to an Expert';
              if (shipEl) shipEl.textContent = '';
              if (expertEl) expertEl.style.display = '';
              if (addBtn) { addBtn.disabled = true; addBtn.setAttribute('aria-disabled','true'); }
            } else {
              priceEl.textContent = m.price>0 ? currency.format(m.price) : rangeHtml;
              if (expertEl) expertEl.style.display = 'none';
              // Recompute shipping for selected model
              if (shipEl) { const ship = shipFor(m); shipEl.textContent = ship ? `Shipping: $${ship.toFixed(2)}` : ''; }
              if (addBtn) { addBtn.disabled = false; addBtn.removeAttribute('aria-disabled'); }
            }
            selectedEl.textContent = m.title;
            renderFeatures(m.features);
          } else {
            priceEl.textContent = rangeHtml;
            selectedEl.textContent = '';
            renderFeatures([]);
            if (shipEl) shipEl.textContent = '';
            if (expertEl) expertEl.style.display = 'none';
            if (addBtn) { addBtn.disabled = false; addBtn.removeAttribute('aria-disabled'); }
          }
        });
        // Add to cart requires a model and a color selection
        document.getElementById('agg-add')?.addEventListener('click', ()=>{
          const sku = selectEl?.value;
          const m = sku ? bySku[sku] : null;
          if (!m) { alert('Please choose a model.'); return; }
          const color = (colorEl?.value || '').trim();
          if (!color) { alert('Please choose a color.'); return; }
          const product = { id: sku, title: m.title, price: m.price || 0, img: m.img, category: 'pad-kits' };
          let ship = (typeof m.dsr !== 'undefined') ? m.dsr : (typeof m.raw?.dsr !== 'undefined' ? m.raw.dsr : undefined);
          if (!(Number(ship)>0)) ship = shipFor(m);
          try { window.Store && window.Store.add(product, { color, ship }); } catch {}
        });
        return; // Skip normal grid rendering
      }

      // Special grouped page: pre-made-cages
      if (pageKey === 'pre-made-cages') {
        // Collect source items from unified catalog when available; else fallback to prodList.json category
        let all = [];
        if (Array.isArray(window.CATALOG_BY_CATEGORY?.['pre-made-cages']) && window.CATALOG_BY_CATEGORY['pre-made-cages'].length) {
          all = window.CATALOG_BY_CATEGORY['pre-made-cages'].map(r => r.raw || r);
        }
        if (!all.length && prodListData && prodListData.categories && Array.isArray(prodListData.categories['Pre-Made Cages'])) {
          all = prodListData.categories['Pre-Made Cages'];
        }
        if (!all.length) { this.renderEmptyState(grid); return; }

        // Group into three families
        const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : x);
        const groups = [
          { key: '21nylon', title: '#21 Nylon', match: (p) => String(p.material||'').toLowerCase()==='nylon' && Number(p.gauge||0)===21 },
          { key: '36nylon', title: '#36 Nylon', match: (p) => String(p.material||'').toLowerCase()==='nylon' && Number(p.gauge||0)===36 },
          { key: '36poly',  title: '#36 Poly',  match: (p) => String(p.material||'').toLowerCase()==='poly'  && Number(p.gauge||0)===36 }
        ];

        grid.innerHTML = '';
        // Keep three-across layout
        grid.classList.add('grid','grid-3','product-grid');

        const makeModelData = (arr) => {
          return arr.map(p => {
            const id = String(p.sku || p.id || p.name || p.title);
            const title = String(p.name || p.title || p.size || id);
            const price = Number(p.map ?? p.price ?? p.wholesale ?? 0) || 0;
            const img = this.normalizeProdListItem(p).img || 'assets/img/EZSportslogo.png';
            const size = p.size || (title.match(/\b\d+x\d+x?\d*\b/i)?.[0] || '');
            return { id, title, size, price, img, raw: p };
          });
        };
        const buildRange = (models) => {
          const prices = models.map(m=>m.price).filter(v=>isFinite(v) && v>0);
          if (!prices.length) return '';
          const minP = Math.min(...prices); const maxP = Math.max(...prices);
          return minP===maxP ? currency.format(minP) : `${currency.format(minP)} - ${currency.format(maxP)}`;
        };

        const GROUP_IMGS = {
          '21nylon': [ 'assets/prodImgs/Pre_Made_Cages/21Nylon.avif', 'assets/prodImgs/Pre_Made_Cages/21Nylon2.avif' ],
          '36nylon': [ 'assets/prodImgs/Pre_Made_Cages/36Nylon.avif', 'assets/prodImgs/Pre_Made_Cages/36Nylon2.avif' ],
          '36poly':  [ 'assets/prodImgs/Pre_Made_Cages/36Poly.avif',  'assets/prodImgs/Pre_Made_Cages/36Poly2.avif' ]
        };

        groups.forEach((g, gi) => {
          const items = all.filter(g.match);
          if (!items.length) return; // skip empty groups silently
          const models = makeModelData(items);
          // Build a standard product card layout that links to a group detail page; no inline sizes or add button
          const uid = `cages-${g.key}`;
          const first = models[0];
          const firstImg = (GROUP_IMGS[g.key] && GROUP_IMGS[g.key][0]) || first?.img || 'assets/img/EZSportslogo.png';
          const rangeHtml = buildRange(models);
          const href = `product.html?pid=${encodeURIComponent(`cages-${g.key}`)}`;
          const article = document.createElement('article');
          article.className = 'card';
          article.innerHTML = `
            <a class="media" href="${href}"><img src="${firstImg}" alt="${g.title}" loading="lazy" class="product-main-image"/></a>
            <div class="body">
              <h3 class="h3-tight">Batting Cage Netting <a href="${href}">${g.title}</a></h3>
              <div class="price-row">
                <span class="price">${rangeHtml}</span>
                <a class="btn btn-ghost" href="${href}" aria-label="View ${g.title}">View</a>
              </div>
            </div>`;
          grid.appendChild(article);
        });

        // If none of the groups produced content, show empty
        if (!grid.children.length) { this.renderEmptyState(grid); }
        return; // Skip normal grid rendering
      }
      let items = [];
      // Unified mapping using catalog slugs when available
      const pageToCatSlug = {
        'accessories': 'accessories',
        'baseball-l-screens': 'baseball-l-screens',
        'protective-screens': 'protective-screens',
        'pitchers-pocket': 'pitchers-pocket',
        'replacement-screens': 'replacement-nets',
        'bullet-pad-kits': 'bullet-pad-kits',
        'pre-made-cages': 'pre-made-cages'
      };
      const targetSlug = pageToCatSlug[pageKey];
      if (targetSlug && window.CATALOG_BY_CATEGORY && Array.isArray(window.CATALOG_BY_CATEGORY[targetSlug])) {
        items = window.CATALOG_BY_CATEGORY[targetSlug].map(r => r.raw || r);
      }
      // Fallback: if pageKey directly matches a catalog category slug
      if (!items.length && window.CATALOG_BY_CATEGORY && Array.isArray(window.CATALOG_BY_CATEGORY[pageKey])) {
        items = window.CATALOG_BY_CATEGORY[pageKey].map(r => r.raw || r);
      }
      // If still empty, attempt specialized derivations from unified catalog; else fallback to prodList scanning
      if (!items.length) {
        // Protective Screens page: derive from catalog across categories
        if (pageKey === 'protective-screens' && Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length) {
          const raws = window.CATALOG_PRODUCTS.map(r => r.raw || r);
          const protective = [];
          const seen = new Set();
          raws.forEach(p => {
            const name = String(p.name || p.title || '').toLowerCase();
            if (!/protective\s+screen/.test(name)) return;
            if (/pad kit|replacement|combo|wheel kit/.test(name)) return;
            const key = String(p.sku || p.id || name);
            if (seen.has(key)) return;
            seen.add(key);
            protective.push(p);
          });
          if (protective.length) {
            const sizeRank = (p) => {
              const text = (p.name || p.title || '').toLowerCase();
              const m = text.match(/(\d{1,2})x(\d{1,2})/);
              if (m) return parseInt(m[1],10) * 100 + parseInt(m[2],10);
              return 9999;
            };
            protective.sort((a,b)=> sizeRank(a) - sizeRank(b));
            items = protective;
          }
        }
      }

      if (!items.length && prodListData && prodListData.categories && typeof prodListData.categories === 'object') {
        const fallbackMap = {
          'accessories': ['Accessories'],
          'baseball-l-screens': ['Baseball L-Screens','Better Baseball L-Screens'],
          'protective-screens': ['Baseball L-Screens','Better Baseball L-Screens'],
          "pitchers-pocket": ["Pitcher's Pocket"],
          'replacement-screens': ['Replacement Nets']
        };
        const names = fallbackMap[pageKey] || [];
        for (const n of names) {
          if (Array.isArray(prodListData.categories[n])) items = items.concat(prodListData.categories[n]);
        }
        // Custom refinement for protective-screens page: only show Bullet Protective Screens (7x7, 8x8, 10x10 etc.)
        if (pageKey === 'protective-screens') {
          const protective = [];
          const seen = new Set();
          const pushIf = (p) => {
            if (!p || typeof p !== 'object') return;
            const name = String(p.name || p.title || '').toLowerCase();
            // Must contain 'protective screen'
            if (!/protective\s+screen/.test(name)) return;
            // Exclude pad kits, replacement nets, combo L screens, wheel kits, and explicit replacement language
            if (/pad kit|replacement|combo|wheel kit/.test(name)) return;
            // Accept primary frame products only
            const sku = String(p.sku || p.id || name);
            if (seen.has(sku)) return;
            seen.add(sku);
            protective.push(p);
          };
          // Scan all categories to be resilient if source category changes
            if (prodListData.categories && typeof prodListData.categories === 'object') {
              for (const key of Object.keys(prodListData.categories)) {
                const arr = prodListData.categories[key];
                if (Array.isArray(arr)) arr.forEach(pushIf);
              }
            }
          // If we found a meaningful subset, replace items
          if (protective.length) {
            // Sort by extracted size (e.g., 7x7, 8x8, 10x10) ascending
            const sizeRank = (p) => {
              const text = (p.name || p.title || '').toLowerCase();
              const m = text.match(/(\d{1,2})x(\d{1,2})/);
              if (m) return parseInt(m[1],10) * 100 + parseInt(m[2],10); // basic weight
              return 9999; // push unknown sizes to end
            };
            protective.sort((a,b)=> sizeRank(a) - sizeRank(b));
            items = protective;
          }
        }
        // Custom BULLET aggregation for baseball-l-screens: include every product whose name or sku starts with Bullet (excluding obvious accessories like pad kits & wheel kits)
        if (pageKey === 'baseball-l-screens' && prodListData && prodListData.categories && typeof prodListData.categories === 'object') {
          const bullet = [];
          const seen = new Set();
          const reject = /pad kit|wheel kit/i;
          for (const arr of Object.values(prodListData.categories)) {
            if (!Array.isArray(arr)) continue;
            for (const p of arr) {
              if (!p) continue;
              const sku = String(p.sku||'');
              const name = String(p.name||p.title||'');
              if (/^BULLET/i.test(sku) || /^Bullet\b/i.test(name)) {
                if (reject.test(name)) continue; // skip accessories
                const key = sku || name;
                if (seen.has(key)) continue;
                seen.add(key);
                bullet.push(p);
              }
            }
          }
          if (bullet.length) {
            // Sort by a preferred size/order sequence if detectable (JR < L < Front Toss < Combo < Fast Pitch < Overhead < Protective (size ascending))
            const rank = (p) => {
              const t = (p.name||'').toLowerCase();
              if (/jr\b/.test(t)) return 10;
              if (/\bl\b/.test(t) && !/jr/.test(t)) return 20;
              if (/front toss/.test(t)) return 30;
              if (/fast pitch/.test(t)) return 40;
              if (/combo/.test(t) && /overhead/.test(t)) return 50;
              if (/combo/.test(t)) return 55;
              if (/overhead/.test(t)) return 60;
              if (/protective/.test(t)) {
                // size extraction 7x7 etc.
                const m = t.match(/(\d{1,2})x(\d{1,2})/);
                if (m) return 100 + parseInt(m[1],10);
                return 120;
              }
              return 200; // fallback
            };
            bullet.sort((a,b)=> rank(a)-rank(b));
            items = bullet;
          }
        }
        // Page-specific trimming logic: For baseball-l-screens & protective-screens pages
        // only show products up to and including the core 10x10 screen (exclude pad kits, replacement nets, etc.)
        // NOTE: This trimming previously applied to protective-screens but was producing unintended cuts.
        if ((pageKey === 'baseball-l-screens') && items.length) {
          // Identify the first item whose sku or name references a 10x10 core screen.
          // Accept patterns: '10x10' and not containing 'replacement' or 'pad kit'
          const idx = items.findIndex(p => {
            const sku = (p.sku||'').toString().toLowerCase();
            const name = (p.name||p.title||'').toString().toLowerCase();
            const text = sku + ' ' + name;
            if (!/10x10/.test(text)) return false;
            if (/replacement/.test(text)) return false; // skip replacement nets
            if (/pad kit|pad\s*kit/.test(text)) return false; // skip pad kits
            return true;
          });
          if (idx !== -1) {
            // Keep everything up to and including idx
            items = items.slice(0, idx + 1);
          } else {
            // Fallback: filter out obvious pad kits & replacement nets even if 10x10 not matched
            items = items.filter(p => {
              const name = (p.name||p.title||'').toLowerCase();
              return !/pad kit|replacement/.test(name);
            });
          }
        }
      }
      if (!items.length) {
        this.renderEmptyState(grid);
        return;
      }

      // Special aggregation on Accessories: group Twine Spool, Cable, and 5/16" Poly Twisted Rope into single cards
      if (pageKey === 'accessories') {
        const isTwineSpool = (p) => /forever\s*black\s*twine\s*spool/i.test(String(p.name||p.title||''));
        const isCable = (p) => /^CABLE/i.test(String(p.sku||''));
        const isRopeFt = (p) => String(p.sku||'').toUpperCase() === '5/16-TPLYSTER-xFT'.toUpperCase();
        const isRopeSpool = (p) => String(p.sku||'').toUpperCase() === '5/16-TPLYSTER-1270'.toUpperCase();
        const isRope = (p) => isRopeFt(p) || isRopeSpool(p);

        // Exclude specific accessories from Accessories page
        const shouldExclude = (p) => {
          const name = String(p.name || p.title || '').toLowerCase();
          // Remove Bullet Wheel Kit, Bullet Fixed Leg, Bullet Replacement Wheels
          if (/bullet\s*wheel\s*kit/i.test(name)) return true;
          if (/bullet\s*fixed\s*leg/i.test(name)) return true;
          if (/bullet\s*replacement\s*wheels?/i.test(name)) return true;
          return false;
        };
        // Apply grouping and exclusions
        const base = items.filter(p => !shouldExclude(p));
        const twines = base.filter(isTwineSpool);
        const cables = base.filter(isCable);
        const ropeFt = base.find(isRopeFt);
        const ropeSpool = base.find(isRopeSpool);
        const others = base.filter(p => !isTwineSpool(p) && !isCable(p) && !isRope(p));
        if (twines.length || cables.length || ropeFt || ropeSpool) {
          grid.innerHTML = '';
          grid.classList.add('grid','grid-3','product-grid');
          const MAX_PAGE_ITEMS = 24;
          const groupCount = (twines.length?1:0) + (cables.length?1:0) + ((ropeFt||ropeSpool)?1:0);
          const room = Math.max(0, MAX_PAGE_ITEMS - groupCount);
          // Render other accessories first
          others.slice(0, room).forEach(p => {
            const card = this.buildProductCard(this.normalizeProdListItem(p));
            if (card) grid.appendChild(card);
          });
          // Helper to build a group card
          const buildGroupCard = ({title, items, href, alt, img}) => {
            const prices = items.map(p => Number(p.map ?? p.price ?? p.wholesale ?? 0) || 0).filter(v=>isFinite(v)&&v>0);
            const minP = prices.length ? Math.min(...prices) : 0;
            const maxP = prices.length ? Math.max(...prices) : 0;
            const range = prices.length ? (minP===maxP ? currency.format(minP) : `${currency.format(minP)} - ${currency.format(maxP)}`) : '';
            // Prefer curated image when provided
            const curated = img && typeof img === 'string' ? img : '';
            const firstImg = curated || this.normalizeProdListItem(items[0]).img || 'assets/img/EZSportslogo.png';
            const showPadDots = /\bbullet\s*pad\s*kits?\b/i.test(String(title||''));
            const padDotColors = showPadDots
              ? ['black','columbiablue','darkgreen','green','maroon','navy','orange','purple','red','royal','yellow']
              : [];
            const initialColorIndex = padDotColors.length ? Math.floor(Math.random() * padDotColors.length) : -1;
            const colorDotsHtml = (showPadDots && padDotColors.length) ? `
              <div class="color-dots" data-product-id="bullet-pad-kits">
                ${padDotColors.map((c, idx) => `
                  <div class="color-dot ${c} ${idx === initialColorIndex ? 'active' : ''}"
                       data-color="${c}"
                       data-image="${firstImg}"
                       title="${c.charAt(0).toUpperCase() + c.slice(1)}"
                       role="button"
                       tabindex="0"
                       aria-label="Select ${c}"></div>
                `).join('')}
              </div>
            ` : '';
            const article = document.createElement('article');
            article.className = 'card';
            article.innerHTML = `
              <a class="media" href="${href}"><img src="${firstImg}" alt="${alt||title}" loading="lazy" class="product-main-image"/></a>
              <div class="body">
                <h3 class="h3-tight"><a href="${href}">${title}</a></h3>
                ${colorDotsHtml}
                <div class="price-row">
                  <span class="price">${range}</span>
                  <a class="btn btn-ghost" href="${href}" aria-label="View ${title}">View</a>
                </div>
              </div>`;

            // Bind dot interactions for this grouped card
            try {
              if (showPadDots) {
                const dots = article.querySelectorAll('.color-dot');
                dots.forEach(dot => {
                  dot.addEventListener('click', (ev) => {
                    const colorDot = ev.currentTarget;
                    const container = colorDot.closest('.color-dots');
                    const card = colorDot.closest('article');
                    const productImage = card ? card.querySelector('.product-main-image') : null;
                    const newImageSrc = colorDot.dataset.image;
                    if (container) container.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                    colorDot.classList.add('active');
                    if (productImage && newImageSrc) productImage.src = newImageSrc;
                  });
                  dot.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      ev.currentTarget.click();
                    }
                  });
                });
              }
            } catch {}
            return article;
          };
          // Helper to build the special grouped rope card that links to a dedicated product page
          const buildRopeGroupCard = ({ ropeFt, ropeSpool }) => {
            // Normalize an image from either record
            const pickImg = (rec) => rec ? this.normalizeProdListItem(rec).img : '';
            const curated = 'assets/prodImgs/Accessories/Twisted_rope/twisted_rope.jpeg';
            const firstImg = curated || pickImg(ropeSpool) || pickImg(ropeFt) || 'assets/img/EZSportslogo.png';
            const href = 'product.html?pid=rope-516-poly';
            const article = document.createElement('article');
            article.className = 'card';
            article.innerHTML = `
              <a class="media" href="${href}"><img src="${firstImg}" alt="5/16\" Poly Twisted Rope" loading="lazy" class="product-main-image"/></a>
              <div class="body">
                <h3 class="h3-tight"><a href="${href}">5/16\" Poly Twisted Rope</a></h3>
                <div class="price-row">
                  <span class="price">Price may vary</span>
                  <a class="btn btn-ghost" href="${href}" aria-label="View 5/16\" Poly Twisted Rope">View</a>
                </div>
              </div>`;
            return article;
          };
          if (twines.length) {
            grid.appendChild(buildGroupCard({ title:'Forever Black Twine Spool', items: twines, href:'product.html?pid=twine-forever-black', alt:'Forever Black Twine Spool', img: 'assets/prodImgs/Accessories/Forever/black_twine.jpeg' }));
          }
          if (cables.length) {
            grid.appendChild(buildGroupCard({ title:'Cable', items: cables, href:'product.html?pid=cable-wire', alt:'Galvanized Cable', img: 'assets/prodImgs/Accessories/Cable/cable.jpeg' }));
          }
          if (ropeFt || ropeSpool) {
            grid.appendChild(buildRopeGroupCard({ ropeFt, ropeSpool }));
          }
          // Curated Accessories navigation card: Bullet Pad Kits
          try {
            const padImg = 'assets/prodImgs/Bullet_Pad_Kit/bulletpadkit.avif';
            // Gather Bullet Pad Kits to compute a proper price range for the card
            let padItems = [];
            // Prefer unified catalog by category when available
            if (Array.isArray(window.CATALOG_BY_CATEGORY?.['bullet-pad-kits']) && window.CATALOG_BY_CATEGORY['bullet-pad-kits'].length) {
              padItems = window.CATALOG_BY_CATEGORY['bullet-pad-kits'].map(r => r.raw || r);
            }
            // Fallback to prodList.json category
            if (!padItems.length && prodListData && prodListData.categories && Array.isArray(prodListData.categories['Bullet Pad Kits'])) {
              padItems = prodListData.categories['Bullet Pad Kits'];
            }
            // As a resilient fallback, scan all categories for obvious pad kits
            if (!padItems.length && prodListData && prodListData.categories && typeof prodListData.categories === 'object') {
              for (const arr of Object.values(prodListData.categories)) {
                if (!Array.isArray(arr)) continue;
                arr.forEach(p => {
                  const sku = String(p?.sku || '').toUpperCase();
                  const name = String(p?.name || p?.title || '').toLowerCase();
                  if (sku.startsWith('PK-') || /\bpad\s*kit\b/.test(name)) padItems.push(p);
                });
              }
            }
            const padCard = buildGroupCard({ title:'Bullet Pad Kits', items: padItems, href:'bullet-pad-kits.html', alt:'Bullet Pad Kits', img: padImg });
            if (padCard) grid.appendChild(padCard);
          } catch {}
          return; // done with custom rendering
        }
      }

      grid.innerHTML = '';
      const MAX_PAGE_ITEMS = 12;
      items.slice(0, MAX_PAGE_ITEMS).forEach(p => {
        const card = this.buildProductCard(this.normalizeProdListItem(p));
        if (card) grid.appendChild(card);
      });
      // Admin append removed to enforce strict prodList-only display and max cap

      // Bind add buttons
      grid.querySelectorAll('.js-add').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.addEventListener('click', () => {
          const d = btn.dataset;
          const card = btn.closest('article');
          const activeDot = card ? card.querySelector('.color-dot.active') : null;
          const selectedColor = activeDot ? activeDot.dataset.color : undefined;
          const imgEl = card ? card.querySelector('.product-main-image') : null;
          const currentImg = imgEl?.getAttribute('src') || d.img;
          const product = { id: d.id, title: d.title, price: Number(d.price)||0, category: d.category || (pageKey || 'misc'), img: currentImg };
          try { window.Store && window.Store.add(product, { color: selectedColor }); } catch (e) { console.error(e); }
        });
      });
    } catch (e) {
      console.warn('Page product grid failed:', e);
    }
  },

  async fetchProdList() {
    // Cache result during session to avoid repeated fetches
    if (this._prodList) return this._prodList;
    const urls = ['assets/prodList.json', 'prodList.json'];
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: 'same-origin', cache: 'no-cache' });
        if (!res.ok) throw new Error('not found');
        const json = await res.json();
        if (json && (typeof json === 'object' || Array.isArray(json))) {
          // Filter out hidden/draft/inactive items so they never render on pages
          const isVisible = (p) => {
            try {
              if (!p || typeof p !== 'object') return false;
              if (p.hidden === true) return false;
              if (p.draft === true) return false;
              if (p.active === false) return false;
              if (p.exclude === true || p.excluded === true) return false;
            } catch {}
            return true;
          };
          let filtered = json;
          try {
            if (json && json.categories && typeof json.categories === 'object') {
              const newCats = {};
              for (const [name, arr] of Object.entries(json.categories)) {
                newCats[name] = Array.isArray(arr) ? arr.filter(isVisible) : arr;
              }
              filtered = { ...json, categories: newCats };
            }
          } catch {}
          this._prodList = filtered;
          return filtered;
        }
      } catch (e) { /* try next */ }
    }
    // Not present yet or invalid; caller will handle empty state
    return null;
  },

  // Normalize raw entries from prodList.json categories into the minimal shape our UI expects
  normalizeProdListItem(p) {
    if (!p || typeof p !== 'object') return p;
    // Prefer stable, human-unique identifiers over generic SKUs that can collide (e.g., "Screen Component")
    const id = String(p.id || p.name || p.title || p.sku || Math.random().toString(36).slice(2));
    const title = String(p.name || p.title || id);
    // Helper to parse values like "1.5/ft", "$0.50/ft", or plain numbers
    const parseAmountAndUnit = (val) => {
      if (val == null) return { amount: 0, unit: '' };
      if (typeof val === 'number') return { amount: Number(val) || 0, unit: '' };
      if (typeof val === 'string') {
        const s = val.trim();
        // Capture leading number (with optional $) and optional /unit suffix
        const m = s.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*([a-zA-Z]+))?/);
        if (m) {
          const amount = Number(m[1]) || 0;
          const unit = m[2] ? ('/' + m[2].toLowerCase()) : (s.includes('/ft') ? '/ft' : '');
          return { amount, unit };
        }
      }
      return { amount: Number(val) || 0, unit: '' };
    };
    // Prefer explicit price fields; fall back to details.price, map, then wholesale, or derive from variations
    let unitSuffix = '';
    let parsed = parseAmountAndUnit(p.price ?? p.map ?? p.wholesale ?? 0);
    let price = parsed.amount || 0;
    if (!unitSuffix && parsed.unit) unitSuffix = parsed.unit;
    if ((!isFinite(price) || price <= 0) && p.details && (p.details.price != null)) {
      const dp = parseAmountAndUnit(p.details.price);
      if (isFinite(dp.amount) && dp.amount > 0) {
        price = dp.amount;
        if (!unitSuffix && dp.unit) unitSuffix = dp.unit;
      }
    }
    // Collect variation prices (if any) for min/max display and as a fallback
    let varMin = null, varMax = null;
    if (Array.isArray(p.variations) && p.variations.length) {
      const prices = p.variations
        .map(v => {
          const pv = parseAmountAndUnit(v.map ?? v.price ?? 0);
          if (!unitSuffix && pv.unit) unitSuffix = pv.unit;
          return pv.amount;
        })
        .filter(v => isFinite(v) && v > 0);
      if (prices.length) {
        varMin = Math.min(...prices);
        varMax = Math.max(...prices);
      }
    }
    if ((!isFinite(price) || price <= 0) && (varMin != null)) {
      price = varMin;
    }
    // Robust image selection: prefer web URLs and known fields; avoid local file paths (e.g. C:\...)
    const isUsableSrc = (s) => typeof s === 'string' && /^(https?:|\/|assets\/)/i.test(s);
    let img = null;
    // 1) Explicit fields
    if (isUsableSrc(p.stripeImg)) img = p.stripeImg;
    if (isUsableSrc(p.img)) img = p.img;
    // 2) images object or array
    if (!img && p.images) {
      if (isUsableSrc(p.images.primary)) img = p.images.primary;
      else if (Array.isArray(p.images.all)) {
        const cand = p.images.all.find(isUsableSrc);
        if (cand) img = cand;
      } else if (Array.isArray(p.images)) {
        const cand = p.images.find(isUsableSrc);
        if (cand) img = cand;
      }
    }
    // 2b) stripeImages array
    if (!img && Array.isArray(p.stripeImages)) {
      const cand = p.stripeImages.find(isUsableSrc);
      if (cand) img = cand;
    }
    // 3) details.images
    if (!img && p.details && p.details.images) {
      const di = p.details.images;
      if (isUsableSrc(di.primary)) img = di.primary;
      else if (Array.isArray(di.all)) {
        const cand = di.all.find(isUsableSrc);
        if (cand) img = cand;
      }
    }
    // 4) other single fields
    if (!img && isUsableSrc(p.image)) img = p.image;
    if (!img && p.details && isUsableSrc(p.details.image_url)) img = p.details.image_url;
    // 5) downloaded_images (prefer web/relative entries only)
    const dl = (p.downloaded_images && Array.isArray(p.downloaded_images) ? p.downloaded_images : (p.details && Array.isArray(p.details.downloaded_images) ? p.details.downloaded_images : []));
    if (!img && dl && dl.length) {
      const cand = dl.find(isUsableSrc);
      if (cand) img = cand;
    }
    // If we have multiple candidate images under p.images (array) or details, apply a hero selection heuristic.
    // Hero selection priorities (higher first):
    //  1. filename contains '1a' (e.g., bulletjrbb1a.avif)
    //  2. filename ends with '1' before extension or pattern '(1)'
    //  3. filename contains '_a' or ends with 'a'
    //  4. fallback to longest filename (often more specific)
    const collectAll = () => {
      const out = new Set();
      const pushArr = (arr) => Array.isArray(arr) && arr.forEach(s => { if (isUsableSrc(s)) out.add(s); });
      if (p.images) {
        if (Array.isArray(p.images)) pushArr(p.images);
        if (Array.isArray(p.images.all)) pushArr(p.images.all);
        if (p.images.primary && isUsableSrc(p.images.primary)) out.add(p.images.primary);
      }
      if (Array.isArray(p.stripeImages)) pushArr(p.stripeImages);
      if (p.stripeImg && isUsableSrc(p.stripeImg)) out.add(p.stripeImg);
      if (p.details && p.details.images) {
        const di = p.details.images;
        if (Array.isArray(di)) pushArr(di);
        if (Array.isArray(di.all)) pushArr(di.all);
        if (di.primary && isUsableSrc(di.primary)) out.add(di.primary);
      }
      if (Array.isArray(p.downloaded_images)) pushArr(p.downloaded_images);
      if (p.details && Array.isArray(p.details.downloaded_images)) pushArr(p.details.downloaded_images);
      return Array.from(out);
    };
    if (img) {
      // We already chose something explicit; still see if a higher-priority hero exists among candidates.
      const candidates = collectAll();
      if (candidates.length) {
        const score = (s) => {
            const name = s.split('/').pop().toLowerCase();
            if (/1a\./.test(name)) return 100;
            if (/\(1\)\./.test(name)) return 90;
            if (/(?:^|[^\d])1\./.test(name)) return 85; // plain 1 before extension
            if (/_a\.|a\./.test(name)) return 70;
            return 10 + name.length; // prefer longer descriptive names
        };
        const best = candidates.sort((a,b)=> score(b)-score(a))[0];
        if (best && best !== img) img = best;
      }
    } else {
      // No explicit single image yet, attempt hero pick from aggregated candidates
      const candidates = collectAll();
      if (candidates.length) {
        const score = (s) => {
          const name = s.split('/').pop().toLowerCase();
          if (/1a\./.test(name)) return 100;
          if (/\(1\)\./.test(name)) return 90;
          if (/(?:^|[^\d])1\./.test(name)) return 85;
          if (/_a\.|a\./.test(name)) return 70;
          return 10 + name.length;
        };
        img = candidates.sort((a,b)=> score(b)-score(a))[0];
      }
    }
    const imagesList = (function(){
      try {
        const all = collectAll();
        // De-dupe and keep up to 11 for UI usage (color dots, etc.)
        const seen = new Set();
        const out = [];
        for (const s of all) { if (!seen.has(s)) { seen.add(s); out.push(s); if (out.length >= 11) break; } }
        return out;
      } catch { return []; }
    })();
    if (!img) img = 'assets/img/EZSportslogo.png';

    // Curated accessory image overrides
    try {
      const lowerId = (id || '').toLowerCase();
      const lowerTitle = (title || '').toLowerCase();
      // Screen Bulletz Leg Caps (Accessories)
      if (lowerId === 'screen bulletz' || /screen\s*bulletz/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Accessories/Screen_bulletz';
        const curated = [
          `${base}/screen_bulletz_a.avif`,
          `${base}/screen_bulletz1_a.avif`,
          `${base}/screen_bulletz2_a.avif`,
          `${base}/screen_bulletz3_a.avif`,
          `${base}/screen_bulletz4_a.avif`,
          `${base}/screen_bulletz5_a.avif`
        ];
        img = curated[0];
        // Use curated list as images, but keep any additional valid ones after
        const extra = Array.isArray(imagesList) ? imagesList.filter(s => !curated.includes(s)) : [];
        imagesList.splice(0, imagesList.length, ...curated, ...extra);
      }
      // Bullet Wheeled Ball Basket (Accessories)
      if (lowerId === 'wbasket' || /wheeled\s*ball\s*basket/.test(lowerTitle)) {
        const hero = 'assets/prodImgs/Accessories/Wbasket/wbasket.avif';
        img = hero;
        const extra = Array.isArray(imagesList) ? imagesList.filter(s => s !== hero) : [];
        imagesList.splice(0, imagesList.length, hero, ...extra);
      }
      // Armor Baseball Cart (Accessories)
      if (lowerId === 'armorbasket' || /armor\s*(baseball)?\s*cart|armor\s*basket/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Accessories/Armor_basket';
        const curated = [
          `${base}/armorwbasket.avif`,
          `${base}/armorwbasket2.avif`,
          `${base}/armorwbasket3.avif`
        ];
        img = curated[0];
        const extra = Array.isArray(imagesList) ? imagesList.filter(s => !curated.includes(s)) : [];
        imagesList.splice(0, imagesList.length, ...curated, ...extra);
      }
      // Pro Batting Mat (Accessories)
      if (lowerId === 'battingmat' || /\bbatting\s*mat\b/.test(lowerTitle)) {
        const base = 'assets/prodImgs/Battingmat';
        const curated = [
          `${base}/battingmata.avif`,
          `${base}/battingmat_blacka.avif`,
          `${base}/battingmat_browna.avif`,
          `${base}/battingmat_greena.avif`,
          `${base}/battingmat_orangea.avif`,
          `${base}/battingmat_reda.avif`,
          `${base}/battingmat_royala.avif`
        ];
        img = curated[0];
        const extra = Array.isArray(imagesList) ? imagesList.filter(s => !curated.includes(s)) : [];
        imagesList.splice(0, imagesList.length, ...curated, ...extra);
      }
    } catch {}
    // Expose min/max price for UI (range display) while keeping price as the lowest
    const minPrice = (function(){
      const candidates = [price];
      if (varMin != null) candidates.push(varMin);
      return Math.min(...candidates.filter(v => isFinite(v) && v > 0)) || price || 0;
    })();
    const maxPrice = (function(){
      const candidates = [];
      if (isFinite(price) && price > 0) candidates.push(price);
      if (varMax != null) candidates.push(varMax);
      if (varMin != null) candidates.push(varMin);
      return candidates.length ? Math.max(...candidates) : price || 0;
    })();
    return { id, title, price, minPrice, maxPrice, img, images: imagesList, category: (p.category || '').toString().toLowerCase(), priceUnit: unitSuffix };
  },

  buildProductCard(prod) {
    try {
      if (!prod || !prod.id) return null;
      const id = String(prod.id);
      const title = String(prod.title || 'Untitled');
      const price = Number(prod.price || 0);
      const img = String(prod.img || 'assets/img/netting.jpg');
      const lid = id.toLowerCase();
      const lt = title.toLowerCase();
      // Prefer showing a range when min/max are available; fall back to single price
      let displayPrice = '';
      const minP = Number(prod.minPrice ?? price ?? 0);
      const maxP = Number(prod.maxPrice ?? minP);
      const unit = (prod.priceUnit || '').trim();
      if (isFinite(minP) && minP > 0) {
        const isRange = (isFinite(maxP) && maxP > minP);
        displayPrice = isRange
          ? `${currency.format(minP)} - ${currency.format(maxP)}${unit ? unit : ''}`
          : `${currency.format(minP)}${unit ? unit : ''}`;
      }
      const href = `product.html?pid=${encodeURIComponent(id)}`;

      // Determine if this is one of the L-Screens sub nav pages for special layout
  const pageKey = this.getPageKey();
  const isLScreensSub = (new Set(['baseball-l-screens','baseball-l-screen','protective-screens','pitchers-pocket','replacement-screens'])).has(pageKey);

      // Extract color variations for this product and randomly choose an initial color
      const colors = this.extractProductColors(prod);
      const suppressDots = (() => {
        try {
          // Do not show dots for Screen Bulletz Leg Caps
          if (lid === 'screen bulletz' || /screen\s*bulletz/.test(lt)) return true;
          // Do not show dots for Armor Baseball Cart / Armor Basket
          if (lid === 'armorbasket' || /armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt)) return true;
          // Do not show dots for Vinyl Top by the FT (VINYL* SKUs)
          if (/^vinyl/.test(lid) || /vinyl\s*top/.test(lt)) return true;
        } catch {}
        return false;
      })();
      // Right-align Add button for Vinyl Top and Screen Padding cards when price is not displayed
      const moveAddRight = (/^vinyl/.test(lid) || /vinyl\s*top/.test(lt) || /screen\s*padding/.test(lt));
      const initialColorIndex = colors.length > 1 ? Math.floor(Math.random() * colors.length) : -1;
      const initialImg = (initialColorIndex >= 0 && colors[initialColorIndex]?.image) ? colors[initialColorIndex].image : img;
      const colorDotsHtml = (!suppressDots && colors.length > 1) ? `
        <div class="color-dots" data-product-id="${id}">
          ${colors.map((color, index) => `
            <div class="color-dot ${color.class} ${index === initialColorIndex ? 'active' : ''}" 
                 data-color="${color.name}" 
                 data-image="${color.image}"
                 title="${color.class && color.class !== 'neutral' ? (color.class.charAt(0).toUpperCase() + color.class.slice(1)) : 'Image'}"
                 role="button" 
                 tabindex="0"
                 aria-label="Select ${color.class && color.class !== 'neutral' ? color.class : 'image'}">
            </div>
          `).join('')}
        </div>
      ` : '';

      const article = document.createElement('article');
      article.className = 'card';
      if (isLScreensSub) {
        // L-Screens sub nav layout: title + price on same row, color dots on bottom row, no Add button
        article.innerHTML = `
          <a class="media" href="${href}"><img src="${initialImg}" alt="${title}" loading="lazy" class="product-main-image" /></a>
          <div class="body">
            <div class="title-price-row">
              <h3 class="h3-tight"><a href="${href}">${title}</a></h3>
              ${displayPrice ? `<div class="price">${displayPrice}</div>` : ''}
            </div>
            ${colorDotsHtml}
          </div>`;
      } else {
        // Default layout
        article.innerHTML = `
          <a class="media" href="${href}"><img src="${initialImg}" alt="${title}" loading="lazy" class="product-main-image" /></a>
          <div class="body">
            <h3 class="h3-tight"><a href="${href}">${title}</a></h3>
            ${colorDotsHtml}
            <div class="price-row${(!displayPrice && moveAddRight) ? ' right' : ''}">
              ${displayPrice ? `<span class="price">${displayPrice}</span>` : ''}
              <a class="btn btn-ghost" href="${href}" aria-label="View ${title}">View</a>
            </div>
          </div>`;
      }
      
      // Bind color dot interactions for this card
      const colorDots = article.querySelectorAll('.color-dot');
      colorDots.forEach(dot => {
        dot.addEventListener('click', (ev) => {
          const colorDot = ev.currentTarget;
          const colorDotsContainer = colorDot.closest('.color-dots');
          const card = colorDot.closest('article');
          const productImage = card.querySelector('.product-main-image');
          const newImageSrc = colorDot.dataset.image;
          
          // Update active state
          colorDotsContainer.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
          colorDot.classList.add('active');
          
          // Update product image
          if (productImage && newImageSrc) {
            productImage.src = newImageSrc;
          }
        });

        // Keyboard support
        dot.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.currentTarget.click();
          }
        });
      });

      // If this card is JR or Pitcher's Pocket Pro, rebuild dots using dynamic color classification to ensure 1:1 dot→image
      try {
        const pidish = String(id || '').toLowerCase();
        const tish = String(title || '').toLowerCase();
        const isReplacementNet = (/\breplacement\b/.test(tish) && /\bnet\b/.test(tish)) || /replacement\s*nets?\b/.test(tish);
        const isNonScreenAccessory = /screen\s*padding|screen\s*component|screen\s*wheel|wheel\s*kit|leg\s*caps?\b/.test(tish);
        const isScreenBulletz = /screen\s*bulletz/.test(tish);
        const looksLikeJR = /bulletjrbb/.test(pidish) || /\bbullet\s*l\s*screen\s*jr\b/.test(tish) || /\bjr\b/.test(tish);
        const looksLikePocketPro = /pitcher'?s\s*pocket.*\bpro\b/.test(tish) || /bbpp[-_]?pro/.test(pidish) || /pppro/.test(pidish);
        const looksLikeLScreen = /\bl\s*-?\s*screen\b/.test(tish) || /\blscreen\b/.test(tish);
        const looksLikeProtectiveScreen = /\bprotective\s*screen\b/.test(tish);
        const looksLikePitchersPocket = /pitcher'?s\s*pocket\b/.test(tish) || /\bpitchers\s*pocket\b/.test(tish);
        const looksLikeAnyScreen = (/(^|\b)screen(\b|$)/.test(tish) || /\bfront\s*toss\b/.test(tish) || /\bfast\s*pitch\b/.test(tish))
          && !isReplacementNet
          && !isNonScreenAccessory
          && !isScreenBulletz;
        if (looksLikeJR || looksLikePocketPro || looksLikeAnyScreen || looksLikeLScreen || looksLikeProtectiveScreen || looksLikePitchersPocket) {
          const wrap = article.querySelector('.color-dots');
          const hasNeutral = !!wrap?.querySelector('.color-dot.neutral');
          if (hasNeutral) this._recolorJRDots(article);
        }
      } catch {}
      
      return article;
    } catch {
      return null;
    }
  },

  renderEmptyState(grid) {
    if (!grid) return;
    grid.innerHTML = '<div class="muted">No products available yet for this page.</div>';
  },

  // Inject a bottom "Talk with a Netting Expert" CTA on all pages except contact page
  ensureExpertCTA() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      const EXCLUDE = new Set(['contactus.html']);
      if (EXCLUDE.has(base)) return; // skip contact page
      // If already present, normalize its paragraph text for uniformity
      const existing = document.querySelector('.expert-cta');
      if (existing) {
        const p = existing.querySelector('p');
        if (p) p.textContent = 'Planning a facility or multi-field build? Talk with a netting expert for layout optimization, span design, hardware selection, and realistic lead times.';
        return;
      }
      const footer = document.querySelector('footer.site-footer');
      if (!footer) return;
      const section = document.createElement('section');
      section.className = 'expert-cta container';
      section.innerHTML = `
        <h2>Talk with a Netting Expert</h2>
        <p>Planning a facility or multi-field build? Talk with a netting expert for layout optimization, span design, hardware selection, and realistic lead times.</p>
        <button type="button" class="cta-btn" data-open-expert>Connect Now <span aria-hidden="true">›</span></button>
      `;
      footer.parentNode.insertBefore(section, footer);
      section.querySelector('[data-open-expert]')?.addEventListener('click', () => {
        // Focus any existing expert/help form if present on the page
        const nameField = document.querySelector('#contact-name, #expert-name');
        if (nameField) { nameField.scrollIntoView({ behavior:'smooth', block:'center' }); nameField.focus(); }
        // Fallback: navigate to contact page
        else { window.location.href = 'contactus.html'; }
      });
    } catch {}
  },

  // Standardize all "Request Quote" / "Get Quote" buttons on netting pages to a black style
  ensureQuoteButtons() {
    try {
      // Only run on netting related pages (presence of netting hero or subnav)
      const isNettingPage = !!document.querySelector('.netting-hero, .net-hero, #netting-subnav');
      if (!isNettingPage) return;
      const buttons = Array.from(document.querySelectorAll('button'));
      buttons.forEach(btn => {
        const label = (btn.textContent || '').trim().toLowerCase();
        if (label === 'request quote' || label === 'get quote') {
          btn.textContent = 'Request Quote';
          // Ensure navigation to contact page if no explicit handler
          if (!btn.getAttribute('onclick')) {
            btn.addEventListener('click', () => { window.location.href = 'contactus.html'; });
          }
          // Normalize classes
          const classes = new Set((btn.className || '').split(/\s+/).filter(Boolean));
          classes.delete('btn-primary');
          classes.add('btn');
            classes.add('btn-quote');
          btn.className = Array.from(classes).join(' ');
        }
      });
    } catch {}
  },

  // Replace placeholder logo.svg with new brand image in header & footer
  ensureBrandLogos() {
    try {
      const HEADER_SRC = 'assets/img/EZSportslogo.png';
      const FOOTER_SRC = 'assets/img/footLogo.png';
      // Only target the brand logo in header and the non-social logo image in footer.
      const headerImgs = Array.from(document.querySelectorAll('.site-header .brand img'));
      const footerImgs = Array.from(document.querySelectorAll('.footer-brand-block img')).filter(img => !img.closest('.socials'));
      headerImgs.forEach(img => {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const isSocial = img.closest('.socials') || /facebook|instagram|twitter|social/.test(alt);
        if (isSocial) return; // never override social icons
        img.setAttribute('src', HEADER_SRC);
        img.setAttribute('alt', 'EZ Sports Netting logo');
        if (!img.getAttribute('height')) img.setAttribute('height', '40');
      });
      footerImgs.forEach(img => {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const isSocial = img.closest('.socials') || /facebook|instagram|twitter|social/.test(alt);
        if (isSocial) return;
        img.setAttribute('src', FOOTER_SRC);
        img.setAttribute('alt', 'EZ Sports Netting logo');
        if (!img.getAttribute('height')) img.setAttribute('height', '168');
      });
    } catch {}
  },

  // Ensure footer "Netting" link (generic category) points to EZ Custom Nets overview, not calculator
  ensureFooterNettingLink() {
    try {
      const footer = document.querySelector('footer');
      if (!footer) return;
      // Find links inside any footer Shop section whose text is exactly "Netting"
      const links = Array.from(footer.querySelectorAll('a'));
      links.forEach(a => {
        const label = (a.textContent || '').trim().toLowerCase();
        if (label === 'netting' && /netting-calculator\.html$/i.test(a.getAttribute('href')||'')) {
          a.setAttribute('href', 'ez-nets.html');
        }
      });
    } catch {}
  },

  logout() {
    try {
      const bases = [];
      if (location.port === '5500') { bases.push('http://localhost:4242','http://127.0.0.1:4242'); }
      bases.unshift(window.__API_BASE || '');
      const tried = new Set();
      bases.forEach(base => {
        if (tried.has(base)) return; tried.add(base);
        fetch(`${base}/api/users/logout`, { method:'POST', credentials:'include' }).catch(()=>{});
      });
    } catch {}
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    this.state.user = null;
    this.updateNavigation();
    window.location.href = 'index.html';
  },

  filter(category) {
    this.state.filter = category || 'all';
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x.dataset.chip === this.state.filter));
    this.renderProducts();
    // Jump to catalog
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  search(q) {
    this.state.filter = 'all';
    this.renderProducts(q);
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // Extract color variants from product images array
  extractProductColors(product) {
    // Accept multiple possible image sources: product.images (API), product.raw.images (catalog), or raw.gallery
    let sources = [];
    if (Array.isArray(product.images)) sources = product.images.slice();
    else if (product.raw) {
      if (Array.isArray(product.raw.stripeImages)) sources = product.raw.stripeImages.slice();
      else if (Array.isArray(product.raw.images)) sources = product.raw.images.slice();
      else if (Array.isArray(product.raw.gallery)) sources = product.raw.gallery.slice();
    }

    // Standard team-color palette used across covered screen products
    const TEAM_COLORS = ['black','columbiablue','darkgreen','green','maroon','navy','orange','purple','red','royal','yellow'];
    const numberedSetToTeamColors = (srcs) => {
      try {
        const map = new Map();
        (Array.isArray(srcs) ? srcs : []).forEach(src => {
          const name = String(src || '').split('/').pop().toLowerCase();
          const m = name.match(/^(\d{2})\.(?:png|jpe?g|webp|avif|gif|svg)(\?|$)/);
          if (!m) return;
          const idx = parseInt(m[1], 10);
          if (!Number.isFinite(idx)) return;
          if (!map.has(idx)) map.set(idx, src);
        });
        for (let i = 1; i <= TEAM_COLORS.length; i++) {
          if (!map.has(i)) return null;
        }
        return TEAM_COLORS.map((c, i) => ({ name: c, class: c, image: map.get(i + 1) }));
      } catch {
        return null;
      }
    };
    // Product-specific override: Wheeled Ball Basket should show standard team-color swatches even without per-color images
    try {
      const pidish = String(product.id || product.sku || '').toLowerCase();
      const tish = String(product.title || '').toLowerCase();
      const looksLikeWBasket = pidish === 'wbasket' || (/wheeled\s*ball\s*basket/.test(tish));
      if (looksLikeWBasket) {
        // Prefer full 01..11 set when present; else use a single hero image for all colors.
        const mapped = numberedSetToTeamColors(sources);
        if (mapped) return mapped;
        const hero = (Array.isArray(sources) && sources[0]) || product.img || 'assets/prodImgs/Accessories/Wbasket/wbasket.avif';
        return TEAM_COLORS.map(c => ({ name: c, class: c, image: hero }));
      }

      const looksLikeScreenPadding = (/screen\s*padding/.test(tish)) || (pidish === 'screen component' && /padding/.test(tish));
      if (looksLikeScreenPadding) {
        // Prefer full 01..11 set when present; else use a single hero image for all colors.
        const mapped = numberedSetToTeamColors(sources);
        if (mapped) return mapped;
        const hero = (Array.isArray(sources) && sources[0]) || product.img || 'assets/prodImgs/Accessories/Padding/padding.png';
        return TEAM_COLORS.map(c => ({ name: c, class: c, image: hero }));
      }

      const looksLikeBulletPadKit = (/^pk-?bullet/.test(pidish)) || (/(^|\b)bullet\s*pad\s*kits?(\b|$)/.test(tish));
      if (looksLikeBulletPadKit) {
        // Prefer full 01..11 set when present; else use a single hero image for all colors.
        const mapped = numberedSetToTeamColors(sources);
        if (mapped) return mapped;
        const hero = (Array.isArray(sources) && sources[0]) || product.img || 'assets/prodImgs/Bullet_Pad_Kit/bulletpadkit.avif';
        return TEAM_COLORS.map(c => ({ name: c, class: c, image: hero }));
      }
    } catch {}
    if (!sources.length) return [];

    // Covered screen products: enforce standardized team-color variations WITH matching photos.
    // If the full 01..11 set isn't present, suppress dots (and let the audit script report it).
    try {
      const titleLower = String(product.title || product.name || '').toLowerCase();
      const idLower = String(product.id || product.sku || '').toLowerCase();
      const isReplacementNet = (/\breplacement\b/.test(titleLower) && /\bnet\b/.test(titleLower)) || /replacement\s*nets?\b/.test(titleLower);
      const isScreenBulletz = /screen\s*bulletz/.test(titleLower);
      const isNonScreenAccessory = /screen\s*padding|screen\s*component|screen\s*wheel|wheel\s*kit|leg\s*caps?\b/.test(titleLower);
      const looksLikeAnyScreen = (/(^|\b)screen(\b|$)/.test(titleLower) || /\bfront\s*toss\b/.test(titleLower) || /\bfast\s*pitch\b/.test(titleLower))
        && !isReplacementNet
        && !isNonScreenAccessory
        && !isScreenBulletz;
      const looksLikePitchersPocket = /pitcher'?s\s*pocket\b/.test(titleLower) || /\bpitchers\s*pocket\b/.test(titleLower) || /bbpp[-_]?pro/.test(idLower) || /pppro/.test(idLower);
      const isTeamColorCoveredProduct = looksLikeAnyScreen || looksLikePitchersPocket;
      if (isTeamColorCoveredProduct) {
        return numberedSetToTeamColors(sources) || [];
      }
    } catch {}

    // Baffles + Backstop: never show color dots (single-SKU / no meaningful color variants)
    try {
      const pidish = String(product.id || product.sku || '').toLowerCase();
      const tish = String(product.title || '').toLowerCase();
      const isBaffles = /\bbaffles?\b/.test(tish);
      const isBackstop = /\bbackstop\b/.test(tish) || pidish === 'ez-bkstp' || pidish === 'ez_bkstp';
      if (isBaffles || isBackstop) return [];
    } catch {}

    // Pro Batting Mat: only Clay + Green are available; battingmata.avif is the Clay image
    try {
      const pidish = String(product.id || product.sku || '').toLowerCase();
      const tish = String(product.title || '').toLowerCase();
      const looksLikeBattingMat = (pidish === 'battingmat') || (/\bbatting\s*mat\b/.test(tish));
      if (looksLikeBattingMat) {
        const norm = (s) => (s || '').toString().split('/').pop().toLowerCase();
        const claySrc = sources.find(s => /battingmata\.(?:avif|png|jpe?g|webp|gif)$/i.test(norm(s)))
          || sources.find(s => /browna\./i.test(norm(s)))
          || sources.find(s => /\b(brown|clay)\b/.test(norm(s)));
        const greenSrc = sources.find(s => /\bgreen\b/.test(norm(s)))
          || sources.find(s => {
            // fallback: if curated sources are present but not named, treat the first non-clay as green
            if (!claySrc) return true;
            return String(s || '') !== String(claySrc || '');
          });
        const out = [];
        if (claySrc) out.push({ name: 'clay', class: 'maroon', image: claySrc });
        if (greenSrc) out.push({ name: 'green', class: 'green', image: greenSrc });
        return out;
      }
    } catch {}

    // Special-case (legacy): some Bullet JR images were previously numbered without color tokens.
    // Only apply this fallback if we actually detect numbered filenames; otherwise
    // proceed with normal color extraction (new colored filenames are supported).
    try {
      const lowerSources = sources.map(s => ({ src: s, name: (s.split('/').pop()||'').toLowerCase() }));
      const hasNumberedJR = lowerSources.some(it => /^bulletjrbb\d{1,2}(a)?\./.test(it.name));
      if (hasNumberedJR) {
        const seq = lowerSources.sort((a,b)=>{
          const re = /bulletjrbb(\d{1,2})(a)?\./;
          const ma = a.name.match(re); const mb = b.name.match(re);
          const ia = ma ? parseInt(ma[1],10) : 999; const ib = mb ? parseInt(mb[1],10) : 999;
          const aa = ma && ma[2] ? 1 : 0; const ab = mb && mb[2] ? 1 : 0; // 'a' comes first
          return ia - ib || (ab - aa);
        });
        const out = [];
        const seenIdx = new Set();
        const re = /bulletjrbb(\d{1,2})(a)?\./;
        for (const it of seq) {
          const m = it.name.match(re);
          if (!m) continue;
          const n = parseInt(m[1],10);
          if (seenIdx.has(n)) continue; // keep only best for each index
          seenIdx.add(n);
          out.push({ name: `jr-${n}`, class: 'neutral', image: it.src });
          if (out.length >= 11) break;
        }
        if (out.length) return out;
      }
    } catch {}

    // Define colors with specific-first ordering and simple synonyms to avoid collisions
    const colorDefs = [
      { name: 'columbiablue', class: 'columbiablue', patterns: ['columbiablue','columbia'] },
      { name: 'darkgreen', class: 'darkgreen', patterns: ['darkgreen'] },
      { name: 'maroon', class: 'maroon', patterns: ['maroon'] },
      // Brown not used widely, but keep as a semantic placeholder; if CSS lacks .brown it will render neutral styling.
      { name: 'brown', class: 'brown', patterns: ['brown'] },
      { name: 'purple', class: 'purple', patterns: ['purple'] },
      { name: 'orange', class: 'orange', patterns: ['orange'] },
      { name: 'yellow', class: 'yellow', patterns: ['yellow'] },
      { name: 'royal', class: 'royal', patterns: ['royal','ryoal'] },
      { name: 'navy', class: 'navy', patterns: ['navy'] },
      // Generics include excludes to avoid matching specific shades
      { name: 'green', class: 'green', patterns: ['green'], excludes: ['darkgreen'] },
      { name: 'blue', class: 'blue', patterns: ['blue'], excludes: ['columbiablue'] },
      { name: 'red', class: 'red', patterns: ['red'] },
      { name: 'white', class: 'white', patterns: ['white'] },
      { name: 'black', class: 'black', patterns: ['black'] },
    ];

    const nonZoom = [];
    const zoom = [];
    sources.forEach(src => {
      const name = src.split('/').pop().toLowerCase();
      const isZoom = name.includes('_a.') || name.includes('(1).');
      (isZoom ? zoom : nonZoom).push({ src, name });
    });

    const picked = {};
    const has = (color) => Object.prototype.hasOwnProperty.call(picked, color);
    const findMatch = (list, patterns, excludes = []) => list.find(item => {
      if (excludes.length && excludes.some(ex => item.name.includes(ex))) return false;
      return patterns.some(p => item.name.includes(p));
    });

    colorDefs.forEach(def => {
      // Prefer non-zoom; fallback to zoom if needed
      const candidate = findMatch(nonZoom, def.patterns, def.excludes) || findMatch(zoom, def.patterns, def.excludes);
      if (candidate && !has(def.name)) {
        picked[def.name] = { class: def.class, image: candidate.src };
      }
    });

    // Build output array in the defined order to ensure consistent dot ordering
    const out = [];
    colorDefs.forEach(def => {
      if (has(def.name)) out.push({ name: def.name, class: def.class, image: picked[def.name].image });
    });
    // Include any remaining images that didn't match a color as neutral (no numeric labels)
    try {
      const used = new Set(out.map(o => o.image));
      const seq = nonZoom.concat(zoom);
      seq.forEach(it => { if (!used.has(it.src)) out.push({ name: 'option', class: 'neutral', image: it.src }); });
    } catch {}
    // Fallback: if still nothing, add up to 6 neutral dots without numeric labels (avoid numbered dots on cards)
    if (out.length === 0) {
      const seq = nonZoom.concat(zoom);
      const max = Math.min(6, seq.length);
      for (let i = 0; i < max; i++) {
        out.push({ name: 'option', class: 'neutral', image: seq[i].src });
      }
    }
    // Special-case adjustments and final gating:
    // Only show dots when there are 2+ distinct *real* colors. If we only have neutral/unknown
    // images (angles/zooms), hide dots to avoid the all-gray dot row.
    try {
      const pidish = String(product.id || product.sku || '').toLowerCase();
      const tish = String(product.title || product.name || '').toLowerCase();

      // Batting Mat: show only real color dots, remove any leftover neutral 'option' dot (generic hero)
      if (pidish === 'battingmat' || /\bbatting\s*mat\b/.test(tish)) {
        const real = out.filter(o => o.class && o.class !== 'neutral');
        const seen = new Set();
        const unique = [];
        real.forEach(o => { if (!seen.has(o.class)) { seen.add(o.class); unique.push(o); } });
        return unique.length >= 2 ? unique : [];
      }

      // (JR / L-Screens / Protective Screens / Pitcher's Pocket families are handled above
      // by seeding neutral dots and using the recolor pass.)
    } catch {}

    const real = out.filter(o => o.class && o.class !== 'neutral');
    const seen = new Set();
    const unique = [];
    real.forEach(o => { if (!seen.has(o.class)) { seen.add(o.class); unique.push(o); } });
    return unique.length >= 2 ? unique : [];
  },

  // Palette and color utils for JR dynamic classification
  _palette() {
    return [
      { name: 'black', class: 'black', rgb: [0,0,0] },
      { name: 'white', class: 'white', rgb: [255,255,255] },
      { name: 'red', class: 'red', rgb: [220,38,38] },
      { name: 'maroon', class: 'maroon', rgb: [153,27,27] },
      { name: 'orange', class: 'orange', rgb: [234,88,12] },
      { name: 'yellow', class: 'yellow', rgb: [234,179,8] },
      { name: 'green', class: 'green', rgb: [22,163,74] },
      { name: 'darkgreen', class: 'darkgreen', rgb: [21,128,61] },
      { name: 'navy', class: 'navy', rgb: [30,64,175] },
      { name: 'royal', class: 'royal', rgb: [59,130,246] },
      { name: 'columbiablue', class: 'columbiablue', rgb: [96,165,250] },
      { name: 'purple', class: 'purple', rgb: [147,51,234] }
    ];
  },
  _rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{ const d=max-min; s=l>0.5? d/(2-max-min):d/(max+min);
      switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;} h/=6; }
    return [h*360,s,l];
  },
  async _classifyImageToPalette(src){
    return new Promise(resolve=>{
      const img=new Image(); img.crossOrigin='anonymous'; img.decoding='async';
      img.onload=()=>{
        try{
          const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
          const W=32,H=32; canvas.width=W; canvas.height=H; ctx.drawImage(img,0,0,W,H);
          const data=ctx.getImageData(0,0,W,H).data; const votes = new Map();
          const pal=this._palette();
          for(let i=0;i<data.length;i+=4){
            const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3]; if (a<200) continue;
            const [h,s,l]=this._rgbToHsl(r,g,b);
            if (s<0.25 || l<0.15 || l>0.85) continue; // ignore low saturation & extremes
            // Map very dark to black
            if (l<0.2) { votes.set('black',(votes.get('black')||0)+1); continue; }
            // Pick nearest by simple RGB distance to palette
            let best='black', bestD=1e9; for (const p of pal){
              const dr=r-p.rgb[0], dg=g-p.rgb[1], db=b-p.rgb[2]; const d=dr*dr+dg*dg+db*db;
              if (d<bestD){ bestD=d; best=p.name; }
            }
            votes.set(best,(votes.get(best)||0)+1);
          }
          let winner='black', max=0; votes.forEach((v,k)=>{ if (v>max){ max=v; winner=k; } });
          resolve(winner);
        } catch{ resolve('black'); }
      };
      img.onerror=()=>resolve('black');
      img.src=src;
    });
  },
  async _recolorJRDots(article){
    try{
      const wrap = article.querySelector('.color-dots'); if (!wrap) return;
      const dots = Array.from(wrap.querySelectorAll('.color-dot'));
      if (!dots.length) return;
      const paletteOrder = ['black','columbiablue','darkgreen','green','maroon','navy','orange','purple','red','royal','yellow'];
      const map = new Map();
      // classify each image
      await Promise.all(dots.map(async dot=>{
        const src = dot.dataset.image; if (!src) return;
        const color = await this._classifyImageToPalette(src);
        if (!map.has(color)) map.set(color, src);
      }));
      const colorsFound = paletteOrder.filter(c=>map.has(c));
      // Only keep dots when we found 2+ distinct colors
      if (colorsFound.length < 2) {
        wrap.remove();
        return;
      }
      // build new dots in palette order
      const html = colorsFound.map((c,idx)=>{
        const cls = c; const src = map.get(c);
        return `<div class="color-dot ${cls} ${idx===0?'active':''}" data-color="${c}" data-image="${src}" role="button" tabindex="0" aria-label="Select ${c}"></div>`;
      }).join('');
      if (!html) return;
      wrap.innerHTML = html;
      const productImage = article.querySelector('.product-main-image');
      const firstDot = wrap.querySelector('.color-dot.active') || wrap.querySelector('.color-dot');
      if (firstDot && productImage) productImage.src = firstDot.dataset.image;
      // Rebind interactions
      wrap.querySelectorAll('.color-dot').forEach(dot=>{
        dot.addEventListener('click', (ev)=>{
          const colorDot = ev.currentTarget; const container = colorDot.closest('.color-dots');
          const card = colorDot.closest('article'); const img = card.querySelector('.product-main-image');
          container.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('active'));
          colorDot.classList.add('active'); if (img) img.src = colorDot.dataset.image;
        });
        dot.addEventListener('keydown', (ev)=>{ if (ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); ev.currentTarget.click(); } });
      });
    }catch{}
  },

  renderProducts(query = '') {
    if (!this.ui.grid) return;
    // Determine source list: homepage uses FEATURED (if non-empty), other pages full PRODUCTS
    const baseList = (function(){
      const page = (location.pathname.split('/').pop()||'').toLowerCase();
      if ((page === 'index.html' || page==='') && FEATURED.length) return FEATURED;
      return PRODUCTS;
    })();
    let list = baseList.filter(p =>
      (this.state.filter === 'all' || p.category === this.state.filter) &&
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    // Combine twisted rope SKUs into a single grouped card with variations
    try {
      const findById = (id) => list.find(p => p.id === id);
      const ropeFt = findById('5/16-TPLYSTER-xFT');
      const ropeSpool = findById('5/16-TPLYSTER-1270');
      if (ropeFt || ropeSpool) {
        // Remove individual entries from the list
        list = list.filter(p => p.id !== '5/16-TPLYSTER-xFT' && p.id !== '5/16-TPLYSTER-1270');
        // Build grouped product with desired MAP for FT ($1/ft) and Spool $230
        const grouped = {
          id: 'ROPE-516-POLY',
          title: '5/16" Poly Twisted Rope',
          category: (ropeFt?.category || ropeSpool?.category || 'accessories'),
          img: ropeSpool?.img || ropeFt?.img || 'assets/img/EZSportslogo.png',
          images: ropeSpool?.images?.length ? ropeSpool.images : (ropeFt?.images || []),
          description: (ropeFt?.description || ropeSpool?.description || 'Durable 5/16\" poly twisted rope, available by the foot or as a full 1270\' spool.'),
          features: Array.from(new Set([...(ropeFt?.features || []), ...(ropeSpool?.features || [])])).slice(0, 10),
          // Set a nominal price to keep indexing; card will override display
          price: 1,
          isTwistedRope: true,
          variations: [
            { id: '5/16-TPLYSTER-1270', title: "1270' Spool", price: 230 },
            { id: '5/16-TPLYSTER-xFT', title: 'By the Foot', map: 1.00, unit: '/ft' }
          ]
        };
        list.unshift(grouped);
      }
    } catch {}

    const html = list.map(p => {
      const desc = p.description ? p.description.slice(0, 140) + (p.description.length > 140 ? '…' : '') : '';
      const featPreview = (p.features && p.features.length) ? p.features.slice(0,3).map(f=>`<li>${f}</li>`).join('') : '';
      
      // Extract color variations for this product and randomly select an initial color
      const colors = this.extractProductColors(p);
      const initialColorIndex = colors.length > 1 ? Math.floor(Math.random() * colors.length) : -1;
      const initialImg = (initialColorIndex >= 0 && colors[initialColorIndex]?.image) ? colors[initialColorIndex].image : p.img;
      const colorDotsHtml = colors.length > 1 ? `
        <div class="color-dots" data-product-id="${p.id}">
          ${colors.map((color, index) => `
            <div class="color-dot ${color.class} ${index === initialColorIndex ? 'active' : ''}" 
                 data-color="${color.name}" 
                 data-image="${color.image}"
                 title="${(color.label ? `Image ${color.label}` : color.name.charAt(0).toUpperCase() + color.name.slice(1))}"
                 role="button" 
                 tabindex="0"
                 aria-label="Select ${(color.label ? `image ${color.label}` : color.name)}">
                 ${color.label ? `<span class="dot-label">${color.label}</span>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '';
      
      // Calculate price display (range if variations exist)
      let priceDisplay;
      if (p.isTwistedRope) {
        priceDisplay = 'Price may vary';
      } else if (p.priceRange) {
        // Use pre-formatted price range if available
        priceDisplay = p.priceRange;
      } else if (p.variations && p.variations.length > 1) {
        const prices = p.variations.map(v => v.map || v.price || 0).filter(price => price > 0);
        if (prices.length > 1) {
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          priceDisplay = minPrice === maxPrice ? 
            currency.format(minPrice) : 
            `${currency.format(minPrice)} - ${currency.format(maxPrice)}`;
        } else {
          priceDisplay = currency.format(prices[0] || p.price || 0);
        }
      } else {
        priceDisplay = currency.format(p.price || 0);
      }
      
      return `
      <article class="card ${p.category === 'netting' ? '' : ''}" data-product-id="${p.id}" ${p.stripe?.defaultPriceId ? `data-stripe-price="${p.stripe.defaultPriceId}"` : ''}>
        ${p.isTwistedRope ? `<a class="media" href="product.html?pid=rope-516-poly">` : `<div class="media no-link">`}
          <img src="${initialImg}" alt="${p.title}" loading="lazy" draggable="false" style="pointer-events:none;" onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=Image+Unavailable';" class="product-main-image"/>
        ${p.isTwistedRope ? `</a>` : `</div>`}
        <div class="body">
          <h3 class="h3-tight">${p.isTwistedRope ? `<a href="product.html?pid=rope-516-poly">${p.title}</a>` : p.title}</h3>
          ${desc ? `<p class=\"desc text-sm\">${desc}</p>` : ''}
          ${featPreview ? `<ul class=\"text-xs features-preview\">${featPreview}</ul>` : ''}
          ${colorDotsHtml}
          ${p.stock !== undefined ? `<p class=\"text-xs text-muted my-025\">Stock: ${p.stock}</p>` : ''}
          <div class="price-row">
            <span class="price">${priceDisplay}</span>
            <div class="actions">
              ${p.isTwistedRope
                ? `<a class="btn btn-ghost" href="product.html?pid=rope-516-poly" aria-label="View ${p.title}">View</a>`
                : `<a class="btn btn-ghost" href="product.html?pid=${encodeURIComponent(p.id)}" aria-label="View ${p.title}">View</a>`}
            </div>
          </div>
        </div>
      </article>`;
    }).join('');

    this.ui.grid.innerHTML = html || `<p>No products found.</p>`;

    // After render: dynamically recolor JR and Pitcher's Pocket Pro dots so colors match images
    try {
      this.ui.grid.querySelectorAll('article.card').forEach(card => {
        const title = (card.querySelector('h3')?.textContent||'').toLowerCase();
        const pid = card.getAttribute('data-product-id')||'';
        const pidish = String(pid || '').toLowerCase();
        const isReplacementNet = (/\breplacement\b/.test(title) && /\bnet\b/.test(title)) || /replacement\s*nets?\b/.test(title);
        const isNonScreenAccessory = /screen\s*padding|screen\s*component|screen\s*wheel|wheel\s*kit|leg\s*caps?\b/.test(title);
        const isScreenBulletz = /screen\s*bulletz/.test(title);
        const looksLikeJR = /bullet\s*l\s*screen\s*jr/.test(title) || /bulletjrbb/.test(pidish);
        // Pitcher's Pocket Pro detection: title mentions Pitcher's Pocket and Pro, or id/sku looks like BBPP-PRO or PPPRO
        const looksLikePocketPro = /pitcher'?s\s*pocket.*\bpro\b/i.test(title) || /bbpp[-_]?pro/.test(pidish) || /pppro/.test(pidish);
        const looksLikeLScreen = /\bl\s*-?\s*screen\b/.test(title) || /\blscreen\b/.test(title);
        const looksLikeProtectiveScreen = /\bprotective\s*screen\b/.test(title);
        const looksLikePitchersPocket = /pitcher'?s\s*pocket\b/.test(title) || /\bpitchers\s*pocket\b/.test(title);
        const looksLikeAnyScreen = (/(^|\b)screen(\b|$)/.test(title) || /\bfront\s*toss\b/.test(title) || /\bfast\s*pitch\b/.test(title))
          && !isReplacementNet
          && !isNonScreenAccessory
          && !isScreenBulletz;
        if (looksLikeJR || looksLikePocketPro || looksLikeAnyScreen || looksLikeLScreen || looksLikeProtectiveScreen || looksLikePitchersPocket) {
          const wrap = card.querySelector('.color-dots');
          const hasNeutral = !!wrap?.querySelector('.color-dot.neutral');
          if (hasNeutral) this._recolorJRDots(card);
        }
      });
    } catch {}

    // Analytics: product impression (batched)
    try {
      if (window.trackEvent && list.length) {
        window.trackEvent('view_item_list', list.map(p => ({ id: p.id, price: p.price, stripePrice: p.stripe?.defaultPriceId })));
      }
    } catch {}

    // Inject/update JSON-LD ItemList for SEO based on currently rendered products
    try {
      const head = document.head;
      const existing = document.getElementById('jsonld-itemlist');
      if (existing) existing.remove();
      if (list.length > 0) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'jsonld-itemlist';
        const itemListElement = list.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Product',
            name: p.title,
            sku: p.id,
            category: p.category,
            image: (p.img ? new URL(p.img, location.href).href : undefined),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'USD',
              price: String(p.price ?? ''),
              availability: 'https://schema.org/InStock'
            }
          }
        }));
        script.text = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement });
        head.appendChild(script);
      }
    } catch {}

    // Bind add buttons
    this.ui.grid.querySelectorAll('[data-add]:not([disabled])').forEach(btn => btn.addEventListener('click', (ev) => {
      const id = btn.dataset.add;
      const product = PRODUCTS.find(p => p.id === id);
      const card = ev.target.closest('article');
      // Get selected color and current image
      const activeColorDot = card?.querySelector('.color-dot.active');
      const selectedColor = activeColorDot ? activeColorDot.dataset.color : undefined;
      const imgEl = card?.querySelector('.product-main-image');
      const currentImg = imgEl?.getAttribute('src');
      const opts = { color: selectedColor };
      if (product && currentImg) product.img = currentImg;
      this.add(product, opts);
      try { window.trackEvent && window.trackEvent('add_to_cart', { id: product.id, price: product.price, stripePrice: product.stripe?.defaultPriceId, color: selectedColor }); } catch {}
    }));

    // Bind detail buttons
    this.ui.grid.querySelectorAll('[data-detail]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.detail;
      const product = PRODUCTS.find(p => p.id === id);
      if (!product) return;
      this.openProductDetail(product);
    }));

    // Bind color dot interactions
    this.ui.grid.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', (ev) => {
        const colorDot = ev.currentTarget;
        const colorDotsContainer = colorDot.closest('.color-dots');
        const card = colorDot.closest('article');
        const productImage = card.querySelector('.product-main-image');
        const newImageSrc = colorDot.dataset.image;
        
        // Update active state
        colorDotsContainer.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        colorDot.classList.add('active');
        
        // Update product image
        if (productImage && newImageSrc) {
          productImage.src = newImageSrc;
        }
      });

      // Keyboard support
      dot.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.currentTarget.click();
        }
      });
    });

    // Record lightweight view_item events (on initial render for visible items only)
    try {
      const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            const id = en.target.getAttribute('data-product-id');
            if (id) window.trackEvent && window.trackEvent('view_item', { id });
            obs.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px 200px 0px', threshold: 0.25 });
      this.ui.grid.querySelectorAll('article[data-product-id]').forEach(card => observer.observe(card));
    } catch {}
  },

  openProductDetail(product) {
    let dlg = document.getElementById('product-detail');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'product-detail';
      dlg.className = 'product-detail-dialog';
      document.body.appendChild(dlg);
    }
    // Build a clean image list: drop empty, duplicate, or placeholder/removed tokens
    let images = Array.isArray(product.images) ? product.images.slice() : [];
    const isValidImg = (src) => {
      if (!src || typeof src !== 'string') return false;
      const s = src.trim(); if (!s) return false;
      const lower = s.toLowerCase();
      // Filter obvious placeholder markers
      if (['removed','placeholder','n/a','na','null'].includes(lower)) return false;
      if (lower.includes('placeholder') || lower.includes('noimage') || lower.includes('coming-soon')) return false;
      // Must look like an image path or URL with a typical extension
      if (!/[.](png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(lower)) return false;
      return true;
    };
    images = images.filter(isValidImg);
    // Ensure primary product.img is first if valid and not already present
    if (isValidImg(product.img)) {
      images = images.filter(i => i !== product.img);
      images.unshift(product.img);
    }
    // De-dupe while preserving order
    const seenImgs = new Set();
    images = images.filter(src => (seenImgs.has(src) ? false : (seenImgs.add(src), true)));
    if (!images.length && isValidImg(product.img)) images = [product.img];
    if (!images.length) images = [ 'https://placehold.co/800x600?text=Image+Unavailable' ];
    const thumbs = images.map((src,i)=>`<button class="thumb" data-thumb-index="${i}" aria-label="View image ${i+1}"><img src="${src}" alt="${product.title} thumbnail ${i+1}" onerror="this.closest('button')?.remove()"/></button>`).join('');
    // Feature key:value formatting
    let featureList = '';
    if (product.features && product.features.length) {
      const items = product.features.map(f => {
        const parts = f.split(':');
        if (parts.length > 1 && parts[0].length < 60) {
          const key = parts.shift().trim();
          const val = parts.join(':').trim();
          return `<li><strong>${key}:</strong> ${val}</li>`;
        }
        return `<li>${f}</li>`;
      }).join('');
      featureList = `<h4>Features</h4><ul class="feature-list">${items}</ul>`;
    }
    const descHtml = `<h4>Description</h4>` + (product.description ? `<p class="full-desc">${product.description}</p>` : `<p class="full-desc muted">Description coming soon.</p>`);
    // Twisted rope special handling: expose a simple dropdown for Spool vs By the Foot
    const isRope = !!product.isTwistedRope || /5\/16\"\s*poly\s*twisted\s*rope/i.test(product.title||'');
    let ropeControls = '';
    if (isRope) {
      const spool = { id: '5/16-TPLYSTER-1270', title: "1270' Spool", price: 230 };
      const perFt = { id: '5/16-TPLYSTER-xFT', title: 'By the Foot', price: 1, unit: '/ft' };
      ropeControls = `
        <div class="stack-05">
          <label for="rope-option" class="text-sm">Choose Option</label>
          <select id="rope-option">
            <option value="${spool.id}" data-price="${spool.price}">${spool.title} — ${currency.format(spool.price)}</option>
            <option value="${perFt.id}" data-price="${perFt.price}">${perFt.title} — $${perFt.price}/${perFt.unit.replace('/','')}</option>
          </select>
          <div class="text-xs muted">For By the Foot, quantity equals feet.</div>
        </div>`;
    }

    dlg.innerHTML = `
      <form method="dialog" class="dlg-backdrop" onclick="this.closest('dialog').close()"></form>
      <section class="panel" role="document">
        <header class="panel-head">
          <h3>${product.title}</h3>
          <button class="icon-btn" value="close" aria-label="Close">✕</button>
        </header>
        <div class="panel-body product-detail-layout">
          <div class="gallery">
            <div class="main-image"><img id="pd-main-img" src="${images[0]}" alt="${product.title}" onerror="this.onerror=null;this.src='https://placehold.co/800x600?text=Image+Unavailable';"/></div>
            ${images.length > 1 ? `<div class="thumbs" role="list">${thumbs}</div>` : ''}
          </div>
          <div class="info">
            <p class="price-lg">${isRope ? 'Price may vary' : currency.format(product.price)}</p>
            ${isRope ? ropeControls : ''}
            ${featureList}
            ${descHtml}
          </div>
        </div>
        <footer class="panel-foot">
          <div class="row gap-06">
            <button class="btn btn-primary" data-add-detail="${product.id}">${isRope ? 'Add Selected' : 'Add to Cart'}</button>
            <button class="btn btn-ghost" value="close">Back</button>
          </div>
        </footer>
      </section>`;
    dlg.showModal();
    // Thumbnail click swapping
    dlg.querySelectorAll('.thumb').forEach(btn => btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const idx = Number(btn.getAttribute('data-thumb-index')) || 0;
      const main = dlg.querySelector('#pd-main-img');
      if (main && images[idx]) main.src = images[idx];
      dlg.querySelectorAll('.thumb').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
    }));
    // Add-to-cart inside dialog
    dlg.querySelector('[data-add-detail]')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (isRope) {
        const sel = dlg.querySelector('#rope-option');
        const chosenId = sel?.value || '5/16-TPLYSTER-1270';
        const chosenPrice = Number(sel?.selectedOptions?.[0]?.getAttribute('data-price') || 0) || 0;
        const chosenTitle = sel?.selectedOptions?.[0]?.textContent || product.title;
        const line = {
          id: chosenId,
          qty: 1,
          title: chosenTitle,
          price: chosenPrice,
          img: product.img,
          category: product.category
        };
        // For per-foot option, we treat quantity as feet; default to 1 foot; user can edit qty in cart
        if (chosenId === '5/16-TPLYSTER-xFT') {
          line.title = '5/16" Poly Twisted Rope — By the Foot';
          line.price = 1; // $1/ft
        } else {
          line.title = '5/16" Poly Twisted Rope — 1270\' Spool';
          line.price = 230;
        }
        // Push directly into cart state to preserve exact price per selection
        this.state.cart.push(line);
        this.persist();
        this.renderCart();
        this.openCart();
        try { window.trackEvent && window.trackEvent('add_to_cart', { id: line.id, price: line.price, qty: line.qty }); } catch {}
      } else {
        this.add(product, {});
        try { window.trackEvent && window.trackEvent('add_to_cart', { id: product.id, price: product.price }); } catch {}
      }
    }, { once: true });
    // Explicit close wiring (buttons with value="close" do not auto-close because they are outside the form element containing method="dialog")
    dlg.querySelectorAll('button[value="close"], [data-close-detail]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        try { dlg.close(); } catch {}
      });
    });
    // Keyboard fallback (some browsers polyfill dialog)
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { try { dlg.close(); } catch {} } });
  },

  add(product, opts = {}) {
    const candidate = { id: product.id, size: opts.size, color: opts.color };
    const key = this.keyFor(candidate);
    const exists = this.state.cart.find(i => this.keyFor(i) === key);
    if (exists) {
      exists.qty += 1;
      // If this line predates weight support, fill it in when provided
      if (!Number.isFinite(Number(exists.weightLbsEach)) && Number.isFinite(Number(opts.weightLbsEach))) {
        exists.weightLbsEach = Number(opts.weightLbsEach);
      }
    } else {
      // Store a snapshot for items that may not exist in PRODUCTS (e.g., dynamic pages like gloves)
      let imgSrc = product.img;
      try { if (imgSrc) imgSrc = new URL(imgSrc, location.href).href; } catch {}
      // Determine shipping (DSR) for this line: prefer explicit opts.ship; else product.dsr; default $100 per item when absent or invalid
      // Free shipping override for Batting Mat and Armor Basket
      const lid = String(product.id || '').toLowerCase();
      const lt = String(product.title || '').toLowerCase();
      const freeShipOverride = (lid === 'battingmat' || lid === 'armorbasket') || (/\bbatting\s*mat\b/.test(lt)) || (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(lt));
      const rawShip = freeShipOverride ? 0 : ((opts && Object.prototype.hasOwnProperty.call(opts, 'ship')) ? opts.ship
        : (Object.prototype.hasOwnProperty.call(product, 'dsr') ? product.dsr : undefined));
      const shipAmount = (() => {
        const n = Number(rawShip);
        // Respect zero as an explicit free shipping flag
        if (Number.isFinite(n)) {
          if (n === 0) return 0;
          if (n > 0) return n;
        }
        return 100; // default $100 when no dsr
      })();
      const weightLbsEach = (() => {
        const raw = (opts && Object.prototype.hasOwnProperty.call(opts, 'weightLbsEach')) ? opts.weightLbsEach
          : (Object.prototype.hasOwnProperty.call(product, 'weightLbsEach') ? product.weightLbsEach : undefined);
        const n = Number(raw);
        return (Number.isFinite(n) && n > 0) ? n : undefined;
      })();
      this.state.cart.push({
        id: product.id,
        qty: 1,
        size: opts.size,
        color: opts.color,
        title: product.title || product.name,
        price: typeof product.price === 'number' ? product.price : Number(product.price) || 0,
        img: imgSrc || 'assets/img/EZSportslogo.png',
        category: product.category,
        ship: rawShip, // preserve original value (could be string)
        shipAmount, // numeric amount used in totals
        weightLbsEach
      });
    }
    this.persist();
    this.renderCart();
    this.openCart();
  // Track add_to_cart event if analytics is present
  try { window.trackEvent && window.trackEvent('add_to_cart', product.id); } catch {}
  },

  removeByKey(key) {
    this.state.cart = this.state.cart.filter(i => this.keyFor(i) !== key);
    this.persist();
    this.renderCart();
  },

  persist() {
    localStorage.setItem('cart', JSON.stringify(this.state.cart));
  },

  get cartDetailed() {
    return this.state.cart.map(i => {
      const found = PRODUCTS.find(p => p.id === i.id);
      const fallback = {
        id: i.id,
        title: i.title || 'Item',
        price: typeof i.price === 'number' ? i.price : Number(i.price) || 0,
  img: i.img || 'assets/img/EZSportslogo.png',
        category: i.category || 'misc'
      };
      const base = found || fallback;
      // Prefer line-item price (e.g., selected option/variation) when provided
      const effectivePrice = (typeof i.price === 'number' && isFinite(i.price) && i.price > 0)
        ? i.price
        : (typeof base.price === 'number' ? base.price : 0);
      const product = { ...base, price: effectivePrice };
      // Prefer the specific image chosen on the line item (selected color) over catalog image
      if (i.img) product.img = i.img;
      return { ...i, product };
    });
  },

  get subtotal() {
    return this.cartDetailed.reduce((sum, i) => sum + ((i.product?.price || 0) * i.qty), 0);
  },

  // Total shipping from per-line shipAmount values (dsr) × qty
  get shippingTotal() {
    try {
      return this.state.cart.reduce((sum, i) => {
        const raw = Number(i.shipAmount);
        let perItem = 100; // default when missing/invalid
        if (Number.isFinite(raw)) {
          if (raw === 0) perItem = 0; // explicit free shipping
          else if (raw > 0) perItem = raw; // valid per-item dsr
          // else keep default 100
        }
        const qty = Math.max(1, Number(i.qty) || 1);
        return sum + (perItem * qty);
      }, 0);
    } catch { return 0; }
  },

  // Combined total: items + shipping (dsr)
  get total() {
    return (this.subtotal || 0) + (this.shippingTotal || 0);
  },

  renderCart() {
    const rows = this.cartDetailed.map(i => {
      const key = this.keyFor(i);
      // For netting items, relabel second attribute as Spec instead of Color
      const isNetting = (String(i.category||'').toLowerCase()==='netting') || (String(i.id||'').toLowerCase().startsWith('custom-net-'));
      const variant = `${(i.size || '').trim() ? `Size: ${i.size} ` : ''}${(i.color || '').trim() ? `${isNetting ? 'Spec' : 'Color'}: ${i.color}` : ''}`.trim();
      // Enforce default image for netting when missing
  const img = (isNetting && !(i.product?.img)) ? 'assets/img/netting3.jpg' : (i.product?.img || 'assets/img/EZSportslogo.png');
      const title = i.product?.title || 'Item';
      const price = typeof i.product?.price === 'number' ? i.product.price : 0;
  const shipPer = (()=>{ const n = Number(i.shipAmount); if (Number.isFinite(n)) { if (n===0) return 0; if (n>0) return n; } return 100; })();
      return `
      <div class="cart-row">
        <img src="${img}" alt="${title}" width="64" height="64" class="rounded-xs object-cover"/>
        <div>
          <strong>${title}</strong>
          ${variant ? `<div class=\"text-sm text-muted\">${variant}</div>` : ''}
          <div class="text-xs muted">SKU: ${i.id}</div>
          <div class="opacity-80">Qty: <button type="button" class="icon-btn" data-dec="${key}">−</button> ${i.qty} <button type="button" class="icon-btn" data-inc="${key}">+</button></div>
          <div class="text-sm muted">Shipping: ${shipPer===0 ? 'Free' : currency.format(shipPer)} × ${i.qty}</div>
        </div>
        <div class="text-right">
          <div>${currency.format(price * i.qty)}</div>
          <button type="button" class="btn btn-ghost" data-remove="${key}">Remove</button>
        </div>
      </div>
    `;
    }).join('');

    if (this.ui.items) this.ui.items.innerHTML = rows || '<p>Your cart is empty.</p>';
    if (this.ui.count) this.ui.count.textContent = String(this.state.cart.reduce((s, i) => s + i.qty, 0));
  // Ensure totals breakdown in mini-cart footer: Subtotal (items), Shipping, Total
  try {
    const footer = this.ui.subtotal ? this.ui.subtotal.closest('.totals')?.parentElement : null;
    const parent = this.ui.subtotal ? this.ui.subtotal.closest('.totals') : null;
    const ensureRow = (id, label) => {
      let el = document.getElementById(id);
      if (!el && parent) {
        const row = document.createElement('div');
        row.className = 'totals';
        row.innerHTML = `<span>${label}</span><strong id="${id}">$0.00</strong>`;
        parent.insertAdjacentElement('afterend', row);
        el = row.querySelector('strong');
      }
      return el || document.getElementById(id);
    };
    if (this.ui.subtotal) this.ui.subtotal.textContent = currency.format(this.subtotal);
  const shipEl = ensureRow('cart-shipping', 'Shipping');
  if (shipEl) shipEl.textContent = (this.shippingTotal === 0) ? 'Free' : currency.format(this.shippingTotal);
    const totalEl = ensureRow('cart-total', 'Total');
    if (totalEl) totalEl.textContent = currency.format(this.total);
  } catch {}
    if (this.state.cart.length) {
      try { window.trackEvent && window.trackEvent('view_cart', { items: this.state.cart.map(i => ({ id: i.id, price: i.price, qty: i.qty })) }); } catch {}
    }

    // Bind buttons if delegation wasn't set (legacy fallback)
    if (this.ui.items && !this.ui.items.__delegated) {
      this.ui.items.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => this.removeByKey(b.dataset.remove)));
      this.ui.items.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.inc); if (!it) return; it.qty++; this.persist(); this.renderCart(); }));
      this.ui.items.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.dec); if (!it) return; it.qty = Math.max(0, it.qty - 1); if (it.qty === 0) this.removeByKey(this.keyFor(it)); else { this.persist(); this.renderCart(); } }));
    }
  },

  toggleCart() {
    if (!this.ui.dialog) return;
    const dlg = this.ui.dialog;
    // Standard modal <dialog>
    if (typeof dlg.showModal === 'function') {
      dlg.open ? dlg.close() : dlg.showModal();
      return;
    }
    // Non-dialog container fallback (e.g., floating cart panel)
    try { dlg.classList.toggle('is-open'); } catch {}
  },

  openCart() {
    if (!this.ui.dialog) return;
    const dlg = this.ui.dialog;
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
      return;
    }
    try { dlg.classList.add('is-open'); } catch {}
  },

  checkout() {
    try {
      const cents = Math.round(this.total * 100); // include shipping in checkout amount snapshot
      localStorage.setItem('checkoutTotalCents', String(cents));
      // persist cart for the checkout page
      this.persist();
      try { window.trackEvent && window.trackEvent('begin_checkout', { items: this.state.cart.map(i => ({ id: i.id, price: i.price, qty: i.qty })) }); } catch {}
      window.location.href = 'checkout.html';
    } catch (e) {
      alert('Unable to proceed to checkout.');
      console.error(e);
    }
  },

  // Call this after successful order placement (Stripe + server order saved)
  completePurchase(order) {
    try {
      window.trackEvent && window.trackEvent('purchase', {
        orderId: order?.id,
        items: (order?.items || []).map(i => ({ id: i.id, price: i.price, qty: i.qty })),
        value: (order?.items || []).reduce((s,i)=> s + (i.price * i.qty), 0)
      });
    } catch {}
  }
};

// Fallback responsive enforcement if cached old CSS briefly loads
Store.enforceResponsiveBehaviors = function(){
  try {
    const apply = () => {
      const w = window.innerWidth;
      const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
      const toggle = document.querySelector('.menu-toggle');
      if (w <= 1200) {
        if (toggle) toggle.style.display = 'inline-flex';
        if (nav && !nav.classList.contains('is-open')) {
          // Keep it collapsed until explicitly opened
          nav.classList.remove('forced-wide');
        }
      } else {
        if (toggle) toggle.style.display = '';
        if (nav) nav.classList.add('forced-wide');
      }
      // Calculator adaptive safeguard
      // Calculator now mobile-first (single column by default); JS stack enforcement no longer required.
    };
    window.addEventListener('resize', apply);
    apply();
  } catch {}
};

window.Store = Store;
window.addEventListener('DOMContentLoaded', () => Store.init());
