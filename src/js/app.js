const routes = {
  dashboard: (root) => renderDashboard(root),
  documents: (root) => renderDocumentsList(root),
  customers: (root) => renderCustomers(root),
  products: (root) => renderProducts(root),
  settings: (root) => renderSettings(root),
  'document-editor': (root, params) => renderDocumentEditor(root, params)
};

function navigate(route, params) {
  const content = document.getElementById('content');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.route === route);
  });
  content.innerHTML = '';
  routes[route](content, params || {});
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function confirmDialog(message) {
  return window.confirm(message);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  (children || []).forEach(c => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function showApp(session) {
  document.getElementById('login-screen').hidden = true;
  const shell = document.getElementById('app-shell');
  shell.hidden = false;

  const sessionInfo = document.getElementById('session-info');
  sessionInfo.innerHTML = '';
  sessionInfo.appendChild(el('span', { class: 'email' }, [session.email]));
  sessionInfo.appendChild(el('span', {
    class: 'logout-link',
    onclick: async () => {
      await window.api.auth.logout();
      window.location.reload();
    }
  }, ['Logout']));

  navigate('dashboard');
}

function showLogin() {
  document.getElementById('app-shell').hidden = true;
  document.getElementById('login-screen').hidden = false;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.route));
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = (event.reason && event.reason.message) || 'Something went wrong.';
  showToast(/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(msg) ? 'No connection — check your internet and try again.' : msg);
});

initLogin(showApp);

if (window.api.updates) {
  window.api.updates.onStatus((data) => {
    if (data.status === 'available') showToast(`Update ${data.version} found — downloading...`);
    else if (data.status === 'ready') {
      showToast('Update downloaded — restarting to install...');
      setTimeout(() => window.api.updates.install(), 3000);
    }
    else if (data.status === 'error') { /* silent — don't alarm users over a background check failing */ }
  });
}

window.api.auth.getSession().then(session => {
  if (session) showApp(session);
  else showLogin();
});
