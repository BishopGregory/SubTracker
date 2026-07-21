// ---------------------------------------------------------------------------
// SubTracker config
// ---------------------------------------------------------------------------
// Paste your deployed Apps Script Web App URL below (Deploy > Manage deployments
// > copy the "Web app" URL) and flip USE_MOCK_DATA to false. See README.md.
const CONFIG = {
  WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbwKj0VLInTMGCY_T0v9sQTgh01R54uf3kFsIXllrpV1akL7AbHlMh74BCPWwEUwjIav/exec',
  USE_MOCK_DATA: false,
};

const BILLING_CYCLES = ['monthly', 'annual'];
const INTENDED_ACTIONS = ['renew', 'cancel', 'undecided'];
const STATUSES = ['active', 'expired', 'cancelled'];

// ---------------------------------------------------------------------------
// Mock data (used until CONFIG.USE_MOCK_DATA is set to false)
// ---------------------------------------------------------------------------
function mockToday(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let MOCK_SUBSCRIPTIONS = [
  {
    id: 'mock-1',
    vendor: 'Netflix',
    planNotes: 'Standard with ads',
    cost: 7.99,
    billingCycle: 'monthly',
    keyDate: mockToday(1),
    autoRenews: 'yes',
    intendedAction: 'renew',
    status: 'active',
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'mock-2',
    vendor: 'Adobe Creative Cloud',
    planNotes: 'Photography plan, annual',
    cost: 119.88,
    billingCycle: 'annual',
    keyDate: mockToday(7),
    autoRenews: 'yes',
    intendedAction: 'cancel',
    status: 'active',
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'mock-3',
    vendor: 'Local Newspaper Trial',
    planNotes: '3-month free trial',
    cost: 0,
    billingCycle: 'monthly',
    keyDate: mockToday(1),
    autoRenews: 'no',
    intendedAction: 'renew',
    status: 'active',
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'mock-4',
    vendor: 'Gym Membership',
    planNotes: 'Month-to-month, cancel anytime',
    cost: 45,
    billingCycle: 'monthly',
    keyDate: mockToday(45),
    autoRenews: 'yes',
    intendedAction: 'undecided',
    status: 'active',
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'mock-5',
    vendor: 'Old Hosting Plan',
    planNotes: 'Replaced by new provider',
    cost: 12,
    billingCycle: 'monthly',
    keyDate: mockToday(-10),
    autoRenews: 'no',
    intendedAction: 'cancel',
    status: 'cancelled',
    lastUpdated: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// API layer — swap-in point for the real Apps Script backend (task 4)
// ---------------------------------------------------------------------------
const Api = {
  async list() {
    if (CONFIG.USE_MOCK_DATA) return structuredClone(MOCK_SUBSCRIPTIONS);
    const res = await fetch(CONFIG.WEBAPP_URL);
    if (!res.ok) throw new Error('Failed to load subscriptions');
    const json = await res.json();
    return json.subscriptions || [];
  },

  async add(sub) {
    if (CONFIG.USE_MOCK_DATA) {
      const record = { ...sub, id: `mock-${Date.now()}`, lastUpdated: new Date().toISOString() };
      MOCK_SUBSCRIPTIONS.push(record);
      return record;
    }
    return postAction('add', sub);
  },

  async edit(id, sub) {
    if (CONFIG.USE_MOCK_DATA) {
      const idx = MOCK_SUBSCRIPTIONS.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error('Not found');
      MOCK_SUBSCRIPTIONS[idx] = { ...MOCK_SUBSCRIPTIONS[idx], ...sub, id, lastUpdated: new Date().toISOString() };
      return MOCK_SUBSCRIPTIONS[idx];
    }
    return postAction('edit', { ...sub, id });
  },

  async remove(id) {
    if (CONFIG.USE_MOCK_DATA) {
      MOCK_SUBSCRIPTIONS = MOCK_SUBSCRIPTIONS.filter((s) => s.id !== id);
      return { id };
    }
    return postAction('delete', { id });
  },
};

// Apps Script Web Apps answer CORS preflight (OPTIONS) requests inconsistently,
// so POSTs are sent as text/plain to avoid a preflight entirely (same trick
// used by the WestSUS app against the same backend pattern).
async function postAction(action, payload) {
  const res = await fetch(CONFIG.WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Date / formatting helpers
// ---------------------------------------------------------------------------
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCost(cost, cycle) {
  const amount = Number(cost) || 0;
  const suffix = cycle === 'annual' ? '/yr' : '/mo';
  return `$${amount.toFixed(2)}${suffix}`;
}

function urgencyLabel(days, status) {
  if (status === 'cancelled') return { text: 'Cancelled', cls: 'muted' };
  if (status === 'expired') return { text: 'Expired', cls: 'muted' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: 'danger' };
  if (days === 0) return { text: 'Today', cls: 'danger' };
  if (days <= 1) return { text: `${days}d left`, cls: 'danger' };
  if (days <= 7) return { text: `${days}d left`, cls: 'warning' };
  return { text: `${days}d left`, cls: 'ok' };
}

function reminderMessage(sub) {
  const date = formatDate(sub.keyDate);
  return sub.autoRenews === 'yes'
    ? `Cancel by ${date} to avoid being charged for ${sub.vendor}.`
    : `Renew by ${date} or you'll lose access to ${sub.vendor}.`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const state = { subscriptions: [], filter: 'active', editingId: null };

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const summaryEl = document.getElementById('summary');
const syncStatusEl = document.getElementById('sync-status');

function render() {
  const filtered = state.subscriptions
    .filter((s) => (state.filter === 'all' ? true : s.status === state.filter))
    .sort((a, b) => daysUntil(a.keyDate) - daysUntil(b.keyDate));

  listEl.innerHTML = '';
  emptyEl.hidden = filtered.length !== 0;

  for (const sub of filtered) {
    listEl.appendChild(renderCard(sub));
  }

  const active = state.subscriptions.filter((s) => s.status === 'active');
  const soon = active.filter((s) => {
    const d = daysUntil(s.keyDate);
    return d >= 0 && d <= 7;
  });
  summaryEl.textContent = `${active.length} active · ${soon.length} due within 7 days`;
}

function renderCard(sub) {
  const days = daysUntil(sub.keyDate);
  const urgency = urgencyLabel(days, sub.status);

  const card = document.createElement('article');
  card.className = 'card';

  card.innerHTML = `
    <div class="card-top">
      <div>
        <h3 class="vendor">${escapeHtml(sub.vendor)}</h3>
        ${sub.planNotes ? `<p class="notes">${escapeHtml(sub.planNotes)}</p>` : ''}
      </div>
      <span class="pill ${urgency.cls}">${urgency.text}</span>
    </div>
    <div class="card-meta">
      <span>${formatCost(sub.cost, sub.billingCycle)}</span>
      <span>&middot;</span>
      <span>${sub.billingCycle === 'annual' ? 'Annual' : 'Monthly'}</span>
      <span>&middot;</span>
      <span>Key date ${formatDate(sub.keyDate)}</span>
    </div>
    <div class="card-meta secondary">
      <span class="tag">${sub.autoRenews === 'yes' ? 'Auto-renews' : 'No auto-renew'}</span>
      <span class="tag">Intent: ${sub.intendedAction}</span>
      <span class="tag status-${sub.status}">${sub.status}</span>
    </div>
    <div class="card-actions">
      <button class="btn-text" data-action="edit">Edit</button>
      <button class="btn-text danger" data-action="delete">Delete</button>
    </div>
  `;

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openModal(sub));
  card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDelete(sub));

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Load / refresh
// ---------------------------------------------------------------------------
async function loadSubscriptions() {
  syncStatusEl.textContent = 'Syncing…';
  try {
    state.subscriptions = await Api.list();
    syncStatusEl.textContent = CONFIG.USE_MOCK_DATA
      ? 'Using mock data'
      : `Synced ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error(err);
    syncStatusEl.textContent = 'Sync failed — showing last known data';
  }
  render();
}

// ---------------------------------------------------------------------------
// Add / edit modal
// ---------------------------------------------------------------------------
const modal = document.getElementById('modal');
const form = document.getElementById('sub-form');

function openModal(sub) {
  state.editingId = sub ? sub.id : null;
  document.getElementById('modal-title').textContent = sub ? 'Edit subscription' : 'Add subscription';

  form.vendor.value = sub?.vendor ?? '';
  form.planNotes.value = sub?.planNotes ?? '';
  form.cost.value = sub?.cost ?? '';
  form.billingCycle.value = sub?.billingCycle ?? 'monthly';
  form.keyDate.value = sub?.keyDate ?? new Date().toISOString().slice(0, 10);
  form.autoRenews.value = sub?.autoRenews ?? 'yes';
  form.intendedAction.value = sub?.intendedAction ?? 'undecided';
  form.status.value = sub?.status ?? 'active';

  document.getElementById('delete-btn').hidden = !sub;
  modal.showModal();
}

function closeModal() {
  modal.close();
  form.reset();
  state.editingId = null;
}

document.getElementById('add-btn').addEventListener('click', () => openModal(null));
document.getElementById('cancel-btn').addEventListener('click', closeModal);

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!state.editingId) return;
  const sub = state.subscriptions.find((s) => s.id === state.editingId);
  closeModal();
  if (sub) await handleDelete(sub);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    vendor: form.vendor.value.trim(),
    planNotes: form.planNotes.value.trim(),
    cost: parseFloat(form.cost.value) || 0,
    billingCycle: form.billingCycle.value,
    keyDate: form.keyDate.value,
    autoRenews: form.autoRenews.value,
    intendedAction: form.intendedAction.value,
    status: form.status.value,
  };

  if (!payload.vendor || !payload.keyDate) return;

  try {
    if (state.editingId) {
      await Api.edit(state.editingId, payload);
    } else {
      await Api.add(payload);
    }
    closeModal();
    await loadSubscriptions();
  } catch (err) {
    console.error(err);
    alert('Could not save subscription. Check your connection and try again.');
  }
});

async function handleDelete(sub) {
  if (!confirm(`Delete ${sub.vendor}? This can't be undone.`)) return;
  try {
    await Api.remove(sub.id);
    await loadSubscriptions();
  } catch (err) {
    console.error(err);
    alert('Could not delete subscription. Check your connection and try again.');
  }
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    render();
  });
});

document.getElementById('refresh-btn').addEventListener('click', loadSubscriptions);

// ---------------------------------------------------------------------------
// Service worker (offline shell caching only — see README re: push)
// ---------------------------------------------------------------------------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('./sw.js');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await registerServiceWorker();
  await loadSubscriptions();
})();
