// Admin panel functionality
let currentEditingProduct = null;
const API_BASES = (() => {
  const isHttp = location.protocol.startsWith('http');
  const isLiveServer = isHttp && location.port === '5500';
  // For normal hosting (backend-served pages, Replit, etc.), use same-origin first.
  // For Live Server (5500), do NOT try same-origin because /api/* doesn't exist there.
  const bases = isLiveServer ? [] : [''];
  try { if (window.__API_BASE) bases.unshift(String(window.__API_BASE).replace(/\/$/, '')); } catch {}
  try {
    const meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) bases.push(String(meta.content).trim().replace(/\/$/, ''));
  } catch {}
  if (location.port === '5500') {
    // Live Server development
    // Prefer higher ports first because the backend auto-increments when 4242 is in use.
    bases.push(
      'http://localhost:4247', 'http://127.0.0.1:4247',
      'http://localhost:4246', 'http://127.0.0.1:4246',
      'http://localhost:4245', 'http://127.0.0.1:4245',
      'http://localhost:4244', 'http://127.0.0.1:4244',
      'http://localhost:4243', 'http://127.0.0.1:4243',
      'http://localhost:4242', 'http://127.0.0.1:4242'
    );
  }
  return Array.from(new Set(bases));
})();

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem('authToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

async function fetchAdmin(path, options = {}) {
  let lastErr;
  for (const base of API_BASES) {
    try {
  const res = await fetch(`${base}${path}`, { credentials:'include', ...options, headers: { ...(options.headers||{}), ...authHeaders() } });
  if (res.ok) { window.__API_BASE = base; return res; }
      lastErr = res;
    } catch (e) { lastErr = e; }
  }
  if (lastErr instanceof Response) return lastErr;
  throw lastErr || new Error('Network error');
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

// Products list (Admin) must come exclusively from assets/prodList.json
let __prodListProducts = [];
function __slug(str) {
  return (str||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function __pickPrice(obj) {
  // Prefer MAP, then explicit price, then details.price, then wholesale
  const from = (v) => (typeof v === 'number' ? v : (v && !isNaN(Number(v)) ? Number(v) : undefined));
  return (
    from(obj?.map) ??
    from(obj?.price) ??
    from(obj?.details?.price) ??
    from(obj?.wholesale)
  ) || 0;
}
async function loadProductsFromProdList(force=false) {
  if (!force && __prodListProducts.length) return __prodListProducts;
  try {
    const res = await fetch('assets/prodList.json', { credentials:'same-origin' });
    if (!res.ok) throw new Error('Failed to load prodList.json');
    const data = await res.json();
    const out = [];
    const categories = data && data.categories ? data.categories : {};
    for (const [catName, items] of Object.entries(categories)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const base = {
          sku: item.sku || '',
          name: item.name || item.sku || 'Product',
          image: item.img || (Array.isArray(item.images) ? item.images[0] : '') || '',
          category: catName,
          description: (item.details && item.details.description) || '',
          isActive: true,
          source: 'prodList'
        };
        if (Array.isArray(item.variations) && item.variations.length) {
          for (const v of item.variations) {
            const id = (item.sku ? `${item.sku}-${__slug(v.option||'opt')}` : `${__slug(base.name)}-${__slug(v.option||'opt')}`);
            out.push({
              id,
              ...base,
              name: `${base.name} (${v.option})`,
              price: __pickPrice(v)
            });
          }
        } else {
          const id = item.sku || __slug(base.name) || ('prod-' + Date.now());
          out.push({
            id,
            ...base,
            price: __pickPrice(item)
          });
        }
      }
    }
    __prodListProducts = out;
  } catch (e) {
    console.error('Failed to load prodList.json', e);
    __prodListProducts = [];
  }
  return __prodListProducts;
}

// Legacy helpers retained for other admin features, but products list will not use them
let __adminProductsCache = [];
async function loadProductsFromServer() { return []; }
function getProducts() { return __prodListProducts.slice(); }
function saveProducts(_) { /* no-op for prod list enforcement */ }
function updateShopProducts(_) { /* no-op for prod list enforcement */ }

function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch {
    return [];
  }
}

// Users will be loaded from the server for admins

function generateId() {
  return 'prod-' + Date.now();
}

function showSection(section, btn) {
  // Hide all sections (use class since .hidden has !important and overrides inline styles)
  const sections = document.querySelectorAll('.admin-section');
  sections.forEach(s => s.classList.add('hidden'));
  // Update tab active state
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.remove('active'));

  // Show selected section and mark active tab
  const el = document.getElementById(section + '-section');
  if (el) el.classList.remove('hidden');
  if (btn) btn.classList.add('active');

  // Load data for section
  if (section === 'products') renderProducts();
  if (section === 'netting') renderNetting();
  if (section === 'orders') renderOrders();
  if (section === 'users') renderUsers();
  if (section === 'marketing') renderMarketing();
  if (section === 'invoices') renderInvoices();
  if (section === 'finance') renderFinance();
  if (section === 'traffic') renderTraffic();
  if (section === 'diag') renderDiagnostics();
}

async function renderProducts() {
  if (!__prodListProducts.length) { await loadProductsFromProdList(); }
  const products = getProducts();
  const list = document.getElementById('products-list');

  if (!products.length) {
    list.innerHTML = '<p>No products yet. Add your first product above.</p>';
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="product-item">
      <div>
        <strong>${p.name}</strong> - $${Number(p.price||0).toFixed(2)}
        <br><small>${p.category}${p.sku?` | SKU: ${p.sku}`:''}</small>
      </div>
      <div>
        <!-- Admin Products list is read-only and reflects assets/prodList.json -->
      </div>
    </div>
  `).join('');
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  const status = document.getElementById('orders-status-filter')?.value || '';
  list.innerHTML = '<p>Loading orders…</p>';

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', window.__ordersPage||1);
  params.set('pageSize', 10);
  params.set('sortBy', 'createdAt');
  params.set('sortDir', 'desc');
  fetchAdmin(`/api/orders/admin/all?${params.toString()}`)
    .then(async res=>{
      if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        throw new Error(txt || 'Unauthorized or failed');
      }
      return res.json();
    })
    .then(result => {
      console.log('Loaded orders:', result); // Debug logging
      const { items:orders, total, page, pageSize } = Array.isArray(result) ? { items:result, total:result.length, page:1, pageSize:result.length } : result;
      if (!orders || !orders.length) {
        list.innerHTML = '<p>No orders found.</p>';
        return;
      }
      const html = orders.map(order => {
        const fmtLbs = (n) => {
          const v = Number(n);
          return (Number.isFinite(v) && v > 0) ? `${(Math.round(v * 10) / 10).toFixed(1)} lbs` : null;
        };
        const weightFromOrder = fmtLbs(order.weightLbsTotal ?? order.totalWeightLbs ?? order.weightTotal ?? order.totalWeight);
        const weightFromItems = (() => {
          const items = Array.isArray(order.items) ? order.items : [];
          let sum = 0;
          for (const it of items) {
            const qty = Math.max(1, Number(it.quantity ?? it.qty) || 1);
            const wTotal = Number(it.weightLbsTotal ?? it.weightTotal ?? it.weightLbs);
            const wEach = Number(it.weightLbsEach ?? it.weightEach ?? it.weight);
            if (Number.isFinite(wTotal) && wTotal > 0) sum += wTotal;
            else if (Number.isFinite(wEach) && wEach > 0) sum += (wEach * qty);
          }
          return fmtLbs(sum);
        })();
        const weightLabel = weightFromOrder || weightFromItems;

        return `
          <div class="product-item">
            <div>
              <strong>Order #${order.id}</strong> — <small>${order.status||'pending'}</small>
              <br><small>${new Date(order.createdAt||order.date).toLocaleString()}</small>
              <br>Items: ${order.items.map(i => `${(i.quantity||i.qty)}x ${i.productId||i.id}`).join(', ')}
              ${weightLabel ? `<br><small>Weight: ${weightLabel}</small>` : ''}
              ${order.paymentInfo && (order.paymentInfo.fees!=null || order.paymentInfo.net!=null) ? `<br><small>Fees: $${Number(order.paymentInfo.fees||0).toFixed(2)} • Net: $${Number(order.paymentInfo.net||0).toFixed(2)}</small>` : ''}
            </div>
            <div class="flex-row gap-05 items-center">
              <strong>$${(order.total||0).toFixed(2)}</strong>
              <a class="btn btn-ghost" href="${(window.__API_BASE||'')}/api/invoices/INV-${order.id}/print" target="_blank" rel="noopener">View Invoice</a>
              ${order.customerInfo?.email ? `<button class="btn btn-ghost" data-portal="${order.customerInfo.email}">Billing Portal</button>` : ''}
              <select data-order-id="${order.id}" class="order-status-select">
                ${['pending','paid','fulfilled','cancelled'].map(s=>`<option value="${s}" ${s===(order.status||'pending')?'selected':''}>${s}</option>`).join('')}
              </select>
              <button class="btn btn-ghost" data-update-status="${order.id}">Update</button>
            </div>
          </div>
        `;
      }).join('');

      const pager = `
        <div class="flex-row gap-1 items-center mt-1">
          <button class="btn btn-ghost" id="orders-prev" ${page<=1?'disabled':''}>Prev</button>
          <span>Page ${page} of ${Math.max(1, Math.ceil(total/(pageSize||1)))} (${total} total)</span>
          <button class="btn btn-ghost" id="orders-next" ${(page*pageSize)>=total?'disabled':''}>Next</button>
        </div>`;

      list.innerHTML = html + pager;

      // Wire billing portal buttons
      list.querySelectorAll('[data-portal]').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.getAttribute('data-portal');
          if (email) openBillingPortal(email);
        });
      });
      // Wire updates
      list.querySelectorAll('[data-update-status]')
        .forEach(btn => btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-update-status');
          const sel = list.querySelector(`select[data-order-id="${id}"]`);
          const newStatus = sel.value;
          fetchAdmin(`/api/orders/${id}/status`, { method:'PATCH', body: JSON.stringify({ status:newStatus }) })
            .then(r=>{ if(!r.ok) throw new Error('Failed'); return r.json(); })
            .then(()=>{ renderOrders(); })
            .catch(()=> alert('Failed to update status. Ensure you are logged in as admin.'));
        }));

      const prev = document.getElementById('orders-prev');
      const next = document.getElementById('orders-next');
      if (prev) prev.addEventListener('click', ()=>{ window.__ordersPage = Math.max(1,(page-1)); renderOrders(); });
      if (next) next.addEventListener('click', ()=>{ window.__ordersPage = (page+1); renderOrders(); });
    })
    .catch((e)=>{
      list.innerHTML = `<p>Failed to load orders. ${e.message||''}</p>`;
    });
}

// Diagnostics: fetch and render readiness info
async function renderDiagnostics(){
  const wrap = document.getElementById('diag-wrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await fetchAdmin('/api/admin/diagnostics');
    if (!res.ok) throw new Error(await res.text().catch(()=> 'Failed to load diagnostics'));
    const d = await res.json();
    const rows = [];
    const y = (v)=> v ? 'Yes' : 'No';
    rows.push(`<div class="product-item"><div><strong>Server time</strong><br><small>${new Date(d.now).toLocaleString()}</small></div><div>Uptime: ${Number(d.uptimeSec||0)}s</div></div>`);
    if (d.integrations) {
      rows.push(`<div class="product-item"><div><strong>Stripe</strong></div><div>${y(d.integrations.stripe?.configured)}${!d.integrations.stripe?.configured? ' (secret missing)': ''}</div></div>`);
      rows.push(`<div class="product-item"><div><small>Publishable key</small></div><div>${y(d.integrations.stripe?.publishableSet)}</div></div>`);
      rows.push(`<div class="product-item"><div><small>Webhook secret</small></div><div>${y(d.integrations.stripe?.webhookSecretSet)}</div></div>`);
      rows.push(`<div class="product-item"><div><strong>Cloudflare</strong></div><div>${y(d.integrations.cloudflare?.configured)}</div></div>`);
    }
    if (d.auth) {
      rows.push(`<div class="product-item"><div><strong>JWT secret set</strong></div><div>${y(d.auth.jwtSet)}</div></div>`);
      rows.push(`<div class="product-item"><div><small>Cookie domain</small></div><div>${d.auth.cookieDomain || '—'}</div></div>`);
    }
    if (d.cors) {
      const origins = Array.isArray(d.cors.origins) && d.cors.origins.length ? d.cors.origins.join(', ') : '—';
      rows.push(`<div class="product-item"><div><strong>CORS origins</strong></div><div>${origins}</div></div>`);
    }
    if (d.storage) {
      rows.push(`<div class="product-item"><div><strong>DB counts</strong></div><div>orders: ${d.storage.ordersCount ?? '—'} • analytics: ${d.storage.analyticsCount ?? '—'} • coupons: ${d.storage.couponsCount ?? '—'} • subscribers: ${d.storage.subscribersCount ?? '—'} • emails: ${d.storage.emailsCount ?? '—'} • payouts: ${d.storage.payoutsCount ?? '—'} • errors: ${d.storage.errorsCount ?? '—'}</div></div>`);
    }
    if (d.analytics) {
      rows.push(`<div class="product-item"><div><strong>Traffic (7d)</strong></div><div>Pageviews: ${d.analytics.totalPageviews ?? 0} • Visitors: ${d.analytics.uniqueVisitors ?? 0}</div></div>`);
    }
    if (d.errors) {
      rows.push(`<div class="product-item"><div><strong>Error split (7d)</strong></div><div>Actionable: ${d.errors.actionableCount ?? 0} • Known noise: ${d.errors.knownNoiseCount ?? 0} • Total: ${d.errors.total ?? 0}</div></div>`);
      const topNoise = Array.isArray(d.errors.byClassification)
        ? d.errors.byClassification.filter(item => !item.actionable).map(item => `${item.label}: ${item.count}`).join(' • ')
        : '';
      if (topNoise) rows.push(`<div class="product-item"><div><small>Known noise buckets</small></div><div>${topNoise}</div></div>`);
      const topActionable = Array.isArray(d.errors.topActionableMessages)
        ? d.errors.topActionableMessages.map(item => `${item.message} (${item.count})`).join(' • ')
        : '';
      if (topActionable) rows.push(`<div class="product-item"><div><small>Top actionable errors</small></div><div>${topActionable}</div></div>`);
    }
    if (wrap) wrap.innerHTML = rows.join('');
  } catch (e) {
    if (wrap) wrap.innerHTML = `<p class="muted error-text">${e.message || 'Failed to load diagnostics'}</p>`;
  }
}

function renderUsers() {
  const list = document.getElementById('users-list');
  list.innerHTML = '<p>Loading users…</p>';
  fetchAdmin(`/api/users/admin/all`)
    .then(async res=>{ if(!res.ok){ const txt=await res.text().catch(()=> ''); throw new Error(txt||'Unauthorized or failed'); } return res.json(); })
    .then(users => {
      console.log('Loaded users:', users); // Debug logging
      if (!users || !users.length) { list.innerHTML = '<p>No users found.</p>'; return; }
      list.innerHTML = users.map(user => `
        <div class="product-item">
          <div>
            <strong>${user.name || user.username || user.email}</strong> (${user.email})
            <br><small>${user.isAdmin ? 'Admin' : 'Customer'}</small>
          </div>
          <div>
            <small>ID: ${user.id}</small>
            <button class="btn btn-ghost" data-user-portal="${user.email}">Billing Portal</button>
          </div>
        </div>
      `).join('');
      list.querySelectorAll('[data-user-portal]').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.getAttribute('data-user-portal');
          if (email) openBillingPortal(email);
        });
      });
    })
  .catch((e)=>{ list.innerHTML = `<p>Failed to load users. ${e.message||''}</p>`; });
}

function addProduct(productData) {
  // Try backend first
  (async () => {
    try {
      const res = await fetchAdmin('/api/products', { method: 'POST', body: JSON.stringify(productData) });
      if (!res.ok) throw new Error('Failed');
      const created = await res.json();
      __adminProductsCache = [created, ...getProducts().filter(p => p.id !== created.id)];
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      // Fallback to local-only when offline
      const products = getProducts();
      const newProduct = { id: generateId(), ...productData, createdAt: new Date().toISOString() };
      products.push(newProduct);
      saveProducts(products);
      renderProducts();
    }
  })();
}

function editProduct(id) {
  const products = getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;

  currentEditingProduct = id;
  document.getElementById('product-name').value = product.name;
  document.getElementById('product-price').value = product.price;
  document.getElementById('product-image').value = product.image || '';
  document.getElementById('product-category').value = product.category;
  document.getElementById('product-description').value = product.description || '';
  document.getElementById('product-stock').value = product.stock || 0;

  document.querySelector('#product-form button[type="submit"]').textContent = 'Update Product';
  document.getElementById('cancel-edit').style.display = 'block';
}

function updateProduct(id, productData) {
  (async () => {
    try {
      const res = await fetchAdmin(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(productData) });
      if (!res.ok) throw new Error('Failed');
      const updated = await res.json();
      __adminProductsCache = getProducts().map(p => p.id === id ? { ...p, ...updated } : p);
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      // Local fallback
      const products = getProducts();
      const index = products.findIndex(p => p.id === id);
      if (index !== -1) {
        products[index] = { ...products[index], ...productData };
        saveProducts(products);
        renderProducts();
      }
    }
  })();
}

function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  (async () => {
    try {
      const res = await fetchAdmin(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      __adminProductsCache = getProducts().filter(p => p.id !== id);
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      const products = getProducts().filter(p => p.id !== id);
      saveProducts(products);
      renderProducts();
    }
  })();
}

function cancelEdit() {
  currentEditingProduct = null;
  document.getElementById('product-form').reset();
  document.querySelector('#product-form button[type="submit"]').textContent = 'Add Product';
  document.getElementById('cancel-edit').style.display = 'none';
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();

  // Check if user is admin
  if (!user || !user.isAdmin) {
    alert('Access denied. Admin privileges required.');
    window.location.href = 'login.html?redirect=admin.html';
    return;
  }
  // If served via Live Server (port 5500) and no Bearer token, redirect to login to acquire one
  try {
    const hasToken = !!localStorage.getItem('authToken');
    if (!hasToken && location.port === '5500') {
      // Cookies won't be sent cross-origin; ensure token exists for Authorization header
      window.location.href = 'login.html?redirect=admin.html';
      return;
    }
  } catch {}

  // Product form submission
  document.getElementById('product-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const productData = {
      name: document.getElementById('product-name').value,
      price: parseFloat(document.getElementById('product-price').value),
      image: document.getElementById('product-image').value,
      category: document.getElementById('product-category').value,
      description: document.getElementById('product-description').value,
      stock: parseInt(document.getElementById('product-stock').value) || 0
    };

    if (currentEditingProduct) {
      updateProduct(currentEditingProduct, productData);
      cancelEdit();
    } else {
      addProduct(productData);
      document.getElementById('product-form').reset();
    }
  });

  // Wire Product Sync button
  const syncBtn = document.getElementById('btn-sync-products');
  const syncDry = document.getElementById('sync-dryrun');
  const syncDeact = document.getElementById('sync-deactivate');
  const syncStatus = document.getElementById('sync-status');
  if (syncBtn && !syncBtn.__wired) {
    syncBtn.__wired = true;
    syncBtn.addEventListener('click', async () => {
      try {
        if (syncStatus) syncStatus.textContent = 'Running…';
        syncBtn.disabled = true;
        const params = new URLSearchParams();
        params.set('stripe', '1');
        if (syncDry && syncDry.checked) params.set('dry', '1');
        if (syncDeact && syncDeact.checked) params.set('deactivateRemoved', '1');
        const res = await fetchAdmin(`/api/admin/products/sync?${params.toString()}`, { method: 'POST' });
        const data = await res.json().catch(()=>({}));
        if (!res.ok || data.ok === false) throw new Error(data.message || 'Sync failed');
        const wrote = (data.wrote!=null) ? `${data.wrote}` : '—';
        const disc = (data.discovered!=null) ? `${data.discovered}` : '—';
        const warns = Array.isArray(data.warnings) ? data.warnings.length : 0;
        if (syncStatus) syncStatus.textContent = `Done. Wrote ${wrote}, discovered ${disc}${warns?`, warnings ${warns}`:''}.`;
        // For visibility, also log stdout to console
        try { console.info('[Product Sync] stdout:\n' + (data.stdout||'')); if (data.stderr) console.warn('[Product Sync] stderr:\n' + data.stderr); } catch {}
      } catch (e) {
        if (syncStatus) syncStatus.textContent = e.message || 'Sync failed';
      } finally {
        syncBtn.disabled = false;
      }
    });
  }

  // Logout functionality
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
  const base = window.__API_BASE || API_BASES[0] || '';
  fetch(`${base}/api/users/logout`, { method:'POST', credentials:'include', headers: authHeaders() }).finally(()=>{
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
      });
    });
  }

  // Load initial data
  // Ensure the default tab (Products) is visible on load
  showSection('products', document.querySelector('.admin-nav button'));
  // Load products exclusively from prodList.json for Admin > Products
  loadProductsFromProdList().then(() => { try { renderProducts(); } catch {} });
  // Orders filters
  const statusFilter = document.getElementById('orders-status-filter');
  const refreshBtn = document.getElementById('orders-refresh-btn');
  if (statusFilter) statusFilter.addEventListener('change', renderOrders);
  if (refreshBtn) refreshBtn.addEventListener('click', renderOrders);

  // Invoices filters
  const invStatusFilter = document.getElementById('invoices-status-filter');
  const invRefreshBtn = document.getElementById('invoices-refresh-btn');
  if (invStatusFilter) invStatusFilter.addEventListener('change', renderInvoices);
  if (invRefreshBtn) invRefreshBtn.addEventListener('click', renderInvoices);
  // Finance
  const finTf = document.getElementById('finance-timeframe');
  const finRefresh = document.getElementById('finance-refresh-btn');
  if (finTf) finTf.addEventListener('change', renderFinance);
  if (finRefresh) finRefresh.addEventListener('click', renderFinance);
  const finPayoutsLocalRefresh = document.getElementById('fin-payouts-local-refresh');
  if (finPayoutsLocalRefresh) finPayoutsLocalRefresh.addEventListener('click', renderFinance);
  // Traffic
  const trTf = document.getElementById('traffic-timeframe');
  const trRefresh = document.getElementById('traffic-refresh-btn');
  if (trTf) trTf.addEventListener('change', renderTraffic);
  if (trRefresh) trRefresh.addEventListener('click', renderTraffic);

  // Bulk update wiring
  try {
    const opSel = document.getElementById('bulk-op');
    const rowShip = document.getElementById('bulk-row-setShipping');
    const rowEq = document.getElementById('bulk-row-changeMapEqual');
    const rowSku = document.getElementById('bulk-row-setMapBySku');
    const status = document.getElementById('bulk-status');
    const runBtn = document.getElementById('bulk-run');
    const onOpChange = () => {
      const v = opSel?.value || 'setShipping';
      [rowShip,rowEq,rowSku].forEach(el=>{ if(!el) return; el.classList.add('hidden'); el.style.display='none'; });
      if (v === 'setShipping') { rowShip.classList.remove('hidden'); rowShip.style.display=''; }
      if (v === 'changeMapEqual') { rowEq.classList.remove('hidden'); rowEq.style.display=''; }
      if (v === 'setMapBySku') { rowSku.classList.remove('hidden'); rowSku.style.display=''; }
    };
    if (opSel && !opSel.__wired) { opSel.__wired = true; opSel.addEventListener('change', onOpChange); onOpChange(); }
    if (runBtn && !runBtn.__wired) {
      runBtn.__wired = true;
      runBtn.addEventListener('click', async () => {
        try {
          if (status) status.textContent = 'Running…';
          const op = opSel?.value || 'setShipping';
          const cat = document.getElementById('bulk-category')?.value || '';
          let payload = { op: { type: op } };
          if (cat) payload.op.category = cat;
          if (op === 'setShipping') {
            const v = Number(document.getElementById('bulk-ship')?.value || 0);
            const onlyMissing = !!document.getElementById('bulk-onlymissing')?.checked;
            payload.op.value = v; payload.op.onlyMissing = onlyMissing;
          } else if (op === 'changeMapEqual') {
            payload.op.from = Number(document.getElementById('bulk-map-from')?.value || NaN);
            payload.op.to = Number(document.getElementById('bulk-map-to')?.value || NaN);
          } else if (op === 'setMapBySku') {
            const raw = document.getElementById('bulk-mapby')?.value || '';
            const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
            const map = {};
            for (const line of lines) {
              const [sku, price] = line.split(',').map(s=>s.trim());
              if (sku && price!=null) { const num = Number(price); if (Number.isFinite(num)) map[sku] = num; }
            }
            payload.op.map = map;
          }
          const res = await fetchAdmin('/api/admin/prodlist/bulk-update', { method:'POST', body: JSON.stringify(payload) });
          const data = await res.json().catch(()=>({}));
          if (!res.ok) throw new Error(data.message || 'Failed');
          if (status) status.textContent = `Done. Changed ${data.changed||0} record(s).`;
        } catch (e) {
          if (status) status.textContent = e.message || 'Failed';
        }
      });
    }
  } catch {}
});

// Make functions global for onclick handlers
window.showSection = showSection;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.cancelEdit = cancelEdit;
window.openBillingPortal = async function(email){
  try {
    if (!email) { alert('Enter a customer email first.'); return; }
    const base = window.__API_BASE || API_BASES[0] || '';
    const res = await fetch(`${base}/api/admin/billing-portal`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, return_url: location.origin + '/admin.html' })
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.url) throw new Error(data.message||'Failed to create portal session');
    window.location.href = data.url;
  } catch (e) {
    alert(e.message || 'Unable to open billing portal');
  }
}
// Marketing helpers
async function renderMarketing(){
  // Initial loads
  await loadSubscribers();
  await loadCoupons();
  await populateMarketingWidgets();

  // Wire newsletter form
  const nlForm = document.getElementById('newsletter-form');
  const nlStatus = document.getElementById('nl-status');
  if (nlForm && !nlForm.__wired) {
    nlForm.__wired = true;
    nlForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      nlStatus.textContent = 'Queuing…';
      try {
        const body = {
          subject: document.getElementById('nl-subject').value,
          text: document.getElementById('nl-text').value,
          html: document.getElementById('nl-html').value
        };
        const res = await fetchAdmin('/api/marketing/admin/newsletter', { method:'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message||'Failed');
        nlStatus.textContent = `Queued ${data.queued||0} emails.`;
        nlForm.reset();
      } catch (e) { nlStatus.textContent = e.message || 'Failed'; }
    });
  }

  // Wire coupon form
  const cpForm = document.getElementById('coupon-form');
  const cpStatus = document.getElementById('coupon-status');
  if (cpForm && !cpForm.__wired) {
    cpForm.__wired = true;
    cpForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      cpStatus.textContent = 'Creating…';
      try {
        const emails = (document.getElementById('cp-emails').value||'').split(',').map(e=>e.trim()).filter(Boolean);
        const userIds = (document.getElementById('cp-userids')?.value||'').split(',').map(e=>e.trim()).filter(Boolean);
        const body = {
          code: document.getElementById('cp-code').value,
          type: document.getElementById('cp-type').value,
          value: Number(document.getElementById('cp-value').value||0),
          expiresAt: document.getElementById('cp-expires').value || null,
          maxUses: Number(document.getElementById('cp-maxuses').value||0),
          userEmails: emails,
          userIds
        };
        const res = await fetchAdmin('/api/marketing/admin/coupons', { method:'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message||'Failed');
        cpStatus.textContent = 'Created.';
        cpForm.reset();
        await loadCoupons();
      } catch (e) { cpStatus.textContent = e.message || 'Failed'; }
    });
  }

  // Refresh buttons
  const couRefresh = document.getElementById('coupons-refresh');
  if (couRefresh && !couRefresh.__wired) { couRefresh.__wired = true; couRefresh.addEventListener('click', async () => { await loadCoupons(); await populateMarketingWidgets(); }); }
  const subsRefresh = document.getElementById('subs-refresh');
  if (subsRefresh && !subsRefresh.__wired) { subsRefresh.__wired = true; subsRefresh.addEventListener('click', async () => { await loadSubscribers(); await populateMarketingWidgets(); }); }
}

async function loadCoupons(){
  try {
    const el = document.getElementById('coupons-list');
    const err = document.getElementById('coupons-error');
    if (el) el.innerHTML = '<p class="muted">Loading coupons…</p>';
    if (err) err.style.display = 'none';
    const res = await fetchAdmin('/api/marketing/admin/coupons');
    const list = res.ok ? await res.json() : [];
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p>No coupons created.</p>'; return; }
    el.innerHTML = list.map(c => `
      <div class="product-item">
        <div>
          <strong>${c.code}</strong> — ${c.type==='percent'?c.value+'%':'$'+Number(c.value||0).toFixed(2)}
          <br><small>Used ${c.used||0}${c.maxUses?` / ${c.maxUses}`:''} ${c.active===false?'(inactive)':''}</small>
          ${c.expiresAt?`<br><small>Expires: ${new Date(c.expiresAt).toLocaleDateString()}</small>`:''}
          ${(Array.isArray(c.userEmails)&&c.userEmails.length)||(Array.isArray(c.userIds)&&c.userIds.length) ? `<br><small>Restricted: ${[...(c.userEmails||[]),(c.userIds&&c.userIds.length?`${c.userIds.length} userIds`:null)].filter(Boolean).join(', ')}</small>`:''}
        </div>
        <div>
          ${c.active!==false?`<button class="btn btn-ghost" data-deact="${c.code}">Deactivate</button>`:''}
        </div>
      </div>
    `).join('');
    el.querySelectorAll('[data-deact]').forEach(btn => {
      btn.addEventListener('click', async ()=>{
        const code = btn.getAttribute('data-deact');
        try {
          const r = await fetchAdmin(`/api/marketing/admin/coupons/${encodeURIComponent(code)}/deactivate`, { method:'POST' });
          if (!r.ok) throw new Error('Failed');
          loadCoupons();
        } catch (e) {
          if (err) { err.style.display = ''; err.textContent = e.message || 'Failed to deactivate.'; }
        }
      });
    });
  } catch (e) {
    const el = document.getElementById('coupons-list');
    const err = document.getElementById('coupons-error');
    if (el) el.innerHTML = '';
    if (err) { err.style.display = ''; err.textContent = e.message || 'Failed to load coupons.'; }
  }
}

async function loadSubscribers(){
  const subsList = document.getElementById('subs-list');
  const err = document.getElementById('subs-error');
  if (subsList) subsList.innerHTML = '<p class="muted">Loading subscribers…</p>';
  if (err) err.style.display = 'none';
  try {
    const subsRes = await fetchAdmin(`/api/marketing/admin/subscribers?activeOnly=true`);
    const subs = subsRes.ok ? await subsRes.json() : [];
    if (subsList) subsList.innerHTML = subs.length ? (`<ul>` + subs.map(s=>`<li>${s.email}${s.name?` — ${s.name}`:''}</li>`).join('') + `</ul>`) : '<p>No subscribers yet.</p>';
  } catch (e) {
    if (subsList) subsList.innerHTML = '';
    if (err) { err.style.display=''; err.textContent = e.message || 'Failed to load subscribers.'; }
  }
}

async function populateMarketingWidgets(){
  // Subscribers active count
  try {
    const res = await fetchAdmin(`/api/marketing/admin/subscribers?activeOnly=true`);
    const list = res.ok ? await res.json() : [];
    const el = document.getElementById('w-subs-active');
    if (el) el.textContent = Array.isArray(list) ? list.length : '0';
  } catch { const el = document.getElementById('w-subs-active'); if (el) el.textContent = '—'; }

  // Coupons aggregates & top codes
  try {
    const res = await fetchAdmin('/api/marketing/admin/coupons');
    const list = res.ok ? await res.json() : [];
    const total = list.length;
    const active = list.filter(c=>c.active!==false).length;
    const usedSum = list.reduce((s,c)=> s + (Number(c.used||0)), 0);
    const top = list.slice().sort((a,b)=>(b.used||0)-(a.used||0)).slice(0,5);
    const fmt = (n)=> (typeof n==='number' ? n.toLocaleString() : n);
    const elTotal = document.getElementById('w-coupons-total'); if (elTotal) elTotal.textContent = fmt(total);
    const elActive = document.getElementById('w-coupons-active'); if (elActive) elActive.textContent = fmt(active);
    const elUsed = document.getElementById('w-coupons-used'); if (elUsed) elUsed.textContent = fmt(usedSum);
    const listEl = document.getElementById('w-top-codes');
    if (listEl) {
      if (!top.length) listEl.innerHTML = '<li>No redemptions yet.</li>';
      else listEl.innerHTML = top.map(c => `<li><strong>${c.code}</strong> — used ${Number(c.used||0)}${c.expiresAt?`, exp ${new Date(c.expiresAt).toLocaleDateString()}`:''}</li>`).join('');
    }
  } catch {
    const elTotal = document.getElementById('w-coupons-total'); if (elTotal) elTotal.textContent = '—';
    const elActive = document.getElementById('w-coupons-active'); if (elActive) elActive.textContent = '—';
    const elUsed = document.getElementById('w-coupons-used'); if (elUsed) elUsed.textContent = '—';
    const listEl = document.getElementById('w-top-codes'); if (listEl) listEl.innerHTML = '<li class="muted">Unavailable</li>';
  }
}

// Invoices
function renderInvoices() {
  const list = document.getElementById('invoices-list');
  const status = document.getElementById('invoices-status-filter')?.value || '';
  list.innerHTML = '<p>Loading invoices…</p>';

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', window.__invoicesPage||1);
  params.set('pageSize', 10);
  params.set('sortBy', 'createdAt');
  params.set('sortDir', 'desc');
  fetchAdmin(`/api/invoices/admin/all?${params.toString()}`)
    .then(async res=>{ if(!res.ok){ const txt=await res.text().catch(()=> ''); throw new Error(txt||'Unauthorized or failed'); } return res.json(); })
    .then(result => {
      const { items:invoices, total, page, pageSize } = Array.isArray(result) ? { items:result, total:result.length, page:1, pageSize:result.length } : result;
      if (!invoices || !invoices.length) { list.innerHTML = '<p>No invoices found.</p>'; return; }
      const html = invoices.map(inv => `
        <div class="product-item">
          <div>
            <strong>${inv.id}</strong> — <small>${inv.status}</small>
            <br><small>${new Date(inv.createdAt).toLocaleString()}</small>
            <br>${inv.customer?.name || 'Customer'} (${inv.customer?.email || ''})
          </div>
          <div class="flex-row gap-05 items-center">
            <strong>$${Number(inv.total||0).toFixed(2)}</strong>
                <a class="btn btn-ghost" href="${(window.__API_BASE||API_BASES[0]||'')}/api/invoices/${inv.id}/print" target="_blank" rel="noopener">View</a>
            <button class="btn btn-ghost" data-print="${inv.id}">Print</button>
          </div>
        </div>
      `).join('');

      const pager = `
        <div class="flex-row gap-1 items-center mt-1">
          <button class="btn btn-ghost" id="invoices-prev" ${page<=1?'disabled':''}>Prev</button>
          <span>Page ${page} of ${Math.max(1, Math.ceil(total/(pageSize||1)))} (${total} total)</span>
          <button class="btn btn-ghost" id="invoices-next" ${(page*pageSize)>=total?'disabled':''}>Next</button>
        </div>`;

      list.innerHTML = html + pager;

      // Wire print
      list.querySelectorAll('[data-print]').forEach(btn => {
        btn.addEventListener('click', () => printInvoice(btn.getAttribute('data-print')));
      });

      const prev = document.getElementById('invoices-prev');
      const next = document.getElementById('invoices-next');
      if (prev) prev.addEventListener('click', ()=>{ window.__invoicesPage = Math.max(1,(page-1)); renderInvoices(); });
      if (next) next.addEventListener('click', ()=>{ window.__invoicesPage = (page+1); renderInvoices(); });
    })
  .catch((e)=>{ list.innerHTML = `<p>Failed to load invoices. ${e.message||''}</p>`; });
}

function printInvoice(invoiceId) {
  fetchAdmin(`/api/invoices/${invoiceId}`)
    .then(r=>{ if(!r.ok) throw new Error('Failed'); return r.json(); })
    .then(inv => {
      const w = window.open('', '_blank');
      if (!w) return alert('Popup blocked. Allow popups to print invoice.');
  const rows = (inv.items||[]).map(it => `<tr><td>${it.productName||it.productId}</td><td class="num">${it.quantity||it.qty}</td><td class="num">$${Number(it.price||0).toFixed(2)}</td><td class="num">$${Number(it.subtotal||((it.price||0)*(it.quantity||1))).toFixed(2)}</td></tr>`).join('');
      w.document.write(`
        <html><head><title>${inv.id}</title>
  <style>body{font-family: Arial, sans-serif; padding:20px;} table{width:100%; border-collapse: collapse;} th,td{padding:8px; border-bottom:1px solid #eee;} th.num,td.num{text-align:right;} h1{margin:0 0 10px;} .totals{margin-top:10px; text-align:right;} </style>
        </head><body>
          <h1>Invoice ${inv.id}</h1>
          <p>Date: ${new Date(inv.createdAt).toLocaleString()}</p>
          <p>Customer: ${inv.customer?.name || ''} (${inv.customer?.email || ''})</p>
          <table>
            <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="totals">
            <div>Subtotal: $${Number(inv.subtotal||0).toFixed(2)}</div>
            <div>Tax: $${Number(inv.tax||0).toFixed(2)}</div>
            <div>Shipping: $${Number(inv.shipping||0).toFixed(2)}</div>
            <div><strong>Total: $${Number(inv.total||0).toFixed(2)}</strong></div>
          </div>
          <script>window.print();</script>
        </body></html>
      `);
      w.document.close();
    })
    .catch(()=> alert('Failed to load invoice'));
}

// Finance (Stripe)
async function renderFinance(){
  const tf = document.getElementById('finance-timeframe');
  const timeframe = tf ? tf.value : 'week';
  try {
    const base = window.__API_BASE || API_BASES[0] || '';
    const res = await fetch(`${base}/api/admin/stripe/summary?timeframe=${encodeURIComponent(timeframe)}`, { credentials:'include', headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text().catch(()=> 'Failed'));
    const data = await res.json();
    const fmt = (n)=> `$${Number(n||0).toFixed(2)}`;
    const g = document.getElementById('fin-gross'); if (g) g.textContent = fmt(data.summary?.gross);
    const r = document.getElementById('fin-refunds'); if (r) r.textContent = fmt(data.summary?.refunds);
    const f = document.getElementById('fin-fees'); if (f) f.textContent = fmt(data.summary?.fees);
    const n = document.getElementById('fin-net'); if (n) n.textContent = fmt(data.summary?.net);
    const bal = document.getElementById('fin-balance');
    if (bal) {
      const avail = (data.balance?.available||[]).map(b=>`${b.currency.toUpperCase()}: ${fmt(b.amount)}`).join(', ') || '–';
      const pend = (data.balance?.pending||[]).map(b=>`${b.currency.toUpperCase()}: ${fmt(b.amount)}`).join(', ') || '–';
      bal.textContent = `Available: ${avail} | Pending: ${pend}`;
    }
    const payouts = document.getElementById('fin-payouts');
    if (payouts) {
      const list = (data.payouts||[]).map(p=>`<div class="product-item"><div><strong>${p.id}</strong><br><small>${new Date(p.created*1000).toLocaleString()}</small></div><div><strong>${fmt(p.amount)}</strong> <small>${p.status}</small></div></div>`).join('');
      payouts.innerHTML = list || '<p class="muted">No payouts</p>';
    }
    // Chart: cash flow daily
    try {
      const el = document.getElementById('fin-chart');
      if (el && window.Chart) {
        const labels = (data.series||[]).map(p=>p.date);
        const gross = (data.series||[]).map(p=>p.gross||0);
        const net = (data.series||[]).map(p=>p.net||0);
        const refunds = (data.series||[]).map(p=>p.refunds||0);
        const fees = (data.series||[]).map(p=>p.fees||0);
        if (el.__chart) { el.__chart.destroy(); }
        el.__chart = new window.Chart(el.getContext('2d'), {
          type: 'line',
          data: { labels, datasets: [
            { label:'Gross', data:gross, borderColor:'#2a6ef4', backgroundColor:'rgba(42,110,244,0.15)', tension:.25 },
            { label:'Net', data:net, borderColor:'#0aa06e', backgroundColor:'rgba(10,160,110,0.15)', tension:.25 },
            { label:'Refunds', data:refunds, borderColor:'#cc3344', backgroundColor:'rgba(204,51,68,0.15)', tension:.25 },
            { label:'Fees', data:fees, borderColor:'#888', backgroundColor:'rgba(136,136,136,0.15)', tension:.25 }
          ] },
          options: { responsive:true, scales:{ y:{ beginAtZero:true, ticks:{ callback:(v)=>`$${Number(v).toFixed(0)}` } } }, plugins:{ legend:{ position:'bottom' } } }
        });
      }
    } catch {}
  } catch (e) {
    const g = document.getElementById('fin-gross'); if (g) g.textContent = '—';
    const r = document.getElementById('fin-refunds'); if (r) r.textContent = '—';
    const f = document.getElementById('fin-fees'); if (f) f.textContent = '—';
    const n = document.getElementById('fin-net'); if (n) n.textContent = '—';
    const bal = document.getElementById('fin-balance'); if (bal) bal.textContent = 'Unavailable';
    const payouts = document.getElementById('fin-payouts'); if (payouts) payouts.innerHTML = '<p class="muted">Unavailable</p>';
  }
  // Load local payout history
  try {
    const base = window.__API_BASE || API_BASES[0] || '';
    const res = await fetch(`${base}/api/admin/stripe/payouts-local`, { credentials:'include', headers: authHeaders() });
    const wrap = document.getElementById('fin-payouts-local');
    if (wrap) {
      if (!res.ok) { wrap.innerHTML = '<p class="muted">No local payouts.</p>'; }
      else {
        const data = await res.json();
        const list = (data.items||[]).map(p=>`<div class="product-item"><div><strong>${p.id}</strong><br><small>${new Date(p.createdAt).toLocaleString()}</small>${p.arrivalDate?`<br><small>Arrived: ${new Date(p.arrivalDate).toLocaleDateString()}</small>`:''}</div><div><strong>$${Number(p.amount||0).toFixed(2)}</strong> <small>${p.status||''}</small></div></div>`).join('');
        wrap.innerHTML = list || '<p class="muted">No local payouts.</p>';
      }
    }
  } catch (e) {
    const wrap = document.getElementById('fin-payouts-local'); if (wrap) wrap.innerHTML = '<p class="muted">Unavailable</p>';
  }
  // Also attempt to list invoices
  try {
    const base = window.__API_BASE || API_BASES[0] || '';
    const tf = document.getElementById('finance-timeframe');
    const timeframe = tf ? tf.value : 'week';
    const res = await fetch(`${base}/api/admin/stripe/invoices?timeframe=${encodeURIComponent(timeframe)}&limit=10`, { credentials:'include', headers: authHeaders() });
    const wrap = document.getElementById('fin-invoices');
    if (!wrap) return;
    if (!res.ok) { wrap.innerHTML = '<p class="muted">No Stripe invoices.</p>'; return; }
    const data = await res.json();
    const list = (data.items||[]).map(inv=>`<div class="product-item"><div><strong>${inv.number||inv.id}</strong> <small>${inv.status}</small><br><small>${new Date(inv.created*1000).toLocaleString()}</small><br>${inv.customer_email||''}</div><div><strong>$${Number(inv.total/100).toFixed(2)}</strong></div></div>`).join('');
    wrap.innerHTML = list || '<p class="muted">No Stripe invoices.</p>';
  } catch (e) {
    const wrap = document.getElementById('fin-invoices'); if (wrap) wrap.innerHTML = '<p class="muted">Unavailable</p>';
  }
}

// Traffic (Cloudflare)
async function renderTraffic(){
  const tf = document.getElementById('traffic-timeframe');
  const timeframe = tf ? tf.value : 'week';
  try {
    const base = window.__API_BASE || API_BASES[0] || '';
    const res = await fetch(`${base}/api/admin/cloudflare/summary?timeframe=${encodeURIComponent(timeframe)}`, { credentials:'include', headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text().catch(()=> 'Failed'));
    const data = await res.json();
    const reqs = document.getElementById('cf-reqs'); if (reqs) reqs.textContent = String(data.totals?.requests||0);
    const cache = document.getElementById('cf-cache'); if (cache) cache.textContent = `${Math.round((data.cacheRatio||0)*100)}%`;
    const band = document.getElementById('cf-band'); if (band) band.textContent = `${Number(data.bandwidthMB||0).toFixed(1)} MB`;
    const thr = document.getElementById('cf-threats'); if (thr) thr.textContent = String(data.totals?.threats||0);
    const top = document.getElementById('cf-top-paths'); if (top) top.innerHTML = (data.topPaths||[]).map(p=>`<li><code>${p.path}</code> — <strong>${p.requests}</strong></li>`).join('') || '<li class="muted">No data</li>';
    const byc = document.getElementById('cf-by-country'); if (byc) byc.innerHTML = (data.byCountry||[]).map(c=>`<li>${c.country} — <strong>${c.requests}</strong></li>`).join('') || '<li class="muted">No data</li>';
    // Chart: daily requests
    try {
      const el = document.getElementById('cf-chart');
      if (el && window.Chart) {
        const labels = (data.series||[]).map(p=>p.date);
        const reqs = (data.series||[]).map(p=>p.requests||0);
        const cached = (data.series||[]).map(p=>p.cachedRequests||0);
        const threats = (data.series||[]).map(p=>p.threats||0);
        if (el.__chart) { el.__chart.destroy(); }
        el.__chart = new window.Chart(el.getContext('2d'), {
          type: 'line',
          data: { labels, datasets: [
            { label:'Requests', data:reqs, borderColor:'#2a6ef4', backgroundColor:'rgba(42,110,244,0.15)', tension:.25 },
            { label:'Cached', data:cached, borderColor:'#0aa06e', backgroundColor:'rgba(10,160,110,0.15)', tension:.25 },
            { label:'Threats', data:threats, borderColor:'#cc3344', backgroundColor:'rgba(204,51,68,0.15)', tension:.25 }
          ] },
          options: { responsive:true, scales:{ y:{ beginAtZero:true } }, plugins:{ legend:{ position:'bottom' } } }
        });
      }
    } catch {}
  } catch (e) {
    const reqs = document.getElementById('cf-reqs'); if (reqs) reqs.textContent = '—';
    const cache = document.getElementById('cf-cache'); if (cache) cache.textContent = '—';
    const band = document.getElementById('cf-band'); if (band) band.textContent = '—';
    const thr = document.getElementById('cf-threats'); if (thr) thr.textContent = '—';
    const top = document.getElementById('cf-top-paths'); if (top) top.innerHTML = '<li class="muted">Unavailable</li>';
    const byc = document.getElementById('cf-by-country'); if (byc) byc.innerHTML = '<li class="muted">Unavailable</li>';
  }
}
// Netting config UI
async function renderNetting(){
  const status = document.getElementById('net-status');
  if (status) status.textContent = 'Loading…';
  try {
    const res = await fetchAdmin('/api/admin/netting-config');
    const data = res.ok ? await res.json() : null;
    if (!data) throw new Error('Failed to load');
    // Fill defaults
    const d = data.defaults || {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v!=null? v : ''); };
    setVal('net-markup', d.markupPerSqFt);
    setVal('net-border', d.borderSurchargePerFt);
    setVal('net-expedite', d.expeditedFee);
    setVal('net-ship', d.shipPerItem);
    // Render mesh list
    const list = document.getElementById('net-mesh-list');
    if (list){
      const meshes = Array.isArray(data.meshPrices) ? data.meshPrices : [];
      if (!meshes.length) list.innerHTML = '<p class="muted">No meshes configured.</p>';
      else list.innerHTML = meshes.map((m,idx)=>`
        <div class="product-item" data-row="${idx}">
          <div class="stack-05">
            <div><strong>${m.label||m.id}</strong> <small class="muted">(${m.sport||'other'})</small></div>
            <div class="muted">Wholesale $/sq ft: <input type="number" step="0.0001" min="0" value="${Number(m.wholesaleSqFt||0)}" data-field="wholesaleSqFt" style="width:110px"/> &nbsp; ID: <input type="text" value="${m.id||''}" data-field="id" style="width:160px"/> &nbsp; Label: <input type="text" value="${m.label||''}" data-field="label" style="width:160px"/> &nbsp; Sport: <input type="text" value="${m.sport||'other'}" data-field="sport" style="width:100px"/></div>
          </div>
          <div><button class="btn btn-ghost" type="button" data-del="${idx}">Remove</button></div>
        </div>
      `).join('');
      // Wire remove buttons
      list.querySelectorAll('[data-del]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const row = Number(btn.getAttribute('data-del'));
          const items = Array.from(list.querySelectorAll('[data-row]'));
          if (row>=0 && row < items.length) {
            items[row].remove();
            if (status) status.textContent = 'Row removed (not saved)';
          }
        });
      });
      // Wire inline edits to mark dirty
      list.querySelectorAll('input').forEach(inp=>{
        inp.addEventListener('input', ()=>{ if(status) status.textContent = 'Unsaved changes'; });
      });
    }
    const addBtn = document.getElementById('net-add-row');
    if (addBtn && !addBtn.__wired){
      addBtn.__wired = true;
      addBtn.addEventListener('click', ()=>{
        const list = document.getElementById('net-mesh-list');
        const idx = list.querySelectorAll('[data-row]').length;
        const div = document.createElement('div');
        div.className = 'product-item';
        div.setAttribute('data-row', String(idx));
        div.innerHTML = `<div class="stack-05"><div><strong>New Mesh</strong></div><div class="muted">Wholesale $/sq ft: <input type="number" step="0.0001" min="0" value="0" data-field="wholesaleSqFt" style="width:110px"/> &nbsp; ID: <input type="text" value="custom-${Date.now()}" data-field="id" style="width:160px"/> &nbsp; Label: <input type="text" value="Label" data-field="label" style="width:160px"/> &nbsp; Sport: <input type="text" value="other" data-field="sport" style="width:100px"/></div></div><div><button class="btn btn-ghost" type="button" data-del="${idx}">Remove</button></div>`;
        list.appendChild(div);
        if (status) status.textContent = 'Unsaved changes';
        // Wire remove
        div.querySelector('[data-del]')?.addEventListener('click', ()=>{ div.remove(); if(status) status.textContent='Row removed (not saved)'; });
      });
    }
    const saveBtn = document.getElementById('net-save');
    if (saveBtn && !saveBtn.__wired){
      saveBtn.__wired = true;
      saveBtn.addEventListener('click', async ()=>{
        try{
          if (status) status.textContent = 'Saving…';
          const markup = Number(document.getElementById('net-markup')?.value || 0.25) || 0;
          const border = Number(document.getElementById('net-border')?.value || 0.35) || 0;
          const expedite = Number(document.getElementById('net-expedite')?.value || 25) || 0;
          const ship = Number(document.getElementById('net-ship')?.value || 100) || 0;
          const list = document.getElementById('net-mesh-list');
          const rows = Array.from(list.querySelectorAll('[data-row]'));
          const meshPrices = rows.map(row => {
            const get = (sel)=> row.querySelector(`[data-field="${sel}"]`);
            return {
              id: String(get('id')?.value || ''),
              label: String(get('label')?.value || ''),
              sport: String(get('sport')?.value || 'other'),
              wholesaleSqFt: Number(get('wholesaleSqFt')?.value || 0) || 0
            };
          }).filter(m=>m.id && m.label);
          const payload = { version: 1, defaults: { markupPerSqFt: markup, borderSurchargePerFt: border, expeditedFee: expedite, shipPerItem: ship }, meshPrices };
          const res = await fetchAdmin('/api/admin/netting-config', { method:'PUT', body: JSON.stringify(payload) });
          if (!res.ok) throw new Error(await res.text().catch(()=> 'Failed'));
          if (status) status.textContent = 'Saved.';
        } catch(e){ if (status) status.textContent = e.message || 'Failed to save'; }
      });
    }
    if (status && !status.textContent) status.textContent = '';
  } catch (e) {
    const status = document.getElementById('net-status'); if (status) status.textContent = e.message || 'Failed to load';
  }
}