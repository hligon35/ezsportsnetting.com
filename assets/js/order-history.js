// Order History: server-backed with guest email fallback and tabular view
function currencyFmt(n){ return Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD'}); }
const API_BASE = (() => {
  const isHttp = location.protocol.startsWith('http');
  const isLiveServer = isHttp && location.port === '5500';
  const bases = [];
  try { if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, '')); } catch {}
  try {
    const meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) bases.push(String(meta.content).trim().replace(/\/$/, ''));
  } catch {}
  // Same-origin works when the API server hosts the frontend.
  if (!isLiveServer) bases.push('');
  if (isLiveServer) {
    bases.push(
      'http://127.0.0.1:4243','http://localhost:4243',
      'http://127.0.0.1:4242','http://localhost:4242',
      'http://127.0.0.1:4244','http://localhost:4244',
      'http://127.0.0.1:4245','http://localhost:4245',
      'http://127.0.0.1:4246','http://localhost:4246',
      'http://127.0.0.1:4247','http://localhost:4247'
    );
  }
  return Array.from(new Set(bases))[0] || '';
})();

function getCurrentUser(){
  try{ return JSON.parse(localStorage.getItem('currentUser')||'null'); }catch{ return null; }
}

async function fetchOrdersServer(){
  try{
    const res = await fetch(`${API_BASE}/api/orders/me`, { credentials:'include' });
    if (!res.ok) throw new Error('Not authorized');
    return await res.json();
  }catch{ return null; }
}

async function fetchOrdersByEmail(email){
  try{
    const u = new URL(`${API_BASE}/api/orders/public/by-email`, location.href);
    u.searchParams.set('email', email);
    const res = await fetch(u.toString(), { cache:'no-store' });
    if (!res.ok) return [];
    return await res.json();
  }catch{ return []; }
}

function renderTable(orders){
  if (!Array.isArray(orders) || !orders.length) return '<p>You have no orders yet. <a href="index.html#catalog">Start shopping!</a></p>';
  const rows = orders.map(o => {
    const date = new Date(o.createdAt || o.date).toLocaleString();
    const items = (o.items||[]).reduce((sum, i) => sum + (i.qty||i.quantity||0), 0);
    // Show Resume action for pending/cancelled orders
    const status = String(o.status||'').toLowerCase();
    const canResume = status === 'pending' || status === 'cancelled';
    const actionBtn = canResume ? `<button class="btn btn-ghost btn-xs" data-resume="${o.id}">Resume</button>` : '';
    // Build a compact details list of variants and SKUs
    const detail = (o.items||[]).slice(0,3).map(i => {
      const isNet = String(i.category||'').toLowerCase()==='netting' || String(i.id||'').toLowerCase().startsWith('custom-net-');
      const parts = [];
      if ((i.size||'').trim()) parts.push(`Size ${i.size}`);
      if ((i.color||'').trim()) parts.push(`${isNet ? 'Spec' : 'Color'} ${i.color}`);
      const variant = parts.join(', ');
      return `<div class="text-xs muted">${i.productName||i.name||i.id} — ${variant ? variant + ' • ' : ''}SKU: ${i.productId||i.id}</div>`;
    }).join('');
    return `<tr>
      <td>#${o.id}<div>${detail}</div></td>
      <td>${date}</td>
      <td>${o.status||'—'}</td>
      <td class="text-right">${items}</td>
      <td class="text-right">${currencyFmt(o.total)} ${actionBtn}</td>
    </tr>`;
  }).join('');
  return `<div class="stack-05">
    <div class="row gap-04 items-center">
      <label for="status-filter">Filter:</label>
      <select id="status-filter">
        <option value="">All</option>
        <option value="paid">Complete</option>
        <option value="pending">Pending</option>
        <option value="cancelled">Cancelled</option>
        <option value="refunded">Refunded</option>
        <option value="processing">Processing</option>
        <option value="shipped">Shipped</option>
        <option value="delivered">Delivered</option>
      </select>
    </div>
    <div class="table-responsive">
      <table class="table">
        <thead><tr><th>Order</th><th>Date</th><th>Status</th><th class="text-right">Items</th><th class="text-right">Total</th></tr></thead>
        <tbody id="orders-tbody">${rows}</tbody>
      </table>
    </div>
  </div>`;
}

async function renderOrders(){
  const user = getCurrentUser();
  const list = document.getElementById('orders-list');

  let orders = [];
  if (user) {
    const serverOrders = await fetchOrdersServer();
    if (Array.isArray(serverOrders)) orders = serverOrders;
  }

  if (!orders.length) {
    // Guest fallback: prompt for email lookup
    list.innerHTML = `
      <form id="email-lookup" class="stack-05" onsubmit="return false;">
        <label>Look up your orders by email</label>
        <div class="row gap-04">
          <input type="email" id="lookup-email" placeholder="you@example.com" required />
          <button class="btn btn-primary" id="lookup-btn" type="button">Find Orders</button>
        </div>
        <input type="text" name="hp" style="display:none" tabindex="-1" autocomplete="off"/>
      </form>
      <div id="orders-results" class="mt-1"></div>
    `;
    document.getElementById('lookup-btn').addEventListener('click', async () => {
      const em = String(document.getElementById('lookup-email').value||'').trim();
      if (!em) return;
      const found = await fetchOrdersByEmail(em);
      const container = document.getElementById('orders-results');
      container.innerHTML = renderTable(found);
      // Wire resume buttons inside results
      try {
        container.querySelectorAll('[data-resume]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-resume');
            const order = found.find(o => String(o.id) === String(id));
            if (!order) return;
            const cart = (order.items||[]).map(i => ({
              id: i.productId || i.id,
              title: i.productName || i.name || (i.productId || i.id),
              qty: Number(i.quantity || i.qty || 1),
              price: Number(i.price || (i.subtotal && i.quantity ? (Number(i.subtotal)/Number(i.quantity)) : 0) || 0),
              shipAmount: (typeof i.ship !== 'undefined') ? Number(i.ship) : undefined,
              size: i.size || '',
              color: i.color || '',
              category: i.category || ''
            })).filter(it => it && it.id);
            try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {}
            window.location.href = 'checkout.html';
          });
        });
      } catch {}
      const filter = document.getElementById('status-filter');
      if (filter) filter.addEventListener('change', () => {
        const val = filter.value;
        const rows = Array.from(container.querySelectorAll('#orders-tbody tr'));
        rows.forEach(tr => {
          const status = (tr.children[2]?.textContent||'').toLowerCase();
          tr.style.display = (!val || status === val) ? '' : 'none';
        });
      });
    });
    return;
  }

  // Logged-in: render table immediately
  list.innerHTML = renderTable(orders);
  // Wire resume buttons
  try {
    list.querySelectorAll('[data-resume]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-resume');
        const order = orders.find(o => String(o.id) === String(id));
        if (!order) return;
        // Build a cart from order items: id, qty, price, title
        const cart = (order.items||[]).map(i => ({
          id: i.productId || i.id,
          title: i.productName || i.name || (i.productId || i.id),
          qty: Number(i.quantity || i.qty || 1),
          price: Number(i.price || (i.subtotal && i.quantity ? (Number(i.subtotal)/Number(i.quantity)) : 0) || 0),
          shipAmount: (typeof i.ship !== 'undefined') ? Number(i.ship) : undefined,
          size: i.size || '',
          color: i.color || '',
          category: i.category || ''
        })).filter(it => it && it.id);
        try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {}
        window.location.href = 'checkout.html';
      });
    });
  } catch {}
  const filter = document.getElementById('status-filter');
  if (filter) filter.addEventListener('change', () => {
    const val = filter.value;
    const rows = Array.from(document.querySelectorAll('#orders-tbody tr'));
    rows.forEach(tr => {
      const status = (tr.children[2]?.textContent||'').toLowerCase();
      tr.style.display = (!val || status === val) ? '' : 'none';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => { renderOrders(); });
