(function(){
"use strict";

/* ======================================================================
   CONFIG — edit these two lines for your business
   ====================================================================== */
var WHATSAPP_NUMBER = "919363719509"; // WhatsApp: all "Order" / "Chat with us" / support messages go here
var BRAND_NAME = "Antholytix AI";
var MOBILE_BREAKPOINT = 880;
// Set by the Flask template (empty string = same origin). Falls back to same-origin
// relative calls even if the template var is missing (e.g. opened as a static file).
var API_BASE = (typeof window.ANTHOLYTIX_API_BASE === 'string' && window.ANTHOLYTIX_API_BASE) || '';
var API_AVAILABLE = null; // becomes true/false after the first live request settles

/* ======================================================================
   UTILITIES
   ====================================================================== */
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
function el(html){ var t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
function isMobile(){ return window.matchMedia('(max-width:'+MOBILE_BREAKPOINT+'px)').matches; }
function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmtDate(d){
  if(!(d instanceof Date) || isNaN(d)) return "—";
  var months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate()+" "+months[d.getMonth()]+" "+d.getFullYear();
}
function daysBetween(a,b){ return Math.round((b.setHours(0,0,0,0)-a.setHours(0,0,0,0))/86400000); }
function addDays(base, n){ var d=new Date(base); d.setDate(d.getDate()+n); return d; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

function toast(msg, icon){
  var mount = qs('#toast-mount');
  var t = el('<div class="toast">'+(icon||'')+'<span></span></div>');
  qs('span',t).textContent = msg;
  mount.appendChild(t);
  setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .3s ease'; setTimeout(function(){ t.remove(); }, 300); }, 2600);
}

function openModal(innerHtml, extraClass){
  var mount = qs('#modal-mount');
  mount.innerHTML = '<div class="modal' + (extraClass ? ' ' + extraClass : '') + '">'+innerHtml+'</div>';
  mount.classList.add('open');
  qsa('[data-close-modal]', mount).forEach(function(b){ b.addEventListener('click', closeModal); });
  mount.onclick = function(e){ if(e.target === mount) closeModal(); };
}
function closeModal(){
  var mount = qs('#modal-mount');
  mount.classList.remove('open');
  setTimeout(function(){ mount.innerHTML=''; }, 200);
  stopDemoQrRefresh();
}

function whatsappLink(message){
  return 'https://wa.me/'+WHATSAPP_NUMBER+'?text='+encodeURIComponent(message);
}

/* ======================================================================
   DATA — product catalogue (the labels themselves, for the Shop)
   ====================================================================== */
var SHOP_PRODUCTS = [
  {
    id:'starter-20',
    name:'Starter Pack — 20 Labels',
    desc:'A ready-to-use box of 20 anthocyanin indicator labels with unique QR codes, for home kitchens and small stalls.',
    price:'₹349',
    unit:'per box of 20',
    gradient:['var(--spec-1)','var(--spec-2)']
  },
  {
    id:'retail-100',
    name:'Retail Pack — 100 Labels',
    desc:'Bulk-priced roll for grocers and dairies. Each label is individually coded and tamper-linked to your product batch.',
    price:'₹1,499',
    unit:'per roll of 100',
    gradient:['var(--spec-2)','var(--spec-3)']
  },
  {
    id:'cold-chain-250',
    name:'Cold-Chain Pack — 250 Labels',
    desc:'Higher pigment sensitivity tuned for chilled dairy, meat and seafood — the same indicator used in this scanner\'s demo.',
    price:'₹3,299',
    unit:'per case of 250',
    gradient:['var(--spec-3)','var(--spec-4)']
  },
  {
    id:'custom-batch',
    name:'Custom Batch Order',
    desc:'Print your company name, product line and QR batch range on the label. Minimum order 1,000 units.',
    price:'Get a quote',
    unit:'custom pricing',
    gradient:['var(--spec-4)','var(--spec-5)']
  }
];

/* ======================================================================
   DATA — demo product/QR database (simulates what a real backend would return)
   Dates are generated relative to *today* so the demo always makes sense.
   ====================================================================== */
var PRODUCT_DB = {};
(function seedDb(){
  var today = new Date();
  function rec(code, name, company, qty, mfgOffset, expOffset){
    PRODUCT_DB[code] = {
      code: code, name: name, company: company, qty: qty,
      mfg: addDays(today, mfgOffset),
      exp: addDays(today, expOffset)
    };
  }
  rec('K7#9-QD4$-N2!B-8XM6', 'Fresh Paneer, 200 g', 'Antholytix AI Foods Pvt. Ltd.', '200 g', -6, 8);
  rec('B3$M-8K!Q-7N#D-Z1V4', 'Greek Yogurt Cup', 'Antholytix AI Foods Pvt. Ltd.', '150 g', -20, -2);
  rec('R5!P-2X$K-9M#B-Q7C3', 'Chicken Mince, 500 g', 'Antholytix AI Foods Pvt. Ltd.', '500 g', -2, 1);
  rec('T8@L-4V%R-1J&Y-5PS2', 'Whole Milk, 1 L', 'Antholytix AI Foods Pvt. Ltd.', '1 L', -1, 5);
})();
var DEMO_CODES = Object.keys(PRODUCT_DB);

/* ======================================================================
   ANTHOCYANIN pH → FRESHNESS MODEL  (mirrors ColorAnalyzer.kt)
   ====================================================================== */
function classifyPigment(h, s, v){
  if (s < 0.15 || v < 0.15){
    return { state:'caution', ph:'pH unclear', label:'Low colour signal', desc:'Hold the label flatter and move to brighter, even light.' };
  }
  if ((h >= 330 || h < 30) && s > 0.3){
    return { state:'safe', ph:'pH 1–4', label:'Red / Pink', desc:'Acidic pigment reading — consistent with a fresh product.' };
  }
  if (h >= 270 && h < 330){
    return { state:'safe', ph:'pH 5–6', label:'Purple', desc:'Slightly acidic pigment reading — consistent with a fresh product.' };
  }
  if (h >= 200 && h < 270){
    return { state:'caution', ph:'pH 7–8', label:'Blue', desc:'Near-neutral pigment reading — quality is turning, consume soon.' };
  }
  if (h >= 90 && h < 200){
    return { state:'danger', ph:'pH 9–10', label:'Green', desc:'Basic pigment reading — spoilage compounds detected.' };
  }
  if (h >= 45 && h < 90){
    return { state:'danger', ph:'pH 11+', label:'Yellow', desc:'Strongly basic pigment reading — do not consume.' };
  }
  return { state:'caution', ph:'pH unclear', label:'Unclassified', desc:'Reading was inconclusive — try scanning again.' };
}

function rankState(s){ return s==='danger'?2 : s==='caution'?1 : 0; }
function worstState(a,b){ return rankState(a)>=rankState(b) ? a : b; }
function stateMeta(s){
  return s==='safe' ? {label:'Safe to consume', color:'safe'} :
         s==='caution' ? {label:'Consume soon', color:'caution'} :
         {label:'Do not consume', color:'danger'};
}

/* ======================================================================
   AUTH — account state, token storage, and an authenticated fetch() wrapper.
   Scan history and notifications are only ever loaded when signed in, and
   the backend itself scopes /scan/history to the token's own user, so one
   person never sees another's scans.
   ====================================================================== */
var AUTH_KEY = 'antholytix_auth_v1';
var THEME_KEY = 'antholytix_theme';

function getAuth(){
  try{ return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch(e){ return null; }
}
function setAuth(data){ localStorage.setItem(AUTH_KEY, JSON.stringify(data)); }
function clearAuth(){ localStorage.removeItem(AUTH_KEY); }
function isLoggedIn(){ var a = getAuth(); return !!(a && a.token); }

function authFetch(path, opts){
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  var auth = getAuth();
  if (auth && auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  return fetch(API_BASE + path, Object.assign({}, opts, { headers: headers }))
    .then(function(res){
      if (res.status === 401){ clearAuth(); refreshAuthUi(); }
      return res;
    });
}

// Cache of the last successful server history fetch, reused by Search/Notifications
// so they don't each fire their own network request.
var HistoryCache = [];
function fetchServerHistory(){
  if (!isLoggedIn()) return Promise.resolve([]);
  return authFetch('/scan/history')
    .then(function(res){ return res.ok ? res.json() : null; })
    .then(function(data){
      if (data && data.success){ HistoryCache = data.scans || []; return HistoryCache; }
      return [];
    })
    .catch(function(){ return []; });
}

function isAdminUser(){
  var a = getAuth();
  return !!(a && (a.is_admin || (a.user && a.user.is_admin)));
}

function refreshAdminNav(){
  var nav = qs('#nav-admin');
  if (nav){
    nav.style.display = isAdminUser() ? 'flex' : 'none';
  }
}

function syncCurrentUserRole(){
  if (!isLoggedIn()) return Promise.resolve(null);
  return authFetch('/account/me')
    .then(function(res){ return res.ok ? res.json() : null; })
    .then(function(data){
      if (data && data.success && data.user){
        var a = getAuth();
        if (a){
          a.is_admin = !!data.user.is_admin;
          if (data.user.name) a.name = data.user.name;
          setAuth(a);
          refreshAdminNav();
          paintAccountButton();
          return a;
        }
      }
      return null;
    })
    .catch(function(){ return null; });
}

/* Re-renders whatever's currently on screen that depends on login state —
   called right after sign-in, sign-out, or a token expiring mid-session. */
function refreshAuthUi(){
  paintAccountButton();
  refreshAdminNav();
  var r = currentRoute();
  if (r === 'home' || r === 'history') render(r);
  else if (r === 'admin'){
    if (!isAdminUser()) navigate('home');
    else render('admin');
  }
}

function paintAccountButton(){
  var btn = qs('#btn-avatar');
  if (!btn) return;
  var auth = getAuth();
  if (auth && auth.name){
    btn.textContent = auth.name.trim().split(/\s+/).map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
  } else {
    btn.textContent = '?';
  }
}

/* ======================================================================
   THEME — preference is 'light' | 'dark' | 'system' (default: system).
   The applied theme (what's actually on <html data-theme>) resolves
   'system' against the OS setting live, including if the OS changes
   while the app is open.
   ====================================================================== */
function getThemePref(){
  try{ var v = localStorage.getItem(THEME_KEY); return (v === 'light' || v === 'dark') ? v : 'system'; }
  catch(e){ return 'system'; }
}
function systemPrefersDark(){ return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function getTheme(){ return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

function applyThemeFromPref(){
  var pref = getThemePref();
  var applied = pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', applied);
  var sun = qs('#theme-icon-sun'), moon = qs('#theme-icon-moon');
  if (sun && moon){ sun.style.display = applied === 'dark' ? 'none' : 'block'; moon.style.display = applied === 'dark' ? 'block' : 'none'; }
}
function setThemePref(pref){
  try{ localStorage.setItem(THEME_KEY, pref); }catch(e){}
  applyThemeFromPref();
}
// Quick topbar toggle: always sets an explicit choice (never lands back on "system").
function toggleTheme(){ setThemePref(getTheme() === 'dark' ? 'light' : 'dark'); }

if (window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
    if (getThemePref() === 'system') applyThemeFromPref();
  });
}

/* ======================================================================
   ICONS (inline, reused)
   ====================================================================== */
var ICON = {
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  cross:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  scan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3m12-4v3a1 1 0 0 1-1 1h-3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
  droplet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s7 7.2 7 11.5A7 7 0 0 1 5 14.5C5 10.2 12 3 12 3Z"/></svg>',
  qr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 7.5 12 3 3.5 7.5 12 12l8.5-4.5Z"/><path d="M3.5 7.5v9L12 21l8.5-4.5v-9"/><path d="M12 12v9"/></svg>',
  whatsapp:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.02 2C6.5 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.1-1.33A9.96 9.96 0 0 0 12.02 22C17.5 22 22 17.52 22 12S17.5 2 12.02 2Zm5.78 14.13c-.24.68-1.38 1.3-1.9 1.35-.5.06-1.02.28-3.4-.71-2.9-1.2-4.76-4.1-4.9-4.29-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.02-2.42.27-.29.58-.36.78-.36.2 0 .39.002.56.01.18.008.42-.07.66.5.24.58.83 2.01.9 2.16.07.15.12.33.02.52-.1.19-.15.31-.3.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.15.46.13.63-.08.17-.2.72-.84.91-1.13.19-.29.38-.24.63-.14.26.1 1.64.77 1.92.91.28.15.47.22.53.34.07.13.07.72-.17 1.4Z"/></svg>',
  starter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  palette:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><path d="M12 21a2 2 0 0 1-2-2c0-.8.4-1.3.8-1.8.3-.4.5-.7.5-1.2a1.5 1.5 0 0 0-1.5-1.5H8a5 5 0 0 1 0-10"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  chevron:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
};

/* ======================================================================
   ROUTER
   ====================================================================== */
var ROUTES = ['home','scan','products','history','about','settings','admin'];
var TITLES = {
  home:{t:'Home', s:'Welcome back'},
  scan:{t:'Scan a label', s:'Pigment + QR check'},
  products:{t:'Shop labels', s:'Order on WhatsApp'},
  history:{t:'Scan history', s:'Your last 50 scans'},
  about:{t:'Guide', s:'The science on your label'},
  settings:{t:'Settings', s:'Your account & preferences'},
  admin:{t:'Admin Dashboard', s:'Overview, users & registered labels'}
};

function currentRoute(){
  var h = location.hash.replace('#/','').split('?')[0];
  if (ROUTES.indexOf(h) >= 0) return h;
  var p = (location.pathname || '').replace(/\/+$/, '');
  if (p === '/admin') return 'admin';
  return 'home';
}

function navigate(route){
  if (location.hash !== '#/'+route) { location.hash = '#/'+route; }
  else { render(route); }
}

function render(route){
  qsa('.view').forEach(function(v){ v.classList.toggle('active', v.dataset.view === route); });
  qsa('[data-route]').forEach(function(n){ n.classList.toggle('active', n.dataset.route === route); });
  qs('#topbar-title').textContent = (TITLES[route] || TITLES.home).t;
  qs('#topbar-sub').textContent = (TITLES[route] || TITLES.home).s;

  if (route !== 'scan') stopScanEngine();

  if (route === 'home') renderHome();
  else if (route === 'scan') renderScan();
  else if (route === 'products') renderProducts();
  else if (route === 'history') renderHistory();
  else if (route === 'about') renderAbout();
  else if (route === 'settings') renderSettings();
  else if (route === 'admin') renderAdmin();

  window.scrollTo({top:0, behavior:'instant' in window ? 'instant' : 'auto'});
}

window.addEventListener('hashchange', function(){ render(currentRoute()); });

/* ======================================================================
   VIEW: HOME
   ====================================================================== */
function renderHome(){
  var host = qs('#view-home');
  var loggedIn = isLoggedIn();

  host.innerHTML =
  '<section class="hero-card">'+
    '<div class="hero-inner">'+
      '<span class="hero-eyebrow"><span class="dot"></span> Indicator active — ready to scan</span>'+
      '<h1 class="hero-title">Know what\'s inside before you open it.</h1>'+
      '<p class="hero-body">Point your phone at the pigment strip and QR code on any '+BRAND_NAME+' label to verify freshness and authenticity in under ten seconds.</p>'+
      '<div class="hero-actions">'+
        '<a class="btn btn-primary btn-lg" href="#/scan">'+ICON.scan+' Scan a label</a>'+
        '<a class="btn btn-ghost btn-lg" href="#/about">See how it works</a>'+
      '</div>'+
    '</div>'+
  '</section>'+

  '<div class="grid grid-4" id="home-stats"></div>'+

  '<div class="dash-grid">'+
    '<div class="card">'+
      '<div class="card-head"><h3>Pigment → pH spectrum</h3><span class="card-tag">Live reference</span></div>'+
      '<div class="spectrum-bar"></div>'+
      '<div class="spectrum-labels"><span>Red · pH 1–4</span><span>Purple · 5–6</span><span>Blue · 7–8</span><span>Green · 9–10</span><span>Yellow · 11+</span></div>'+
      '<p class="muted" style="font-size:12.5px; margin-top:16px; line-height:1.6;">Every label\'s pigment strip is a strip of red-cabbage-derived anthocyanin. As a product ages, its surface pH drifts and the pigment shifts along this exact spectrum — the scanner reads that shift directly off the strip.</p>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-head"><h3>Recent scans</h3><a href="#/history" class="card-tag" style="cursor:pointer;">View all</a></div>'+
      '<div class="scanlist" id="home-recent"></div>'+
    '</div>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>From the shop</h3><a href="#/products" class="card-tag" style="cursor:pointer;">Browse all</a></div>'+
    '<div class="grid grid-4" id="home-products"></div>'+
  '</div>';

  qs('#home-products').innerHTML = SHOP_PRODUCTS.slice(0,4).map(function(p){ return miniProductHtml(p); }).join('');
  qsa('[data-whatsapp]', host).forEach(bindWhatsappButton);

  if (!loggedIn){
    qs('#home-stats').innerHTML = [
      lockedStatTile(ICON.scan, 'var(--spec-3)', 'Total scans logged'),
      lockedStatTile(ICON.check, 'var(--safe)', 'Marked safe to consume'),
      statTile(ICON.qr,'var(--spec-2)', DEMO_CODES.length, 'Registered demo labels'),
      statTile(ICON.box,'var(--spec-5)', SHOP_PRODUCTS.length, 'Label packs in shop')
    ].join('');
    qs('#home-recent').innerHTML = signInPrompt('See your recent scans', 'Sign in to keep a history of what you\'ve scanned.');
    bindSignInPrompts(host);
    return;
  }

  qs('#home-recent').innerHTML = '<div class="empty">'+ICON.clock+'<div style="font-weight:700; color:var(--ink);">Loading…</div></div>';
  fetchServerHistory().then(function(hist){
    var rows = hist.map(normalizeScan);
    var safeCount = rows.filter(function(h){return h.overall==='safe';}).length;
    var pct = rows.length ? Math.round(safeCount/rows.length*100) : 0;

    qs('#home-stats').innerHTML = [
      statTile(ICON.scan,'var(--spec-3)', rows.length, 'Total scans logged'),
      statTile(ICON.check,'var(--safe)', pct+'%', 'Marked safe to consume'),
      statTile(ICON.qr,'var(--spec-2)', DEMO_CODES.length, 'Registered demo labels'),
      statTile(ICON.box,'var(--spec-5)', SHOP_PRODUCTS.length, 'Label packs in shop')
    ].join('');

    var recentHost = qs('#home-recent');
    if (recentHost) recentHost.innerHTML = rows.length
      ? rows.slice(0,4).map(scanRowHtml).join('')
      : emptyState(ICON.clock, 'No scans yet', 'Your scan results will show up here.');
  });
}

/* Server scans come back nested (label sub-object); scanRowHtml() expects a
   flat shape — this adapts one to the other in one place. */
function normalizeScan(h){
  return {
    hex: h.color_hex || '#9a979a',
    name: (h.label && h.label.name) || h.code || 'Unrecognised code',
    ph: h.ph_estimate || '—',
    overall: h.overall || 'caution',
    when: h.created_at
  };
}

function lockedStatTile(icon, color, label){
  return '<div class="stat-tile"><div class="stat-top"><div class="stat-icon" style="background:'+color+'22; color:'+color+';">'+icon+'</div></div>'+
    '<div class="stat-num faint" style="font-size:16px;">—</div><div class="stat-label">'+label+' <a href="#" data-open-auth style="text-decoration:underline; color:var(--ink-soft);">Sign in</a></div></div>';
}

function signInPrompt(title, body){
  return '<div class="empty">'+ICON.box+'<div style="font-weight:700; color:var(--ink);">'+title+'</div>'+
    '<div style="font-size:12.5px;">'+body+'</div>'+
    '<button class="btn btn-dark" data-open-auth style="margin-top:6px;">Sign in</button></div>';
}

function bindSignInPrompts(host){
  qsa('[data-open-auth]', host).forEach(function(el){
    el.addEventListener('click', function(e){ e.preventDefault(); openAuthModal(); });
  });
}

function statTile(icon, color, num, label){
  return '<div class="stat-tile"><div class="stat-top"><div class="stat-icon" style="background:'+color+'22; color:'+color+';">'+icon+'</div></div>'+
    '<div class="stat-num">'+num+'</div><div class="stat-label">'+label+'</div></div>';
}

function scanRowHtml(h){
  return '<div class="scanrow"><div class="swatch" style="background:'+h.hex+';"></div>'+
    '<div class="scanrow-body"><div class="scanrow-title">'+escapeHtml(h.name)+'</div>'+
    '<div class="scanrow-meta">'+h.ph+' · '+timeAgo(h.when)+'</div></div>'+
    '<span class="badge '+h.overall+'"><span class="dot"></span>'+stateMeta(h.overall).label+'</span></div>';
}

function timeAgo(iso){
  var d = new Date(iso), diff = Math.max(0, Math.round((Date.now()-d.getTime())/3600000));
  if (diff < 1) return 'just now';
  if (diff < 24) return diff+'h ago';
  return Math.round(diff/24)+'d ago';
}

function miniProductHtml(p){
  return '<div class="product-card">'+
    '<div class="product-swatch" style="background:linear-gradient(135deg,'+p.gradient[0]+','+p.gradient[1]+');"><div class="qr-chip">'+ICON.qr+'</div></div>'+
    '<div class="product-name">'+escapeHtml(p.name)+'</div>'+
    '<div class="product-foot"><div class="product-price">'+p.price+'<span>'+p.unit+'</span></div>'+
    '<button class="btn btn-whatsapp" data-whatsapp="'+p.id+'" aria-label="Order '+escapeHtml(p.name)+' on WhatsApp">'+ICON.whatsapp+'</button></div>'+
  '</div>';
}

function emptyState(icon, title, body){
  return '<div class="empty">'+icon+'<div style="font-weight:700; color:var(--ink);">'+title+'</div><div style="font-size:12.5px;">'+body+'</div></div>';
}

function bindWhatsappButton(btn){
  btn.addEventListener('click', function(){
    var id = btn.dataset.whatsapp;
    var p = SHOP_PRODUCTS.filter(function(x){return x.id===id;})[0];
    if (!p) return;
    var msg = "Hi "+BRAND_NAME+"! I'm interested in buying the \""+p.name+"\" ("+p.unit+"). Could you share availability and delivery details?";
    window.open(whatsappLink(msg), '_blank', 'noopener');
  });
}

/* ======================================================================
   VIEW: PRODUCTS (Shop)
   ====================================================================== */
function renderProducts(){
  var host = qs('#view-products');
  host.innerHTML =
  '<section class="card" style="display:flex; align-items:center; gap:18px; flex-wrap:wrap;">'+
    '<div style="flex:1; min-width:220px;">'+
      '<h2 style="font-size:20px;">Order genuine '+BRAND_NAME+' labels</h2>'+
      '<p class="muted" style="font-size:13px; margin-top:6px; max-width:460px; line-height:1.6;">Every pack ships with pre-printed pigment strips and unique 16-character QR codes, ready to apply to your products. Tap a pack to message us directly on WhatsApp — no forms, no waiting.</p>'+
    '</div>'+
    '<div class="badge safe" style="font-size:12px;"><span class="dot"></span>Replies usually within the day</div>'+
  '</section>'+
  '<div class="grid grid-4" id="products-grid"></div>'+
  '<section class="card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">'+
    '<div class="stat-icon" style="width:44px;height:44px;background:var(--whatsapp)22;color:var(--whatsapp);">'+ICON.whatsapp+'</div>'+
    '<div style="flex:1; min-width:200px;"><h3 style="font-size:15px;">Not sure which pack fits your business?</h3><p class="muted" style="font-size:12.5px; margin-top:2px;">Send us a message and we\'ll recommend a pack based on your product line and storage conditions.</p></div>'+
    '<button class="btn btn-whatsapp" id="chat-general">'+ICON.whatsapp+' Chat with us</button>'+
  '</section>';

  qs('#products-grid').innerHTML = SHOP_PRODUCTS.map(function(p){
    return '<div class="product-card">'+
      '<div class="product-swatch" style="background:linear-gradient(135deg,'+p.gradient[0]+','+p.gradient[1]+');"><div class="qr-chip">'+ICON.qr+'</div></div>'+
      '<div class="product-name">'+escapeHtml(p.name)+'</div>'+
      '<div class="product-desc">'+escapeHtml(p.desc)+'</div>'+
      '<div class="product-foot"><div class="product-price">'+p.price+'<span>'+p.unit+'</span></div>'+
      '<button class="btn btn-whatsapp" data-whatsapp="'+p.id+'">'+ICON.whatsapp+' Order</button></div>'+
    '</div>';
  }).join('');

  qsa('[data-whatsapp]', host).forEach(bindWhatsappButton);
  qs('#chat-general').addEventListener('click', function(){
    window.open(whatsappLink("Hi "+BRAND_NAME+"! I'd like some help choosing a label pack for my products."), '_blank', 'noopener');
  });
}

/* ======================================================================
   VIEW: HISTORY
   ====================================================================== */
function renderHistory(){
  var host = qs('#view-history');

  if (!isLoggedIn()){
    host.innerHTML =
    '<div class="card">'+ signInPrompt('Sign in to see your scan history', 'Your scans are tied to your account, so only you can see them — sign in to pick up where you left off.') +'</div>';
    bindSignInPrompts(host);
    return;
  }

  host.innerHTML =
  '<section class="card" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">'+
    '<div style="flex:1; min-width:200px;"><h2 style="font-size:19px;">Your scan history</h2><p class="muted" style="font-size:12.5px; margin-top:3px;">Kept on your account — your last 50 scans, visible only to you.</p></div>'+
  '</section>'+
  '<div class="card"><div class="scanlist" id="history-list"></div></div>';

  var list = qs('#history-list');
  list.innerHTML = '<div class="empty">'+ICON.clock+'<div style="font-weight:700; color:var(--ink);">Loading…</div></div>';
  fetchServerHistory().then(function(hist){
    var rows = hist.map(normalizeScan);
    list.innerHTML = rows.length ? rows.map(scanRowHtml).join('') : emptyState(ICON.clock, 'Nothing scanned yet', 'Scan a label to start building your history.');
  });
}

/* ======================================================================
   VIEW: ABOUT / HOW IT WORKS
   ====================================================================== */
function renderAbout(){
  var host = qs('#view-about');
  host.innerHTML =
  '<section class="hero-card">'+
    '<div class="hero-inner">'+
      '<span class="hero-eyebrow"><span class="dot"></span> The science, in plain terms</span>'+
      '<h1 class="hero-title">One label, two checks: freshness and authenticity.</h1>'+
      '<p class="hero-body">Anthocyanin is a natural pigment that changes colour as pH shifts — the same reaction you see when red cabbage juice turns from pink to green. Your label prints a strip of it next to a QR code, so a single scan checks both the product\'s chemistry and its identity.</p>'+
    '</div>'+
  '</section>'+
  '<div class="grid grid-2" id="about-steps"></div>'+
  '<div class="card"><div class="card-head"><h3>What\'s printed on every label</h3></div><div class="grid grid-4" id="about-parts"></div></div>'+
  '<div class="card"><div class="card-head"><h3>Pigment colour guide</h3><span class="card-tag">Reference</span></div>'+
    '<div class="spectrum-bar"></div><div class="spectrum-labels"><span>Red/Pink</span><span>Purple</span><span>Blue</span><span>Green</span><span>Yellow</span></div>'+
    '<table style="width:100%; margin-top:18px; border-collapse:collapse; font-size:12.5px;">'+
      '<thead><tr style="text-align:left; color:var(--ink-faint);"><th style="padding:8px 4px; font-weight:600;">Colour</th><th style="padding:8px 4px; font-weight:600;">pH range</th><th style="padding:8px 4px; font-weight:600;">Verdict</th></tr></thead>'+
      '<tbody>'+
        aboutRow('#c23e86','Red / Pink','1 – 4','Safe to consume')+
        aboutRow('#7c4fc9','Purple','5 – 6','Safe to consume')+
        aboutRow('#3f70da','Blue','7 – 8','Consume soon')+
        aboutRow('#3f9142','Green','9 – 10','Do not consume')+
        aboutRow('#d9a62e','Yellow','11+','Do not consume')+
      '</tbody></table>'+
  '</div>'+

  '<section class="hero-card" style="background:linear-gradient(120deg,#1c1e21,#15171a 45%,#1a2024);">'+
    '<div class="hero-inner">'+
      '<span class="hero-eyebrow"><span class="dot"></span> Deep dive</span>'+
      '<h1 class="hero-title" style="font-size:23px;">The chemistry behind the colour change</h1>'+
      '<p class="hero-body">Anthocyanins are natural pH indicators — the same class of chemistry as litmus, just plant-derived. Here\'s the actual mechanism, with the compounds, formulae and reference numbers behind it.</p>'+
    '</div>'+
  '</section>'+

  '<div class="card">'+
    '<div class="card-head"><h3>What is a natural pH indicator?</h3></div>'+
    '<p class="muted" style="font-size:13px; line-height:1.7;">A pH indicator is a compound whose molecular structure reversibly changes — usually by gaining or losing a proton (H⁺) — as the surrounding pH shifts, and each structural form absorbs light differently, which is what we see as a colour change. Natural (plant-derived) indicators aren\'t a lab invention; they\'re pigments doing this constantly in nature. A few common ones:</p>'+
    '<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12.5px;">'+
      '<thead><tr style="text-align:left; color:var(--ink-faint);"><th style="padding:8px 4px; font-weight:600;">Indicator</th><th style="padding:8px 4px; font-weight:600;">Natural source</th><th style="padding:8px 4px; font-weight:600;">Colour shift</th><th style="padding:8px 4px; font-weight:600;">Approx. pH range</th></tr></thead>'+
      '<tbody>'+
        indicatorRow('Anthocyanins','Red cabbage, berries, grape skin','Red → purple → blue → green → yellow','1 – 13')+
        indicatorRow('Curcumin','Turmeric root','Yellow → red-brown','~7.4 – 8.6')+
        indicatorRow('Betalains','Beetroot, dragon fruit','Red-violet → yellow (degrades, doesn\'t reverse cleanly)','4 – 10')+
        indicatorRow('Azolitmin (litmus)','Lichen extract','Red → blue','4.5 – 8.3')+
      '</tbody></table>'+
    '<p class="faint" style="font-size:11.5px; margin-top:10px;">Antholytix AI labels use anthocyanins specifically because their transition spans almost the whole practical pH range relevant to food spoilage, in one continuous, reversible gradient.</p>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Anthocyanin extract: what it actually is</h3></div>'+
    '<p class="muted" style="font-size:13px; line-height:1.7;">Anthocyanins are water-soluble flavonoids — a subclass of plant polyphenols — built on a common C6-C3-C6 backbone called the <strong>flavylium cation</strong> (2-phenylchromenylium). In the plant, they exist as glycosides (sugar-bound); the sugar-free pigment core is called an <strong>anthocyanidin</strong>. The extract used on the label is a concentrated anthocyanidin/anthocyanin mixture, typically drawn from red cabbage or a similar source. Six anthocyanidins account for almost everything you see in nature — they differ only in the hydroxyl (–OH) and methoxy (–OCH₃) groups on the B-ring:</p>'+
    '<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">'+
      '<thead><tr style="text-align:left; color:var(--ink-faint);"><th style="padding:7px 4px; font-weight:600;">Anthocyanidin</th><th style="padding:7px 4px; font-weight:600;">Formula</th><th style="padding:7px 4px; font-weight:600;">MW (g/mol)</th><th style="padding:7px 4px; font-weight:600;">Colour (acidic)</th></tr></thead>'+
      '<tbody>'+
        compoundRow('Pelargonidin','C₁₅H₁₁O₅⁺','271.2','Orange-red')+
        compoundRow('Cyanidin','C₁₅H₁₁O₆⁺','287.2','Red')+
        compoundRow('Delphinidin','C₁₅H₁₁O₇⁺','303.2','Bluish red')+
        compoundRow('Peonidin','C₁₆H₁₃O₆⁺','301.3','Red')+
        compoundRow('Petunidin','C₁₆H₁₃O₇⁺','317.3','Purple')+
        compoundRow('Malvidin','C₁₇H₁₅O₇⁺','331.3','Purple')+
      '</tbody></table>'+
    '<div style="margin-top:18px; background:var(--panel); border-radius:16px; padding:16px; text-align:center;" id="flavylium-diagram"></div>'+
    '<p class="faint" style="font-size:11px; margin-top:8px; text-align:center;">Simplified flavylium cation skeleton — the shared core of all six anthocyanidins above (not to scale; substituent positions illustrative). The A- and B-rings carry the –OH/–OCH₃ groups that distinguish them; the positive charge sits on the central pyrylium oxygen.</p>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Why the colour actually shifts with pH</h3></div>'+
    '<p class="muted" style="font-size:13px; line-height:1.7;">The flavylium cation isn\'t a fixed molecule — in water it sits in equilibrium with three other structural forms, and which one dominates depends on pH. Each form absorbs a different part of the visible spectrum, which is the entire mechanism behind the label\'s colour change:</p>'+
    '<div id="equilibrium-flow" style="margin-top:14px;"></div>'+
    '<p class="faint" style="font-size:11.5px; margin-top:12px; line-height:1.6;">Reference equilibrium constants for a common anthocyanin (cyanidin-3-glucoside) are roughly pKₐ ≈ 4.4 for the flavylium ⇌ quinoidal proton loss, and pK<sub>h</sub> ≈ 2.6 for the flavylium ⇌ carbinol hydration step — exact values shift with the specific anthocyanin, its sugar attachment, and temperature, which is why the app treats the transition as five practical bands rather than a single sharp cutoff.</p>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>How spoilage actually raises the pH</h3></div>'+
    '<p class="muted" style="font-size:13px; line-height:1.7;">Fresh milk, meat and fish sit mildly acidic to neutral. As spoilage bacteria break down proteins — proteolysis followed by decarboxylation of the freed amino acids — they release alkaline nitrogen compounds that push the surface pH upward. That rising pH is exactly what drives the pigment through the equilibrium above.</p>'+
    '<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">'+
      '<thead><tr style="text-align:left; color:var(--ink-faint);"><th style="padding:7px 4px; font-weight:600;">Compound</th><th style="padding:7px 4px; font-weight:600;">Formula</th><th style="padding:7px 4px; font-weight:600;">Produced from</th></tr></thead>'+
      '<tbody>'+
        compoundRow3('Ammonia','NH₃','Deamination of amino acids')+
        compoundRow3('Putrescine','C₄H₁₂N₂','Decarboxylation of ornithine')+
        compoundRow3('Cadaverine','C₅H₁₄N₂','Decarboxylation of lysine')+
        compoundRow3('Trimethylamine (TMA)','(CH₃)₃N','Reduction of TMAO — dominant in spoiling fish')+
        compoundRow3('Histamine','C₅H₉N₃','Decarboxylation of histidine')+
      '</tbody></table>'+
    '<table style="width:100%; margin-top:14px; border-collapse:collapse; font-size:12px;">'+
      '<thead><tr style="text-align:left; color:var(--ink-faint);"><th style="padding:7px 4px; font-weight:600;">Product</th><th style="padding:7px 4px; font-weight:600;">Typical fresh pH</th><th style="padding:7px 4px; font-weight:600;">Typical spoiling pH</th></tr></thead>'+
      '<tbody>'+
        compoundRow3('Milk','~6.6 – 6.8','&lt; 6.5 (souring) or rising if proteolytic spoilage dominates')+
        compoundRow3('Raw chicken/meat','~5.5 – 6.2','&gt; 6.5 as spoilage progresses')+
        compoundRow3('Fish','~6.5 – 6.9','&gt; 7.0, sometimes 7.5+ due to TMA')+
      '</tbody></table>'+
    '<p class="faint" style="font-size:11px; margin-top:10px;">These are commonly reported reference ranges, not guarantees — actual values vary by product, strain of spoilage organism, and storage temperature.</p>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Why this matters day to day</h3></div>'+
    '<div class="grid grid-2" id="about-impact"></div>'+
    '<p class="muted" style="font-size:12.5px; margin-top:14px; line-height:1.7;">One commonly cited FAO estimate puts global food loss and waste at roughly <strong>a third of all food produced</strong> — a meaningful share of it food that got thrown out on a "just in case" guess rather than a real spoilage signal, or eaten past the point it should\'ve been. A quick, objective check on packaging helps on both ends of that mistake.</p>'+
    '<p class="faint" style="font-size:11.5px; margin-top:10px; line-height:1.6;"><strong>Scope, honestly:</strong> the indicator responds to the alkaline byproducts of general bacterial protein spoilage — it is not a pathogen test. A product can still carry specific risks (like <em>Listeria</em>) without producing enough of these byproducts to shift the pigment. Treat a "safe" reading as one useful signal alongside normal food-safety practice, not a replacement for it.</p>'+
  '</div>'+

  '<div class="card">'+
    '<div style="display:flex; flex-direction:column; align-items:flex-start; gap:12px;">'+
      '<a href="https://sandipanividyalaya.org" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; background:#ffffff; padding:8px 16px; border-radius:12px; border:1px solid var(--card-border); box-shadow:var(--shadow-2); text-decoration:none;">'+
        '<img src="/static/SandipaniLOGON.webp" alt="Sandipani Vidyalaya logo" style="height:48px; width:auto; max-width:100%; object-fit:contain;">'+
      '</a>'+
      '<div>'+
        '<h3 style="font-size:16px; font-weight:600;">Made by students of Sandipani Vidyalaya</h3>'+
        '<a href="https://sandipanividyalaya.org" target="_blank" rel="noopener" class="faint" style="font-size:13px; text-decoration:underline; display:inline-block; margin-top:3px;">sandipanividyalaya.org</a>'+
      '</div>'+
    '</div>'+
    '<div class="grid grid-3" style="margin-top:18px;" id="about-team"></div>'+
  '</div>';

  qs('#about-steps').innerHTML = [
    aboutStep('1','Align the pigment strip','Hold your phone steady over the coloured square. The scanner samples the pigment across a short window to filter out lighting noise and catch even subtle colour shifts.'),
    aboutStep('2','Scan the QR code','The same pass reads the label\'s 16-character code — a mix of letters, numbers and symbols unique to that unit — and looks it up against the product record.'),
    aboutStep('3','Check the dates','Manufacture and expiry dates come from the QR record. If today is past the expiry date, the result is flagged regardless of pigment colour.'),
    aboutStep('4','Get one verdict','Pigment reading and expiry check are combined — if either signals a problem, the overall result is "consume soon" or "do not consume".')
  ].join('');

  qs('#about-parts').innerHTML = [
    aboutPart(ICON.droplet,'Pigment strip','Anthocyanin square that shifts colour with surface pH'),
    aboutPart(ICON.qr,'QR code','16-character unique code, alphanumeric + symbols'),
    aboutPart(ICON.clock,'Dates','Manufacture date and expiry date'),
    aboutPart(ICON.box,'Product info','Name, company and quantity, where applicable')
  ].join('');

  qs('#about-team').innerHTML = [
    teamCardHtml('Abinaav K', 'Creator'),
    teamCardHtml('Sathya Narayanan V', 'Creator'),
    teamCardHtml('Advaith S', 'Creator')
  ].join('');

  qs('#flavylium-diagram').innerHTML = flavyliumSkeletonSvg();
  qs('#equilibrium-flow').innerHTML = equilibriumFlowHtml();
  qs('#about-impact').innerHTML = [
    aboutPart(ICON.box,'Less food thrown out','An objective colour + date check beats guessing from smell or the packet date alone'),
    aboutPart(ICON.alert,'Fewer surprises','Catches products that spoiled early — before the printed expiry date said they would'),
    aboutPart(ICON.qr,'Harder to fake','A counterfeit label can copy the printing, not the chemistry or a registered code'),
    aboutPart(ICON.clock,'Faster decisions','One scan, one verdict — no separate smell/look/date checks to reconcile')
  ].join('');
}
function aboutStep(n,t,d){
  return '<div class="card tight" style="display:flex; gap:12px;"><div class="stat-icon" style="background:var(--panel); color:var(--ink); font-family:var(--font-display); font-weight:700;">'+n+'</div>'+
    '<div><div style="font-weight:700; font-size:13.5px;">'+t+'</div><div class="muted" style="font-size:12px; margin-top:3px; line-height:1.55;">'+d+'</div></div></div>';
}
function aboutPart(icon,t,d){
  return '<div class="stat-tile" style="text-align:left;"><div class="stat-icon" style="background:var(--panel); color:var(--ink);">'+icon+'</div>'+
    '<div style="font-weight:700; font-size:13px; margin-top:10px;">'+t+'</div><div class="stat-label">'+d+'</div></div>';
}
function aboutRow(color,name,ph,verdict){
  return '<tr style="border-top:1px solid var(--hairline);"><td style="padding:9px 4px; display:flex; align-items:center; gap:8px;"><span style="width:12px;height:12px;border-radius:4px;background:'+color+'; display:inline-block;"></span>'+name+'</td>'+
    '<td style="padding:9px 4px;">'+ph+'</td><td style="padding:9px 4px; font-weight:600;">'+verdict+'</td></tr>';
}
function indicatorRow(name, source, shift, ph){
  return '<tr style="border-top:1px solid var(--hairline);"><td style="padding:8px 4px; font-weight:600;">'+name+'</td>'+
    '<td style="padding:8px 4px; color:var(--ink-soft);">'+source+'</td>'+
    '<td style="padding:8px 4px; color:var(--ink-soft);">'+shift+'</td>'+
    '<td style="padding:8px 4px; font-family:ui-monospace,monospace;">'+ph+'</td></tr>';
}
function compoundRow(a, b, c, d){
  return '<tr style="border-top:1px solid var(--hairline);"><td style="padding:7px 4px; font-weight:600;">'+a+'</td>'+
    '<td style="padding:7px 4px; font-family:ui-monospace,monospace;">'+b+'</td>'+
    '<td style="padding:7px 4px; color:var(--ink-soft);">'+c+'</td>'+
    '<td style="padding:7px 4px; color:var(--ink-soft);">'+d+'</td></tr>';
}
function compoundRow3(a, b, c){
  return '<tr style="border-top:1px solid var(--hairline);"><td style="padding:7px 4px; font-weight:600;">'+a+'</td>'+
    '<td style="padding:7px 4px; font-family:ui-monospace,monospace;">'+b+'</td>'+
    '<td style="padding:7px 4px; color:var(--ink-soft);">'+c+'</td></tr>';
}

/* Simplified flavylium-cation skeleton (pointy-top hex grid, hand-fused
   A/C rings + a B-ring attached by a single bond) — schematic, not to scale. */
function flavyliumSkeletonSvg(){
  var stroke = 'var(--ink)';
  return '<svg viewBox="60 30 260 170" style="width:100%; max-width:340px; height:auto;" xmlns="http://www.w3.org/2000/svg">'+
    '<polygon points="152.3,146 124.6,162 96.9,146 96.9,114 124.6,98 152.3,114" fill="none" stroke="'+stroke+'" stroke-width="2.5" stroke-linejoin="round"/>'+
    '<polygon points="207.7,146 180,162 152.3,146 152.3,114 180,98 207.7,114" fill="none" stroke="'+stroke+'" stroke-width="2.5" stroke-linejoin="round"/>'+
    '<polygon points="284.2,114 260,128 235.8,114 235.8,86 260,72 284.2,86" fill="none" stroke="'+stroke+'" stroke-width="2.5" stroke-linejoin="round"/>'+
    '<line x1="207.7" y1="114" x2="235.8" y2="86" stroke="'+stroke+'" stroke-width="2.5"/>'+
    '<line x1="105" y1="120" x2="119" y2="128" stroke="'+stroke+'" stroke-width="1.6" opacity=".55"/>'+
    '<line x1="160" y1="120" x2="174" y2="128" stroke="'+stroke+'" stroke-width="1.6" opacity=".55"/>'+
    '<line x1="243" y1="92" x2="255" y2="99" stroke="'+stroke+'" stroke-width="1.6" opacity=".55"/>'+
    '<text x="180" y="135" text-anchor="middle" font-size="15" font-weight="700" fill="var(--spec-1)" font-family="ui-monospace,monospace">O⁺</text>'+
    '<text x="88" y="182" font-size="12.5" fill="var(--ink-soft)" font-family="ui-monospace,monospace">HO</text>'+
    '<text x="108" y="76" font-size="12.5" fill="var(--ink-soft)" font-family="ui-monospace,monospace">OH</text>'+
    '<text x="255" y="152" font-size="12.5" fill="var(--ink-soft)" font-family="ui-monospace,monospace">OH</text>'+
    '<text x="255" y="48" font-size="12.5" fill="var(--ink-soft)" font-family="ui-monospace,monospace">OH</text>'+
    '<text x="96" y="110" text-anchor="middle" font-size="11" fill="var(--ink-faint)">A-ring</text>'+
    '<text x="180" y="72" text-anchor="middle" font-size="11" fill="var(--ink-faint)">C-ring</text>'+
    '<text x="260" y="62" text-anchor="middle" font-size="11" fill="var(--ink-faint)">B-ring</text>'+
  '</svg>';
}

/* The four-species flavylium equilibrium — the actual mechanism behind
   the colour shift, laid out as a left-to-right flow. */
function equilibriumFlowHtml(){
  var stages = [
    { hex:'#c23e86', name:'Flavylium cation', ph:'pH &lt; 3', note:'Fully conjugated, strongly coloured' },
    { hex:'#7c4fc9', name:'Quinoidal base', ph:'pH 4 – 6', note:'Loses a proton; still aromatic, colour deepens' },
    { hex:'#cfcfd6', name:'Carbinol pseudobase', ph:'pH 5 – 6', note:'Water adds in; ring opens, colourless' },
    { hex:'#d9a62e', name:'Chalcone', ph:'pH &gt; 7, slow', note:'Fully ring-opened tautomer, pale yellow' }
  ];
  var out = '<div style="display:flex; align-items:stretch; gap:6px; flex-wrap:wrap;">';
  stages.forEach(function(s, i){
    out += '<div style="flex:1; min-width:140px; background:var(--panel); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:6px;">'+
      '<div style="width:26px; height:26px; border-radius:9px; background:'+s.hex+'; box-shadow:inset 0 0 0 2px var(--card);"></div>'+
      '<div style="font-size:12.5px; font-weight:700;">'+s.name+'</div>'+
      '<div style="font-size:11px; font-family:ui-monospace,monospace; color:var(--ink-faint);">'+s.ph+'</div>'+
      '<div style="font-size:11px; color:var(--ink-soft); line-height:1.4;">'+s.note+'</div>'+
    '</div>';
    if (i < stages.length - 1){
      out += '<div style="display:flex; align-items:center; justify-content:center; flex:0 0 auto; color:var(--ink-faint); font-size:18px;">→</div>';
    }
  });
  out += '</div>';
  return out;
}

function initialsOf(name){
  return (name||'?').trim().split(/\s+/).map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
}
function teamCardHtml(name, role){
  return '<div class="stat-tile" style="text-align:left;">'+
    '<div class="avatar-btn" style="width:40px;height:40px;font-size:14px;">'+initialsOf(name)+'</div>'+
    '<div style="font-weight:700; font-size:13.5px; margin-top:10px;">'+escapeHtml(name)+'</div>'+
    '<div class="stat-label">'+escapeHtml(role)+'</div></div>';
}

/* ======================================================================
   VIEW: SETTINGS (signed-in only)
   ====================================================================== */
function renderSettings(){
  var host = qs('#view-settings');

  if (!isLoggedIn()){
    host.innerHTML = '<div class="card">'+ signInPrompt('Sign in to see settings', 'Your profile, notifications and data controls live here once you\'re signed in.') +'</div>';
    bindSignInPrompts(host);
    return;
  }

  host.innerHTML =
  '<div class="card">'+
    '<div class="card-head"><h3>Profile</h3></div>'+
    '<div class="field-label">Name</div>'+
    '<input id="set-name" class="field-input" type="text" placeholder="Your name">'+
    '<div class="field-label">Email</div>'+
    '<input class="field-input" type="email" value="" id="set-email" disabled style="opacity:.65;">'+
    '<button class="btn btn-dark" id="set-save-profile" style="margin-top:14px;">Save name</button>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Password</h3></div>'+
    '<div class="field-label" id="set-pw-current-label">Current password</div>'+
    '<input id="set-pw-current" class="field-input" type="password" placeholder="Current password" autocomplete="current-password">'+
    '<div class="field-label">New password</div>'+
    '<input id="set-pw-new" class="field-input" type="password" placeholder="At least 6 characters" autocomplete="new-password">'+
    '<p id="set-pw-error" class="faint" style="font-size:12px; margin-top:8px; color:var(--danger); display:none;"></p>'+
    '<button class="btn btn-dark" id="set-save-password" style="margin-top:14px;">Update password</button>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Appearance</h3></div>'+
    '<div class="settings-row" style="border:none; padding-top:0;">'+
      '<div class="si">'+ICON.palette+'</div>'+
      '<div class="sb"><div class="st">Theme</div><div class="sd">Applies everywhere, including this device only</div></div>'+
    '</div>'+
    '<div class="seg-control" id="theme-seg">'+
      '<button data-theme-choice="light">'+ICON.check+' Light</button>'+
      '<button data-theme-choice="dark">'+ICON.check+' Dark</button>'+
      '<button data-theme-choice="system">'+ICON.check+' System</button>'+
    '</div>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Notifications</h3></div>'+
    '<div class="settings-row" style="border:none; padding-top:0;">'+
      '<div class="si">'+ICON.bell+'</div>'+
      '<div class="sb"><div class="st">Alert me on flagged scans</div><div class="sd">Emails when a scan comes back caution or do-not-consume (needs the server\'s email set up)</div></div>'+
      '<button class="switch" id="notify-toggle" aria-label="Toggle flagged-scan alerts"></button>'+
    '</div>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Data &amp; privacy</h3></div>'+
    '<button class="settings-row" id="set-export" style="width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--hairline); cursor:pointer;">'+
      '<div class="si">'+ICON.download+'</div><div class="sb"><div class="st">Download my data</div><div class="sd">Your profile and full scan history as a JSON file</div></div>'+
    '</button>'+
    '<button class="settings-row" id="set-clear-history" style="width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--hairline); cursor:pointer;">'+
      '<div class="si">'+ICON.trash+'</div><div class="sb"><div class="st">Clear scan history</div><div class="sd">Deletes all your past scans — can\'t be undone</div></div>'+
    '</button>'+
    '<button class="settings-row danger" id="set-delete-account" style="width:100%; text-align:left; background:none; border:none; cursor:pointer;">'+
      '<div class="si">'+ICON.cross+'</div><div class="sb"><div class="st">Delete account</div><div class="sd">Permanently removes your account and all scan history</div></div>'+
    '</button>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-head"><h3>Support</h3></div>'+
    '<a class="settings-row" href="'+whatsappLink("Hi "+BRAND_NAME+"! I have a question about my account.")+'" target="_blank" rel="noopener" style="text-decoration:none;">'+
      '<div class="si" style="background:var(--whatsapp)22; color:var(--whatsapp);">'+ICON.whatsapp+'</div><div class="sb"><div class="st">Chat with us on WhatsApp</div><div class="sd">Account, orders, or anything else</div></div>'+
    '</a>'+
    '<button class="settings-row" id="set-sign-out" style="width:100%; text-align:left; background:none; border:none; border-top:1px solid var(--hairline); cursor:pointer;">'+
      '<div class="si">'+ICON.user+'</div><div class="sb"><div class="st">Sign out</div></div>'+
    '</button>'+
  '</div>';

  // Theme segmented control
  var themeSeg = qs('#theme-seg');
  function paintThemeSeg(){
    qsa('[data-theme-choice]', themeSeg).forEach(function(b){ b.classList.toggle('active', b.dataset.themeChoice === getThemePref()); });
  }
  paintThemeSeg();
  qsa('[data-theme-choice]', themeSeg).forEach(function(b){
    b.addEventListener('click', function(){ setThemePref(b.dataset.themeChoice); paintThemeSeg(); });
  });

  // Load fresh profile data from the server (name/email/notify preference)
  authFetch('/account/me').then(function(res){ return res.ok ? res.json() : null; }).then(function(data){
    if (!data || !data.success) return;
    var u = data.user;
    var a = getAuth();
    if (a && u){
      a.is_admin = !!u.is_admin;
      setAuth(a);
      refreshAdminNav();
    }
    qs('#set-name').value = u.name || '';
    qs('#set-email').value = u.email || '';
    var toggle = qs('#notify-toggle');
    toggle.classList.toggle('on', !!u.notify_flagged);
    toggle.dataset.on = u.notify_flagged ? '1' : '0';
    if (!u.has_password){
      qs('#set-pw-current-label').textContent = 'Current password (none set — this is your first password)';
      qs('#set-pw-current').placeholder = 'Leave blank — you signed in with Google';
    }
  });

  qs('#set-save-profile').addEventListener('click', function(){
    var btn = qs('#set-save-profile');
    var name = qs('#set-name').value.trim();
    if (!name){ toast('Name can\'t be empty'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    authFetch('/account/profile', { method:'PUT', body: JSON.stringify({ name: name }) })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          var auth = getAuth(); auth.name = data.user.name; setAuth(auth);
          paintAccountButton();
          toast('Profile updated');
        } else { toast(data.message || 'Could not update profile'); }
        btn.disabled = false; btn.textContent = 'Save name';
      }).catch(function(){ toast('Could not reach the server'); btn.disabled = false; btn.textContent = 'Save name'; });
  });

  qs('#set-save-password').addEventListener('click', function(){
    var btn = qs('#set-save-password');
    var errEl = qs('#set-pw-error');
    errEl.style.display = 'none';
    var current = qs('#set-pw-current').value;
    var next = qs('#set-pw-new').value;
    if (!next || next.length < 6){ errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Updating…';
    authFetch('/account/password', { method:'PUT', body: JSON.stringify({ current_password: current, new_password: next }) })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          toast('Password updated');
          qs('#set-pw-current').value = ''; qs('#set-pw-new').value = '';
        } else { errEl.textContent = data.message || 'Could not update password.'; errEl.style.display = 'block'; }
        btn.disabled = false; btn.textContent = 'Update password';
      }).catch(function(){ errEl.textContent = 'Could not reach the server.'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = 'Update password'; });
  });

  qs('#notify-toggle').addEventListener('click', function(){
    var toggle = qs('#notify-toggle');
    var next = toggle.dataset.on !== '1';
    toggle.classList.toggle('on', next);
    toggle.dataset.on = next ? '1' : '0';
    authFetch('/account/preferences', { method:'PATCH', body: JSON.stringify({ notify_flagged: next }) })
      .then(function(res){ return res.json(); })
      .then(function(data){ if (!data.success){ toast('Could not save that — try again'); } })
      .catch(function(){ toast('Could not reach the server'); });
  });

  qs('#set-export').addEventListener('click', function(){
    authFetch('/account/export').then(function(res){ return res.json(); }).then(function(data){
      if (!data.success){ toast('Could not export your data'); return; }
      var blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'antholytix-my-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Download started');
    }).catch(function(){ toast('Could not reach the server'); });
  });

  qs('#set-clear-history').addEventListener('click', function(){
    confirmDialog('Clear scan history?', 'This deletes all your past scans. This can\'t be undone.', 'Clear history', function(){
      authFetch('/scan/history', { method:'DELETE' }).then(function(res){ return res.json(); }).then(function(data){
        toast(data.success ? 'History cleared' : (data.message || 'Could not clear history'));
      }).catch(function(){ toast('Could not reach the server'); });
    });
  });

  qs('#set-delete-account').addEventListener('click', function(){
    confirmDialog('Delete your account?', 'This permanently deletes your account and every scan you\'ve made. There\'s no undo.', 'Delete account', function(){
      authFetch('/account', { method:'DELETE' }).then(function(res){ return res.json(); }).then(function(data){
        if (data.success){
          clearAuth();
          toast('Account deleted');
          navigate('home');
          refreshAuthUi();
        } else { toast(data.message || 'Could not delete account'); }
      }).catch(function(){ toast('Could not reach the server'); });
    });
  });

  qs('#set-sign-out').addEventListener('click', function(){
    confirmDialog('Sign out', 'Do you definitely want to sign out?', 'Sign out', function(){
      clearAuth();
      toast('Signed out');
      navigate('home');
      refreshAuthUi();
    });
  });
}

function confirmDialog(title, body, confirmLabel, onConfirm){
  openModal(
    '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">'+escapeHtml(title)+'</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
    '<p class="muted" style="font-size:12.5px; margin-top:10px; line-height:1.6;">'+escapeHtml(body)+'</p>'+
    '<div style="display:flex; gap:10px; margin-top:18px;">'+
      '<button class="btn btn-outline" data-close-modal style="flex:1;">Cancel</button>'+
      '<button class="btn btn-dark" id="confirm-danger-btn" style="flex:1; background:var(--danger);">'+escapeHtml(confirmLabel)+'</button>'+
    '</div>'
  );
  qs('#confirm-danger-btn').addEventListener('click', function(){ closeModal(); onConfirm(); });
}

/* ======================================================================
   VIEW: ADMIN (4 Cards: Overview, Labels Registry, Scans Telemetry, Users)
   ====================================================================== */
var adminDataCache = null;
var adminLabelsFilter = '';
var adminUsersFilter = '';
var adminScansVerdictFilter = '';

function renderAdmin(){
  var host = qs('#view-admin');
  if (!host) return;

  if (!isLoggedIn() || !isAdminUser()){
    host.innerHTML =
      '<div class="card" style="max-width:440px; margin:32px auto; padding:32px 26px;">' +
        '<div style="text-align:center; margin-bottom:22px;">' +
          '<div style="display:inline-flex; width:52px; height:52px; border-radius:16px; background:var(--panel); align-items:center; justify-content:center; margin-bottom:12px;">' +
            '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
          '</div>' +
          '<h3 style="font-size:18px; font-weight:700;">Admin Authentication</h3>' +
          '<p class="muted" style="font-size:12.5px; margin-top:4px;">Enter administrator credentials to access dashboard</p>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:12px;">' +
          '<div>' +
            '<div class="field-label" style="font-size:12px; margin-bottom:4px;">Username or Email</div>' +
            '<input id="admin-gate-user" class="field-input" type="text" placeholder="admin" value="admin" autocomplete="username">' +
          '</div>' +
          '<div>' +
            '<div class="field-label" style="font-size:12px; margin-bottom:4px;">Password</div>' +
            '<input id="admin-gate-pass" class="field-input" type="password" placeholder="admin" autocomplete="current-password">' +
          '</div>' +
          '<p id="admin-gate-error" class="faint" style="font-size:12px; color:var(--danger); display:none;"></p>' +
          '<button class="btn btn-dark btn-block" id="admin-gate-login-btn" style="margin-top:6px;">Sign in as Admin</button>' +
          '<button class="btn btn-outline btn-block" id="admin-gate-home-btn" style="margin-top:2px;">Back to Home</button>' +
        '</div>' +
      '</div>';

    var loginBtn = qs('#admin-gate-login-btn');
    var userInput = qs('#admin-gate-user');
    var passInput = qs('#admin-gate-pass');
    var errEl = qs('#admin-gate-error');
    var homeBtn = qs('#admin-gate-home-btn');

    if (homeBtn) homeBtn.addEventListener('click', function(){ navigate('home'); });

    function doAdminGateLogin(){
      var u = (userInput.value || '').trim();
      var p = passInput.value || '';
      if (!u || !p){
        errEl.textContent = 'Enter username and password.';
        errEl.style.display = 'block';
        return;
      }
      loginBtn.disabled = true;
      loginBtn.textContent = 'Authenticating…';
      errEl.style.display = 'none';
      fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u, password: p })
      })
      .then(function(res){ return res.json(); })
      .then(function(data){
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign in as Admin';
        if (data && data.success){
          if (!data.is_admin){
            errEl.textContent = 'This account does not have administrator privileges.';
            errEl.style.display = 'block';
            return;
          }
          setAuth({ token: data.token, name: data.name, email: data.email, is_admin: true });
          toast('Admin authenticated');
          refreshAuthUi();
          renderAdmin();
        } else {
          errEl.textContent = (data && data.message) || 'Invalid administrator credentials.';
          errEl.style.display = 'block';
        }
      })
      .catch(function(){
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign in as Admin';
        errEl.textContent = 'Could not reach the server.';
        errEl.style.display = 'block';
      });
    }

    if (loginBtn) loginBtn.addEventListener('click', doAdminGateLogin);
    if (userInput) userInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') doAdminGateLogin(); });
    if (passInput) passInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') doAdminGateLogin(); });
    return;
  }

  host.innerHTML =
    '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; flex-wrap:wrap; gap:12px;">' +
      '<div>' +
        '<h2 style="font-size:22px; font-weight:700;">Admin Dashboard</h2>' +
        '<p class="muted" style="font-size:13px; margin-top:2px;">Overview, registered labels, cross-user scan telemetry & user management</p>' +
      '</div>' +
      '<button class="btn btn-outline btn-sm" id="admin-reload-btn" style="display:inline-flex; align-items:center; gap:6px;">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/></svg>' +
        ' Refresh Data' +
      '</button>' +
    '</div>' +
    '<div id="admin-content">' +
      '<div class="card" style="text-align:center; padding:40px 20px;">' +
        '<div class="empty">' + ICON.clock + '<div style="font-weight:700; margin-top:8px;">Loading admin metrics…</div></div>' +
      '</div>' +
    '</div>';

  var reloadBtn = qs('#admin-reload-btn');
  if (reloadBtn){
    reloadBtn.addEventListener('click', function(){
      loadAdminDashboard();
    });
  }

  loadAdminDashboard();
}

function loadAdminDashboard(){
  var content = qs('#admin-content');
  if (!content) return;

  authFetch('/admin/overview')
    .then(function(res){
      if (res.status === 403){
        content.innerHTML =
          '<div class="card" style="text-align:center; padding:50px 20px;">' +
            '<div class="empty">' + ICON.lock +
              '<div style="font-weight:700; font-size:18px; color:var(--ink); margin-top:10px;">Admin Access Required</div>' +
              '<p class="muted" style="margin-top:6px; max-width:420px; margin-left:auto; margin-right:auto; line-height:1.6;">' +
                'Your account is not authorized to view this admin telemetry. Administrator privileges are required.' +
              '</p>' +
            '</div>' +
          '</div>';
        return null;
      }
      if (!res.ok) throw new Error('Failed to load overview');
      return res.json();
    })
    .then(function(data){
      if (!data) return;
      if (!data.success){
        content.innerHTML = '<div class="card"><p class="muted">' + escapeHtml(data.message || 'Error loading admin data') + '</p></div>';
        return;
      }
      adminDataCache = data;
      paintAdminDashboard(data);
    })
    .catch(function(err){
      content.innerHTML = '<div class="card"><p class="muted">Could not load admin data. Ensure server is running.</p></div>';
    });
}

function paintAdminDashboard(data){
  var content = qs('#admin-content');
  if (!content) return;

  var s = data.stats || {};
  var totalScans = s.total_scans || 0;
  var safeCount = (s.verdicts && s.verdicts.safe) || 0;
  var cautionCount = (s.verdicts && s.verdicts.caution) || 0;
  var dangerCount = (s.verdicts && s.verdicts.danger) || 0;
  var safePct = totalScans ? Math.round((safeCount / totalScans) * 100) : 0;
  var activeLabels = (s.total_active_labels !== undefined) ? s.total_active_labels : (s.active_labels || 0);

  var todayStr = new Date().toISOString().slice(0, 10);
  var defaultExpStr = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  content.innerHTML =
    // CARD 1: OVERVIEW STATS
    '<div class="card" style="margin-bottom:20px;">' +
      '<div class="card-head" style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between;">' +
        '<div>' +
          '<h3 style="font-size:16px; font-weight:700;">Overview Telemetry</h3>' +
          '<p class="muted" style="font-size:12.5px; margin-top:2px;">Real-time system metrics, consumer activity & label registry</p>' +
        '</div>' +
        '<span class="card-tag">Live</span>' +
      '</div>' +
      '<div class="grid grid-4" style="margin-bottom:16px;">' +
        statTile(ICON.qr, 'var(--accent)', totalScans, 'Total Scans') +
        statTile(ICON.user, '#3f70da', s.total_users || 0, 'Total Users') +
        statTile(ICON.box, '#2e7d32', activeLabels + ' / ' + (s.total_labels || 0), 'Active Labels') +
        statTile(ICON.check, 'var(--safe)', safePct + '%', 'Safe Scan Rate') +
      '</div>' +
      '<div style="border-top:1px solid var(--hairline); padding-top:14px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:8px;">' +
          '<span style="font-size:12.5px; font-weight:600; color:var(--ink-soft);">Scan Verdict Breakdown</span>' +
          '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<span class="badge safe"><span class="dot"></span>Safe: ' + safeCount + '</span>' +
            '<span class="badge caution"><span class="dot"></span>Caution: ' + cautionCount + '</span>' +
            '<span class="badge danger"><span class="dot"></span>Danger: ' + dangerCount + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="height:10px; border-radius:99px; background:var(--hairline); overflow:hidden; display:flex;">' +
          (totalScans > 0 ?
            '<div style="width:' + ((safeCount / totalScans) * 100) + '%; background:var(--safe);" title="Safe: ' + safeCount + '"></div>' +
            '<div style="width:' + ((cautionCount / totalScans) * 100) + '%; background:var(--caution);" title="Caution: ' + cautionCount + '"></div>' +
            '<div style="width:' + ((dangerCount / totalScans) * 100) + '%; background:var(--danger);" title="Danger: ' + dangerCount + '"></div>'
            : '<div style="width:100%; background:var(--hairline);"></div>') +
        '</div>' +
      '</div>' +
    '</div>' +

    // CARD 2: REGISTERED LABELS + CREATE LABEL FORM
    '<div class="card" style="margin-bottom:20px;" id="admin-card-labels">' +
      '<div class="card-head" style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">' +
        '<div>' +
          '<h3 style="font-size:16px; font-weight:700;">Registered Labels</h3>' +
          '<p class="muted" style="font-size:12.5px; margin-top:2px;">Physical product QR tokens verified during retail scans</p>' +
        '</div>' +
        '<button class="btn btn-dark btn-sm" id="btn-toggle-create-label" style="display:inline-flex; align-items:center; gap:6px;">' +
          '+ Register New Label' +
        '</button>' +
      '</div>' +

      // Collapsible create form mirroring /docs POST /labels
      '<div id="admin-create-label-wrap" style="display:none; background:var(--panel); border:1px solid var(--card-border); border-radius:var(--r-md); padding:16px; margin-bottom:18px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">' +
          '<h4 style="font-size:14px; font-weight:700;">Register New Label (POST /labels)</h4>' +
          '<span class="card-tag">Manufacturer API</span>' +
        '</div>' +
        '<p class="muted" style="font-size:12px; margin-bottom:14px; line-height:1.5;">Creates an authentic 16-character label token for printing into product packaging. Mirrors the documented manufacturer API request from <code>/docs</code>.</p>' +
        '<div class="grid grid-2" style="gap:12px; margin-bottom:12px;">' +
          '<div>' +
            '<label style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:4px;">Product Name *</label>' +
            '<input type="text" id="new-lbl-name" placeholder="e.g. Fresh Paneer, 200 g" style="width:100%; padding:8px 12px; font-size:13px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:4px;">Company Name</label>' +
            '<input type="text" id="new-lbl-company" value="Antholytix AI Foods Pvt. Ltd." style="width:100%; padding:8px 12px; font-size:13px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:4px;">Quantity / Pack Size</label>' +
            '<input type="text" id="new-lbl-qty" placeholder="e.g. 200 g / 500 ml" style="width:100%; padding:8px 12px; font-size:13px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
          '</div>' +
          '<div style="display:flex; gap:10px;">' +
            '<div style="flex:1;">' +
              '<label style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:4px;">Mfg Date (YYYY-MM-DD)</label>' +
              '<input type="date" id="new-lbl-mfg" value="' + todayStr + '" style="width:100%; padding:7px 10px; font-size:12.5px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
            '</div>' +
            '<div style="flex:1;">' +
              '<label style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:4px;">Exp Date (YYYY-MM-DD)</label>' +
              '<input type="date" id="new-lbl-exp" value="' + defaultExpStr + '" style="width:100%; padding:7px 10px; font-size:12.5px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:8px;">' +
          '<button class="btn btn-outline btn-sm" id="btn-cancel-create-label">Cancel</button>' +
          '<button class="btn btn-dark btn-sm" id="btn-submit-create-label">Register Label</button>' +
        '</div>' +
      '</div>' +

      // Labels filter and table
      '<div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">' +
        '<input type="text" id="admin-search-labels" placeholder="Filter labels by code, product, or company…" value="' + escapeHtml(adminLabelsFilter) + '" style="max-width:320px; width:100%; padding:7px 12px; font-size:12.5px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
        '<span class="faint" style="font-size:12px;" id="admin-labels-count"></span>' +
      '</div>' +
      '<div id="admin-labels-table-mount"></div>' +
    '</div>' +

    // CARD 3: SCANS TELEMETRY
    '<div class="card" style="margin-bottom:20px;" id="admin-card-scans">' +
      '<div class="card-head" style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">' +
        '<div>' +
          '<h3 style="font-size:16px; font-weight:700;">Cross-User Scan Telemetry</h3>' +
          '<p class="muted" style="font-size:12.5px; margin-top:2px;">All consumer scans across all accounts with verified sensor readings and verdicts</p>' +
        '</div>' +
        '<div style="display:flex; gap:8px;">' +
          '<select id="admin-filter-scan-verdict" style="padding:6px 12px; font-size:12px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink); outline:none;">' +
            '<option value="" ' + (!adminScansVerdictFilter ? 'selected' : '') + '>All verdicts</option>' +
            '<option value="safe" ' + (adminScansVerdictFilter === 'safe' ? 'selected' : '') + '>Safe only</option>' +
            '<option value="caution" ' + (adminScansVerdictFilter === 'caution' ? 'selected' : '') + '>Caution only</option>' +
            '<option value="danger" ' + (adminScansVerdictFilter === 'danger' ? 'selected' : '') + '>Danger only</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div id="admin-scans-table-mount"></div>' +
    '</div>' +

    // CARD 4: USERS TABLE
    '<div class="card" style="margin-bottom:20px;" id="admin-card-users">' +
      '<div class="card-head" style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">' +
        '<div>' +
          '<h3 style="font-size:16px; font-weight:700;">User Directory & Permissions</h3>' +
          '<p class="muted" style="font-size:12.5px; margin-top:2px;">Manage account roles, verification status, and security suspension</p>' +
        '</div>' +
        '<input type="text" id="admin-search-users" placeholder="Filter users by name or email…" value="' + escapeHtml(adminUsersFilter) + '" style="max-width:280px; width:100%; padding:7px 12px; font-size:12.5px; border-radius:10px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);">' +
      '</div>' +
      '<div id="admin-users-table-mount"></div>' +
    '</div>';

  // Wire up Create Label toggler
  var toggleCreateBtn = qs('#btn-toggle-create-label');
  var createWrap = qs('#admin-create-label-wrap');
  var cancelCreateBtn = qs('#btn-cancel-create-label');
  var submitCreateBtn = qs('#btn-submit-create-label');

  if (toggleCreateBtn && createWrap){
    toggleCreateBtn.addEventListener('click', function(){
      var isHidden = createWrap.style.display === 'none';
      createWrap.style.display = isHidden ? 'block' : 'none';
      if (isHidden) qs('#new-lbl-name').focus();
    });
  }
  if (cancelCreateBtn && createWrap){
    cancelCreateBtn.addEventListener('click', function(){
      createWrap.style.display = 'none';
    });
  }
  if (submitCreateBtn){
    submitCreateBtn.addEventListener('click', function(){
      var name = qs('#new-lbl-name').value.trim();
      var company = qs('#new-lbl-company').value.trim();
      var qty = qs('#new-lbl-qty').value.trim();
      var mfg = qs('#new-lbl-mfg').value.trim();
      var exp = qs('#new-lbl-exp').value.trim();

      if (!name){
        toast('Product name is required');
        return;
      }
      submitCreateBtn.disabled = true;
      submitCreateBtn.textContent = 'Registering…';

      authFetch('/labels', {
        method: 'POST',
        body: JSON.stringify({ name: name, company: company, qty: qty, mfg: mfg, exp: exp })
      })
      .then(function(res){ return res.json(); })
      .then(function(data){
        submitCreateBtn.disabled = false;
        submitCreateBtn.textContent = 'Register Label';
        if (data.success){
          toast('Label registered: ' + data.label.code);
          qs('#new-lbl-name').value = '';
          qs('#new-lbl-qty').value = '';
          if (createWrap) createWrap.style.display = 'none';
          loadAdminDashboard();
        } else {
          toast(data.message || 'Failed to register label');
        }
      })
      .catch(function(){
        submitCreateBtn.disabled = false;
        submitCreateBtn.textContent = 'Register Label';
        toast('Network error registering label');
      });
    });
  }

  // Wire up search and filters
  var searchLabelsInput = qs('#admin-search-labels');
  if (searchLabelsInput){
    searchLabelsInput.addEventListener('input', function(e){
      adminLabelsFilter = e.target.value.trim().toLowerCase();
      paintLabelsTable();
    });
  }

  var searchUsersInput = qs('#admin-search-users');
  if (searchUsersInput){
    searchUsersInput.addEventListener('input', function(e){
      adminUsersFilter = e.target.value.trim().toLowerCase();
      paintUsersTable();
    });
  }

  var filterVerdictSelect = qs('#admin-filter-scan-verdict');
  if (filterVerdictSelect){
    filterVerdictSelect.addEventListener('change', function(e){
      adminScansVerdictFilter = e.target.value;
      paintScansTable();
    });
  }

  // Paint the tables
  paintLabelsTable();
  paintScansTable();
  paintUsersTable();
}

function paintLabelsTable(){
  if (!adminDataCache) return;
  var mount = qs('#admin-labels-table-mount');
  var countEl = qs('#admin-labels-count');
  if (!mount) return;

  var q = adminLabelsFilter;
  var labels = (adminDataCache.labels || []).filter(function(l){
    if (!q) return true;
    return (l.code && l.code.toLowerCase().indexOf(q) >= 0) ||
           (l.name && l.name.toLowerCase().indexOf(q) >= 0) ||
           (l.company && l.company.toLowerCase().indexOf(q) >= 0);
  });

  if (countEl) countEl.textContent = labels.length + ' registered';

  if (!labels.length){
    mount.innerHTML = '<div style="text-align:center; padding:24px;" class="muted"><p>No labels matching the criteria.</p></div>';
    return;
  }

  var rows = labels.map(function(l){
    var statusBadge = l.is_active
      ? '<span class="badge safe"><span class="dot"></span>Active</span>'
      : '<span class="badge danger"><span class="dot"></span>Voided</span>';

    return '<tr>' +
      '<td><span style="font-family:monospace; font-weight:700; color:var(--accent);">' + escapeHtml(l.code) + '</span></td>' +
      '<td>' +
        '<div style="font-weight:600; color:var(--ink);">' + escapeHtml(l.name) + '</div>' +
        '<div class="faint" style="font-size:11.5px;">' + escapeHtml(l.company || '—') + '</div>' +
      '</td>' +
      '<td>' + escapeHtml(l.qty || '—') + '</td>' +
      '<td><span class="faint" style="font-size:11.5px;">Mfg: ' + escapeHtml(l.mfg || '—') + '<br>Exp: ' + escapeHtml(l.exp || '—') + '</span></td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' +
        '<div style="display:flex; gap:6px;">' +
          '<button class="btn btn-outline btn-sm btn-edit-label" data-id="' + l.id + '" data-code="' + escapeHtml(l.code) + '" data-name="' + escapeHtml(l.name) + '" data-company="' + escapeHtml(l.company || '') + '" data-qty="' + escapeHtml(l.qty || '') + '" data-exp="' + escapeHtml(l.exp || '') + '" style="font-size:11.5px;">Edit</button>' +
          '<button class="btn btn-outline btn-sm btn-toggle-label" data-id="' + l.id + '" data-active="' + (l.is_active ? '1' : '0') + '" style="font-size:11.5px;">' + (l.is_active ? 'Deactivate' : 'Activate') + '</button>' +
          '<button class="btn btn-outline btn-sm btn-delete-label" data-id="' + l.id + '" data-code="' + escapeHtml(l.code) + '" data-name="' + escapeHtml(l.name) + '" style="color:var(--danger); border-color:var(--card-border);" title="Delete label">' + ICON.trash + '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }).join('');

  mount.innerHTML =
    '<div class="admin-table-wrap">' +
      '<table class="admin-table">' +
        '<thead><tr>' +
          '<th>QR Token</th>' +
          '<th>Product & Company</th>' +
          '<th>Qty</th>' +
          '<th>Dates</th>' +
          '<th>Status</th>' +
          '<th>Actions</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  // Bind inline edit modal
  qsa('.btn-edit-label', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      var code = btn.getAttribute('data-code');
      var name = btn.getAttribute('data-name');
      var company = btn.getAttribute('data-company');
      var qty = btn.getAttribute('data-qty');
      var exp = btn.getAttribute('data-exp');

      openModal(
        '<div style="display:flex; align-items:center; justify-content:space-between;"><h3 style="font-size:16px;">Edit Label ' + escapeHtml(code) + '</h3><button class="modal-close" data-close-modal>' + ICON.cross + '</button></div>' +
        '<div style="margin-top:14px;">' +
          '<div style="margin-bottom:10px;"><label class="faint" style="font-size:12px; display:block; margin-bottom:4px;">Product Name</label><input type="text" id="edit-lbl-name" value="' + escapeHtml(name) + '" style="width:100%; padding:7px 10px; font-size:13px; border-radius:8px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);"></div>' +
          '<div style="margin-bottom:10px;"><label class="faint" style="font-size:12px; display:block; margin-bottom:4px;">Company</label><input type="text" id="edit-lbl-company" value="' + escapeHtml(company) + '" style="width:100%; padding:7px 10px; font-size:13px; border-radius:8px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);"></div>' +
          '<div style="margin-bottom:10px;"><label class="faint" style="font-size:12px; display:block; margin-bottom:4px;">Quantity</label><input type="text" id="edit-lbl-qty" value="' + escapeHtml(qty) + '" style="width:100%; padding:7px 10px; font-size:13px; border-radius:8px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);"></div>' +
          '<div style="margin-bottom:16px;"><label class="faint" style="font-size:12px; display:block; margin-bottom:4px;">Expiry Date (YYYY-MM-DD)</label><input type="date" id="edit-lbl-exp" value="' + escapeHtml(exp) + '" style="width:100%; padding:7px 10px; font-size:13px; border-radius:8px; border:1px solid var(--card-border); background:var(--card); color:var(--ink);"></div>' +
          '<div style="display:flex; justify-content:flex-end; gap:8px;">' +
            '<button class="btn btn-outline btn-sm" data-close-modal>Cancel</button>' +
            '<button class="btn btn-dark btn-sm" id="btn-save-edit-label">Save Changes</button>' +
          '</div>' +
        '</div>'
      );

      qs('#btn-save-edit-label').addEventListener('click', function(){
        var newName = qs('#edit-lbl-name').value.trim();
        var newCompany = qs('#edit-lbl-company').value.trim();
        var newQty = qs('#edit-lbl-qty').value.trim();
        var newExp = qs('#edit-lbl-exp').value.trim();

        if (!newName){ toast('Product name cannot be empty'); return; }

        authFetch('/admin/labels/' + id, {
          method: 'PUT',
          body: JSON.stringify({ name: newName, company: newCompany, qty: newQty, exp: newExp })
        })
        .then(function(res){ return res.json(); })
        .then(function(data){
          if (data.success){
            closeModal();
            toast('Label updated successfully');
            loadAdminDashboard();
          } else {
            toast(data.message || 'Failed to update label');
          }
        })
        .catch(function(){ toast('Network error updating label'); });
      });
    });
  });

  // Bind deactivate/activate status toggle
  qsa('.btn-toggle-label', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      var wasActive = btn.getAttribute('data-active') === '1';
      authFetch('/admin/labels/' + id, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !wasActive })
      })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          toast(wasActive ? 'Label deactivated (soft-recalled)' : 'Label activated');
          loadAdminDashboard();
        } else {
          toast(data.message || 'Failed to toggle label status');
        }
      })
      .catch(function(){ toast('Network error updating label'); });
    });
  });

  // Bind delete label (DANGEROUS ACTION -> confirmDialog)
  qsa('.btn-delete-label', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var labelId = btn.getAttribute('data-id');
      var labelCode = btn.getAttribute('data-code');
      var labelName = btn.getAttribute('data-name');
      confirmDialog(
        'Delete Registered Label',
        'Are you sure you want to permanently delete label ' + labelCode + ' (' + labelName + ')? Unauthenticated consumer scans of this label code will no longer be validated against the registry.',
        'Delete Label',
        function(){
          deleteLabel(labelId);
        }
      );
    });
  });
}

function paintScansTable(){
  if (!adminDataCache) return;
  var mount = qs('#admin-scans-table-mount');
  if (!mount) return;

  var vFilter = adminScansVerdictFilter;
  var scans = (adminDataCache.recent_scans || []).filter(function(s){
    if (!vFilter) return true;
    return s.overall === vFilter;
  });

  if (!scans.length){
    mount.innerHTML = '<div style="text-align:center; padding:24px;" class="muted"><p>No scans recorded matching filter.</p></div>';
    return;
  }

  var rows = scans.map(function(s){
    var vMeta = stateMeta(s.overall || 'caution');
    var verdictBadge = '<span class="badge ' + vMeta.color + '"><span class="dot"></span>' + vMeta.label + '</span>';

    return '<tr>' +
      '<td>' +
        '<div style="font-weight:600; color:var(--ink);">' + escapeHtml(s.name) + '</div>' +
        '<div class="faint" style="font-size:11.5px; font-family:monospace;">' + escapeHtml(s.code) + '</div>' +
      '</td>' +
      '<td>' +
        '<div style="font-weight:600; color:var(--ink);">' + escapeHtml(s.user_name || 'Anonymous') + '</div>' +
        '<div class="faint" style="font-size:11.5px;">' + escapeHtml(s.user_email) + '</div>' +
      '</td>' +
      '<td>' +
        '<div style="display:flex; align-items:center; gap:6px;">' +
          '<div style="width:14px; height:14px; border-radius:4px; background:' + escapeHtml(s.color_hex) + '; border:1px solid rgba(0,0,0,0.1);"></div>' +
          '<span>' + escapeHtml(s.ph) + '</span>' +
        '</div>' +
      '</td>' +
      '<td>' + verdictBadge + '</td>' +
      '<td><span class="faint" style="font-size:12px;">' + (s.created_at ? timeAgo(s.created_at) : '—') + '</span></td>' +
    '</tr>';
  }).join('');

  mount.innerHTML =
    '<div class="admin-table-wrap">' +
      '<table class="admin-table">' +
        '<thead><tr>' +
          '<th>Product / Code</th>' +
          '<th>Scanned By</th>' +
          '<th>Pigment / pH</th>' +
          '<th>Verdict</th>' +
          '<th>Time</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

function paintUsersTable(){
  if (!adminDataCache) return;
  var mount = qs('#admin-users-table-mount');
  if (!mount) return;

  var q = adminUsersFilter;
  var users = (adminDataCache.users || []).filter(function(u){
    if (!q) return true;
    return (u.email && u.email.toLowerCase().indexOf(q) >= 0) ||
           (u.name && u.name.toLowerCase().indexOf(q) >= 0);
  });

  if (!users.length){
    mount.innerHTML = '<div style="text-align:center; padding:24px;" class="muted"><p>No users matched search.</p></div>';
    return;
  }

  var rows = users.map(function(u){
    var activeBadge = u.is_active
      ? '<span class="badge safe"><span class="dot"></span>Active</span>'
      : '<span class="badge danger"><span class="dot"></span>Disabled</span>';

    var roleBadge = u.is_admin
      ? '<span class="badge safe" style="font-size:11px; padding:3px 8px;"><span class="dot"></span>Admin</span>'
      : '<span class="badge caution" style="font-size:11px; padding:3px 8px;"><span class="dot"></span>User</span>';

    var verifiedBadge = u.verified
      ? '<span class="badge safe" style="font-size:11px; padding:3px 8px;"><span class="dot"></span>Verified</span>'
      : '<span class="badge caution" style="font-size:11px; padding:3px 8px;"><span class="dot"></span>Unverified</span>';

    var statusBtn = u.is_active
      ? '<button class="btn btn-outline btn-sm btn-action-disable" data-id="' + u.id + '" data-name="' + escapeHtml(u.name || u.email) + '" style="color:var(--danger); border-color:var(--card-border); font-size:11.5px;">' + ICON.cross + ' Disable</button>'
      : '<button class="btn btn-outline btn-sm btn-action-enable" data-id="' + u.id + '" data-name="' + escapeHtml(u.name || u.email) + '" style="color:var(--safe); border-color:var(--card-border); font-size:11.5px;">' + ICON.check + ' Enable</button>';

    var roleBtn = u.is_admin
      ? '<button class="btn btn-outline btn-sm btn-action-demote" data-id="' + u.id + '" data-name="' + escapeHtml(u.name || u.email) + '" style="font-size:11.5px;">Demote</button>'
      : '<button class="btn btn-outline btn-sm btn-action-promote" data-id="' + u.id + '" data-name="' + escapeHtml(u.name || u.email) + '" style="font-size:11.5px;">Promote</button>';

    return '<tr>' +
      '<td>' +
        '<div style="font-weight:600; color:var(--ink);">' + escapeHtml(u.name || 'Anonymous User') + '</div>' +
        '<div class="faint" style="font-size:11.5px; font-family:monospace;">' + escapeHtml(u.email) + '</div>' +
      '</td>' +
      '<td>' + roleBadge + '</td>' +
      '<td>' + verifiedBadge + '</td>' +
      '<td>' + (u.created_at ? timeAgo(u.created_at) : '—') + '</td>' +
      '<td style="text-align:center;"><span style="font-weight:700;">' + (u.scan_count || 0) + '</span></td>' +
      '<td>' + activeBadge + '</td>' +
      '<td><div style="display:flex; gap:6px;">' + statusBtn + roleBtn + '</div></td>' +
    '</tr>';
  }).join('');

  mount.innerHTML =
    '<div class="admin-table-wrap">' +
      '<table class="admin-table">' +
        '<thead><tr>' +
          '<th>User</th>' +
          '<th>Role</th>' +
          '<th>Verification</th>' +
          '<th>Joined</th>' +
          '<th style="text-align:center;">Scans</th>' +
          '<th>Status</th>' +
          '<th>Actions</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  // Bind disable user actions (DANGEROUS ACTION -> confirmDialog)
  qsa('.btn-action-disable', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var userId = btn.getAttribute('data-id');
      var userName = btn.getAttribute('data-name');
      confirmDialog(
        'Disable User Account',
        'Are you sure you want to disable account for ' + userName + '? The user will be immediately blocked from signing in or running fresh scans.',
        'Disable Account',
        function(){
          toggleUserStatus(userId);
        }
      );
    });
  });

  // Bind enable user actions
  qsa('.btn-action-enable', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var userId = btn.getAttribute('data-id');
      toggleUserStatus(userId);
    });
  });

  // Bind promote to admin (CONFIRMATION -> confirmDialog)
  qsa('.btn-action-promote', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var userId = btn.getAttribute('data-id');
      var userName = btn.getAttribute('data-name');
      confirmDialog(
        'Promote to Admin',
        'Promote ' + userName + ' to Administrator? They will have full access to view scans, manage users, and modify labels.',
        'Promote',
        function(){
          toggleUserAdminRole(userId, true);
        }
      );
    });
  });

  // Bind demote admin (CONFIRMATION -> confirmDialog)
  qsa('.btn-action-demote', mount).forEach(function(btn){
    btn.addEventListener('click', function(){
      var userId = btn.getAttribute('data-id');
      var userName = btn.getAttribute('data-name');
      confirmDialog(
        'Revoke Admin Privileges',
        'Are you sure you want to revoke Administrator status for ' + userName + '?',
        'Revoke Admin',
        function(){
          toggleUserAdminRole(userId, false);
        }
      );
    });
  });
}

function toggleUserStatus(userId){
  authFetch('/admin/users/' + userId + '/toggle-status', { method: 'PATCH' })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (data.success){
        toast(data.message || 'User status updated');
        loadAdminDashboard();
      } else {
        toast(data.message || 'Failed to update user status');
      }
    })
    .catch(function(){ toast('Network error while updating user'); });
}

function toggleUserAdminRole(userId, willBeAdmin){
  authFetch('/admin/users/' + userId, {
    method: 'PATCH',
    body: JSON.stringify({ is_admin: willBeAdmin })
  })
  .then(function(res){ return res.json(); })
  .then(function(data){
    if (data.success){
      toast(data.message || 'User role updated');
      loadAdminDashboard();
    } else {
      toast(data.message || 'Failed to update user role');
    }
  })
  .catch(function(){ toast('Network error while updating role'); });
}

function deleteLabel(labelId){
  authFetch('/admin/labels/' + labelId, { method: 'DELETE' })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (data.success){
        toast(data.message || 'Label deleted successfully');
        loadAdminDashboard();
      } else {
        toast(data.message || 'Failed to delete label');
      }
    })
    .catch(function(){ toast('Network error while deleting label'); });
}

/* ======================================================================
   COLOR MATH
   ====================================================================== */
function rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  var max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  var h=0;
  if(d!==0){
    if(max===r) h = 60*(((g-b)/d)%6);
    else if(max===g) h = 60*((b-r)/d+2);
    else h = 60*((r-g)/d+4);
  }
  if(h<0) h+=360;
  var s = max===0 ? 0 : d/max;
  var v = max;
  return {h:h, s:s, v:v};
}
function rgbHex(r,g,b){
  function h(n){ n=Math.round(clamp(n,0,255)); var s=n.toString(16); return s.length<2?'0'+s:s; }
  return '#'+h(r)+h(g)+h(b);
}
function stdev(arr){
  if(arr.length<2) return 0;
  var m = arr.reduce(function(a,b){return a+b;},0)/arr.length;
  var v = arr.reduce(function(a,b){return a+(b-m)*(b-m);},0)/arr.length;
  return Math.sqrt(v);
}

/* ======================================================================
   EXPIRY LOGIC
   ====================================================================== */
function expiryVerdict(exp){
  if(!(exp instanceof Date) || isNaN(exp)){
    return {state:'caution', label:'Expiry unknown', desc:'This label did not carry a readable expiry date.'};
  }
  var days = daysBetween(new Date(), new Date(exp));
  if(days < 0) return {state:'danger', label:'Expired '+Math.abs(days)+' day'+(Math.abs(days)===1?'':'s')+' ago', desc:'This product passed its expiry date on '+fmtDate(exp)+'.'};
  if(days === 0) return {state:'caution', label:'Expires today', desc:'Best consumed today — expiry date is '+fmtDate(exp)+'.'};
  if(days <= 2) return {state:'caution', label:'Expires in '+days+' day'+(days===1?'':'s'), desc:'Best consumed soon — expiry date is '+fmtDate(exp)+'.'};
  return {state:'safe', label:days+' days remaining', desc:'Well within date — expires '+fmtDate(exp)+'.'};
}

/* ======================================================================
   QR PAYLOAD PARSING
   ====================================================================== */
function parseQrPayload(text){
  text = (text||'').trim();
  try{
    var obj = JSON.parse(text);
    if(obj && (obj.code || obj.name)){
      return {
        code: obj.code || '—', name: obj.name || 'Unnamed product', company: obj.company || '—',
        qty: obj.qty || '', mfg: obj.mfg ? new Date(obj.mfg) : null, exp: obj.exp ? new Date(obj.exp) : null,
        found:true
      };
    }
  }catch(e){}
  var code = text.toUpperCase();
  var rec = PRODUCT_DB[code];
  if(rec) return {code:rec.code, name:rec.name, company:rec.company, qty:rec.qty, mfg:rec.mfg, exp:rec.exp, found:true};
  var stripped = code.replace(/[^A-Z0-9!@#$%^&*?]/g,'');
  return {code:code, found:false, invalidFormat: stripped.length!==16, name:null};
}

/* ======================================================================
   BACKEND CALL — POST /scan/analyze does the label lookup + pigment
   classification + expiry check + combined verdict server-side. If the
   backend isn't reachable (static hosting, offline, etc.) callers fall
   back to the local PRODUCT_DB + client-side classification below.
   ====================================================================== */
function extractRawCode(text){
  text = (text||'').trim();
  try{
    var obj = JSON.parse(text);
    if (obj && obj.code) return obj.code;
  }catch(e){}
  return text;
}

function tryServerAnalyze(rawCode, hsv, colorHex){
  var body = { code: (rawCode||'').toUpperCase() };
  if (hsv){ body.hue = hsv.h; body.saturation = hsv.s; body.value = hsv.v; }
  if (colorHex) body.color_hex = colorHex;
  var auth = getAuth();
  var headers = { 'Content-Type': 'application/json' };
  if (auth && auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  return fetch(API_BASE + '/scan/analyze', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  }).then(function(res){
    if (!res.ok) throw new Error('Server responded ' + res.status);
    return res.json();
  }).then(function(data){
    API_AVAILABLE = true;
    return data;
  }).catch(function(){
    API_AVAILABLE = false;
    return null;
  });
}

/* ======================================================================
   SCAN ENGINE (mobile, live camera)
   ====================================================================== */
var Engine = {
  stream:null, video:null, canvas:null, rafId:null, step:'pigment',
  pigmentBuf:[], lastPigment:null, running:false, qrTries:0
};

function stopScanEngine(){
  Engine.running = false;
  if (Engine.rafId) cancelAnimationFrame(Engine.rafId);
  if (Engine.stream){ Engine.stream.getTracks().forEach(function(t){ t.stop(); }); Engine.stream = null; }
  Engine.pigmentBuf = [];
}

function startScanEngine(){
  stopScanEngine();
  Engine.step = 'pigment';
  Engine.pigmentBuf = [];
  Engine.lastPigment = null;
  Engine.qrTries = 0;
  Engine.running = true;

  var video = qs('#scan-video');
  var canvas = qs('#hidden-canvas');
  Engine.video = video; Engine.canvas = canvas;

  if (!window.isSecureContext){
    showScanError('Camera access needs a secure connection (HTTPS). Open this page over HTTPS or on localhost to scan.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    showScanError('This browser does not support camera access. Try the latest Chrome or Safari.');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:1280} }, audio:false })
    .then(function(stream){
      Engine.stream = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline','');
      return video.play();
    })
    .then(function(){
      updateStepUI();
      loop();
    })
    .catch(function(err){
      showScanError('Camera access was blocked or unavailable (' + (err && err.name ? err.name : 'error') + '). Allow camera permission and try again.');
    });

  function loop(){
    if (!Engine.running) return;
    if (video.readyState >= 2){
      if (Engine.step === 'pigment') tickPigment();
      else if (Engine.step === 'qr') tickQr();
    }
    Engine.rafId = requestAnimationFrame(loop);
  }
}

function tickPigment(){
  var s = samplePigment(Engine.video, Engine.canvas);
  if (!s) return;
  var hsv = rgbToHsv(s.r,s.g,s.b);
  Engine.pigmentBuf.push(hsv.h);
  if (Engine.pigmentBuf.length > 14) Engine.pigmentBuf.shift();
  var sd = stdev(Engine.pigmentBuf);
  var stability = Engine.pigmentBuf.length >= 8 ? clamp(1 - sd/40, 0, 1) : Engine.pigmentBuf.length/8*0.3;

  Engine.lastPigment = { r:s.r, g:s.g, b:s.b, hsv:hsv };
  paintReadout(s, hsv, stability);

  if (stability > 0.86 && Engine.pigmentBuf.length >= 10 && !Engine.autoLocking){
    Engine.autoLocking = true;
    setTimeout(function(){
      if (Engine.step === 'pigment') capturePigment();
      Engine.autoLocking = false;
    }, 260);
  }
}

function samplePigment(video, canvas){
  var vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  var frac = 0.5;
  var size = Math.min(vw, vh) * frac;
  var sx = (vw-size)/2, sy = (vh-size)/2;
  var N = 72;
  canvas.width = N; canvas.height = N;
  var ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(video, sx, sy, size, size, 0, 0, N, N);
  var data = ctx.getImageData(0,0,N,N).data;
  var rSum=0,gSum=0,bSum=0,n=0;
  for (var i=0;i<data.length;i+=4){ rSum+=data[i]; gSum+=data[i+1]; bSum+=data[i+2]; n++; }
  return { r:rSum/n, g:gSum/n, b:bSum/n };
}

function paintReadout(s, hsv, stability){
  var swatch = qs('#readout-swatch');
  var title = qs('#readout-title');
  var sub = qs('#readout-sub');
  var hex = rgbHex(s.r,s.g,s.b);
  if (swatch) swatch.style.background = hex;
  var cls = classifyPigment(hsv.h, hsv.s, hsv.v);
  if (title) title.textContent = cls.label + ' · ' + cls.ph;
  if (sub) sub.textContent = stability > 0.86 ? 'Locking reading…' : 'Hold steady over the pigment square';
  var ring = qs('#stability-fg');
  if (ring){
    var c = 2*Math.PI*15;
    ring.style.strokeDasharray = c;
    ring.style.strokeDashoffset = c*(1-stability);
  }
}

function capturePigment(){
  if (!Engine.lastPigment) return;
  Engine.capturedPigment = {
    hex: rgbHex(Engine.lastPigment.r, Engine.lastPigment.g, Engine.lastPigment.b),
    hsv: Engine.lastPigment.hsv,
    classification: classifyPigment(Engine.lastPigment.hsv.h, Engine.lastPigment.hsv.s, Engine.lastPigment.hsv.v)
  };
  Engine.step = 'qr';
  Engine.pigmentBuf = [];
  updateStepUI();
  toast('Pigment reading locked');
}

function tickQr(){
  Engine.qrTries++;
  if (Engine.qrTries % 3 !== 0) return; // throttle for perf
  var video = Engine.video, canvas = Engine.canvas;
  var vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || typeof jsQR === 'undefined') return;
  var scale = Math.min(1, 640/Math.max(vw,vh));
  var w = Math.round(vw*scale), h = Math.round(vh*scale);
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(video, 0, 0, w, h);
  var img = ctx.getImageData(0,0,w,h);
  var code;
  try{ code = jsQR(img.data, w, h, {inversionAttempts:'attemptBoth'}); } catch(e){ code = null; }
  if (code && code.data){
    handleQrDecoded(code.data);
  }
}

function handleQrDecoded(text){
  Engine.step = 'done';
  var pigment = Engine.capturedPigment;
  stopScanEngine();
  showScanBusy();

  var rawCode = extractRawCode(text);
  tryServerAnalyze(rawCode, pigment ? pigment.hsv : null, pigment ? pigment.hex : null)
    .then(function(serverData){
      if (serverData && serverData.success){
        finishScanFromServer(serverData, rawCode, pigment);
      } else {
        finishScan(parseQrPayload(text));
      }
    });
}

function showScanBusy(){
  var host = qs('#scan-stage');
  if (!host) return;
  host.innerHTML = '<div class="card"><div class="empty">'+ICON.qr+'<div style="font-weight:700; color:var(--ink);">Checking this label…</div>'+
    '<div style="font-size:12.5px;">Looking up the code and combining it with your pigment reading.</div></div></div>';
}

function updateStepUI(){
  var s1 = qs('#step-pigment'), s2 = qs('#step-qr');
  var hint = qs('#vf-hint');
  var reticle = qs('#vf-reticle-el');
  var readout = qs('#vf-readout-el');
  if (!s1) return;
  s1.classList.toggle('current', Engine.step==='pigment');
  s1.classList.toggle('done', Engine.step!=='pigment');
  s2.classList.toggle('current', Engine.step==='qr');
  s2.classList.toggle('done', Engine.step==='done');
  if (Engine.step==='pigment'){
    hint.textContent = 'Align the pigment square inside the frame';
    reticle.className = 'vf-reticle'; reticle.id='vf-reticle-el';
    readout.style.display = 'flex';
  } else if (Engine.step==='qr'){
    hint.textContent = 'Now centre the QR code in the frame';
    reticle.className = 'vf-qr-target'; reticle.id='vf-reticle-el';
    readout.style.display = 'none';
  }
}

function showScanError(msg){
  var host = qs('#scan-stage');
  if (!host) return;
  host.innerHTML = '<div class="card"><div class="empty">'+ICON.alert+'<div style="font-weight:700; color:var(--ink);">Camera unavailable</div>'+
    '<div style="font-size:12.5px; max-width:320px;">'+escapeHtml(msg)+'</div>'+
    '<button class="btn btn-dark" id="retry-cam" style="margin-top:6px;">Try again</button></div></div>';
  qs('#retry-cam').addEventListener('click', function(){ renderScan(); });
}

/* ======================================================================
   FINISH SCAN — combine pigment + QR/expiry into one verdict
   ====================================================================== */
function finishScan(payload){
  stopScanEngine();
  var pigment = Engine.capturedPigment;
  var host = qs('#scan-stage');
  if (!host) return;
  var fb = qs('#scan-fallbacks'); if (fb) fb.style.display = 'none';

  if (!payload.found){
    host.innerHTML = resultUnrecognizedHtml(payload, pigment);
    bindResultActions(host, payload);
    return;
  }

  var exp = expiryVerdict(payload.exp);
  var pigState = pigment ? pigment.classification.state : 'caution';
  var overall = worstState(exp.state, pigState);
  var meta = stateMeta(overall);

  host.innerHTML = resultCardHtml(payload, pigment, exp, overall, meta, 'demo');
  bindResultActions(host, payload);
}

/* Result path taken when POST /scan/analyze answered successfully — the
   backend is the source of truth here (label data, pigment classification
   and expiry all come from the server response). */
function finishScanFromServer(serverData, rawCode, pigment){
  var host = qs('#scan-stage');
  if (!host) return;
  var fb = qs('#scan-fallbacks'); if (fb) fb.style.display = 'none';

  if (!serverData.recognised){
    var stripped = (rawCode||'').toUpperCase().replace(/[^A-Z0-9!@#$%^&*?]/g,'');
    var unrecPayload = { code: rawCode, found:false, invalidFormat: stripped.length !== 16 };
    host.innerHTML = resultUnrecognizedHtml(unrecPayload, pigment, serverData.pigment);
    bindResultActions(host, unrecPayload);
    return;
  }

  var label = serverData.label;
  var payload = {
    code: label.code, name: label.name, company: label.company, qty: label.qty,
    mfg: new Date(label.mfg), exp: new Date(label.exp), found: true
  };
  var pigmentForCard = pigment ? { hex: pigment.hex, classification: serverData.pigment } : null;
  var exp = serverData.expiry;
  var overall = serverData.overall;
  var meta = stateMeta(overall);

  // No client-side save needed — POST /scan/analyze already persisted this
  // scan server-side (against the signed-in user, if any) before responding.

  host.innerHTML = resultCardHtml(payload, pigmentForCard, exp, overall, meta, 'live');
  bindResultActions(host, payload);
}

function bindResultActions(host, payload){
  var btn = qs('#scan-again');
  if (btn) btn.addEventListener('click', function(){ renderScan(); });
  qsa('[data-whatsapp-query]', host).forEach(function(wbtn){
    wbtn.addEventListener('click', function(){
      var msg = "Hi "+BRAND_NAME+"! I scanned the label for \""+(payload.name||'this code')+"\" (code "+payload.code+") and wanted to check with you about it.";
      window.open(whatsappLink(msg), '_blank', 'noopener');
    });
  });
}

function resultCardHtml(payload, pigment, exp, overall, meta, source){
  var icon = overall==='safe' ? ICON.check : overall==='caution' ? ICON.alert : ICON.cross;
  var mfgTxt = payload.mfg ? fmtDate(new Date(payload.mfg)) : '—';
  var expTxt = payload.exp ? fmtDate(new Date(payload.exp)) : '—';
  var sourceTag = source === 'live'
    ? '<span class="card-tag" style="color:var(--safe); background:var(--safe-bg);">Verified against your backend</span>'
    : '<span class="card-tag">Demo data</span>';
  return '' +
  '<div class="result-banner '+overall+'">'+
    '<div class="rb-icon" style="background:var(--'+meta.color+'); color:#fff;">'+icon+'</div>'+
    '<div><h3>'+meta.label+'</h3><p>'+escapeHtml(payload.name)+' · '+escapeHtml(payload.company||'')+'</p></div>'+
  '</div>'+
  '<div class="grid grid-2" style="margin-top:16px;">'+
    '<div class="card tight">'+
      '<div class="card-head"><h3>Pigment reading</h3></div>'+
      (pigment ? (
        '<div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">'+
          '<div class="swatch" style="width:46px;height:46px;background:'+pigment.hex+';"></div>'+
          '<div><div style="font-weight:700; font-size:14px;">'+pigment.classification.label+'</div><div class="faint" style="font-size:11.5px;">'+pigment.classification.ph+' · '+pigment.hex+'</div></div>'+
        '</div><p class="muted" style="font-size:12px; line-height:1.55;">'+pigment.classification.desc+'</p>'
      ) : '<p class="muted" style="font-size:12px;">Pigment step was skipped.</p>') +
    '</div>'+
    '<div class="card tight">'+
      '<div class="card-head"><h3>Expiry check</h3></div>'+
      '<span class="badge '+exp.state+'"><span class="dot"></span>'+exp.label+'</span>'+
      '<p class="muted" style="font-size:12px; line-height:1.55; margin-top:10px;">'+exp.desc+'</p>'+
    '</div>'+
  '</div>'+
  '<div class="card tight" style="margin-top:16px;">'+
    '<div class="card-head"><h3>Label details</h3>'+sourceTag+'</div>'+
    '<div class="kv-list">'+
      kv('Product', payload.name)+
      kv('Company', payload.company||'—')+
      (payload.qty ? kv('Quantity', payload.qty) : '')+
      kv('Manufactured', mfgTxt)+
      kv('Expiry', expTxt)+
      kv('Label code', '<span style="font-family:ui-monospace,monospace; letter-spacing:.02em;">'+escapeHtml(payload.code)+'</span>')+
    '</div>'+
  '</div>'+
  '<div style="display:flex; gap:10px; margin-top:18px; flex-wrap:wrap;">'+
    '<button class="btn btn-dark" id="scan-again">'+ICON.scan+' Scan another label</button>'+
    '<button class="btn btn-whatsapp" data-whatsapp-query>'+ICON.whatsapp+' Ask us about this</button>'+
  '</div>';
}

function resultUnrecognizedHtml(payload, pigment, serverPigment){
  var pigInfo = serverPigment || (pigment ? pigment.classification : null);
  return '' +
  '<div class="result-banner danger">'+
    '<div class="rb-icon" style="background:var(--danger); color:#fff;">'+ICON.cross+'</div>'+
    '<div><h3>Label not recognised</h3><p>This QR code isn\'t linked to a known '+BRAND_NAME+' product.</p></div>'+
  '</div>'+
  '<div class="card tight" style="margin-top:16px;">'+
    '<div class="kv-list">'+
      kv('Scanned code', '<span style="font-family:ui-monospace,monospace;">'+escapeHtml(payload.code||'—')+'</span>')+
      kv('Format looks like a genuine code', payload.invalidFormat ? 'No — length/format mismatch' : 'Yes, but not in our records')+
      (pigInfo ? kv('Pigment reading', pigInfo.label+' · '+pigInfo.ph) : '')+
    '</div>'+
    '<p class="muted" style="font-size:12px; margin-top:10px; line-height:1.6;">If you bought this expecting a '+BRAND_NAME+' label, message us the code below and we\'ll verify it for you.</p>'+
  '</div>'+
  '<div style="display:flex; gap:10px; margin-top:18px; flex-wrap:wrap;">'+
    '<button class="btn btn-dark" id="scan-again">'+ICON.scan+' Scan again</button>'+
    '<a class="btn btn-whatsapp" target="_blank" rel="noopener" href="'+whatsappLink("Hi "+BRAND_NAME+"! I scanned a label with the code \""+(payload.code||'')+"\" and it wasn't recognised — could you check if it's genuine?")+'">'+ICON.whatsapp+' Report this code</a>'+
  '</div>';
}

function kv(k,v){ return '<div class="kv-row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }

/* ======================================================================
   VIEW: SCAN
   ====================================================================== */
function renderScan(){
  var host = qs('#view-scan');

  if (!isMobile()){
    host.innerHTML =
    '<div class="scan-shell">'+
      '<div class="card">'+
        '<div class="desktop-guard">'+
          '<div class="stat-icon" style="width:56px;height:56px;background:var(--panel); color:var(--ink);">'+ICON.scan+'</div>'+
          '<div>'+
            '<h2 style="font-size:19px;">The live scanner is built for mobile</h2>'+
            '<p class="muted" style="font-size:13px; max-width:360px; margin-top:6px; line-height:1.6;">Reading a printed pigment strip and a QR code needs a handheld rear camera, so scanning is enabled on phones and tablets. Open this page on your phone to try it for real.</p>'+
          '</div>'+
          '<div class="qrbox" id="desktop-qr-mount"></div>'+
          '<p class="faint" style="font-size:11.5px;">Scan this with your phone\'s camera to open '+BRAND_NAME+' here</p>'+
          '<button class="btn btn-dark btn-lg" id="run-demo-scan">'+ICON.scan+' Run a demo scan on this screen</button>'+
        '</div>'+
      '</div>'+
      '<div class="card" id="scan-stage">'+
        '<div class="card-head"><h3>Result preview</h3><span class="card-tag">Demo mode</span></div>'+
        '<div class="empty">'+ICON.qr+'<div style="font-weight:700; color:var(--ink);">No scan yet</div><div style="font-size:12.5px;">Run a demo scan to see how a result looks.</div></div>'+
      '</div>'+
    '</div>';

    mountDesktopQr();
    qs('#run-demo-scan').addEventListener('click', runDesktopDemo);
    return;
  }

  host.innerHTML =
  '<div class="scan-steps">'+
    '<div class="scan-step current" id="step-pigment"><div class="num">1</div><div><small>Pigment</small><span>Colour check</span></div></div>'+
    '<div class="scan-step" id="step-qr"><div class="num">2</div><div><small>QR code</small><span>Identity check</span></div></div>'+
  '</div>'+
  '<div id="scan-stage">'+
    '<div class="viewfinder-wrap rear">'+
      '<video id="scan-video" autoplay muted playsinline></video>'+
      '<div class="vf-overlay">'+
        '<div id="vf-hint" class="vf-hint">Align the pigment square inside the frame</div>'+
        '<div class="vf-reticle" id="vf-reticle-el"></div>'+
        '<div class="vf-readout" id="vf-readout-el">'+
          '<div class="rs" id="readout-swatch" style="background:#888;"></div>'+
          '<div class="rt"><b id="readout-title">Reading…</b><span id="readout-sub">Hold steady over the pigment square</span></div>'+
          '<div class="vf-stability"><svg viewBox="0 0 34 34"><circle class="bg" cx="17" cy="17" r="15"></circle><circle class="fg" id="stability-fg" cx="17" cy="17" r="15"></circle></svg></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">'+
      '<button class="btn btn-dark btn-block" id="manual-capture">'+ICON.check+' Capture reading now</button>'+
    '</div>'+
  '</div>'+
  '<div style="display:flex; justify-content:space-between; margin-top:12px; flex-wrap:wrap; gap:8px;" id="scan-fallbacks">'+
    '<button class="btn btn-outline" id="enter-code-manually" style="font-size:12.5px; padding:9px 14px;">Enter QR code manually</button>'+
    '<button class="btn btn-outline" id="view-sample-label" style="font-size:12.5px; padding:9px 14px;">View a sample label</button>'+
  '</div>';

  qs('#manual-capture').addEventListener('click', function(){
    if (Engine.step === 'pigment') capturePigment();
  });
  qs('#enter-code-manually').addEventListener('click', openManualCodeModal);
  qs('#view-sample-label').addEventListener('click', openSampleLabelModal);

  startScanEngine();
}

function mountDesktopQr(){
  var mount = qs('#desktop-qr-mount');
  if (!mount || typeof QRCode === 'undefined') { if(mount) mount.innerHTML='<div class="faint" style="font-size:11px;">QR preview unavailable offline</div>'; return; }
  mount.innerHTML = '';
  new QRCode(mount, { text: location.href, width:150, height:150, colorDark:'#15171a', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function runDesktopDemo(){
  var code = DEMO_CODES[Math.floor(Math.random()*DEMO_CODES.length)];
  var rec = PRODUCT_DB[code];
  var hues = [10, 300, 235, 150, 65]; // spans the spectrum for variety
  var h = hues[Math.floor(Math.random()*hues.length)];
  var hsv = {h:h, s:0.55, v:0.7};
  var rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  Engine.capturedPigment = { hex: rgbHex(rgb.r,rgb.g,rgb.b), hsv:hsv, classification: classifyPigment(hsv.h,hsv.s,hsv.v) };
  var payload = { code:rec.code, name:rec.name, company:rec.company, qty:rec.qty, mfg:rec.mfg, exp:rec.exp, found:true };
  var stage = qs('#scan-stage');
  stage.innerHTML = '<div class="card-head"><h3>Result preview</h3><span class="card-tag">Demo mode</span></div><div id="scan-stage-inner"></div>';
  finishScanInto(qs('#scan-stage-inner'), payload);
}

// finishScan variant that targets an arbitrary container (used by desktop demo)
function finishScanInto(container, payload){
  var pigment = Engine.capturedPigment;
  var exp = expiryVerdict(payload.exp);
  var pigState = pigment ? pigment.classification.state : 'caution';
  var overall = worstState(exp.state, pigState);
  var meta = stateMeta(overall);
  container.innerHTML = resultCardHtml(payload, pigment, exp, overall, meta, 'demo');
  bindResultActions(container, payload);
}

function hsvToRgb(h,s,v){
  var c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c, r,g,b;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return {r:(r+m)*255, g:(g+m)*255, b:(b+m)*255};
}

function openManualCodeModal(){
  openModal(
    '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Enter label code</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
    '<p class="muted" style="font-size:12.5px; margin-top:6px;">Type the 16-character code printed under the QR square.</p>'+
    '<input id="manual-code-input" placeholder="e.g. K7#9-QD4$-N2!B-8XM6" style="width:100%; margin-top:14px; padding:13px 14px; border-radius:12px; border:1.5px solid var(--card-border); background:var(--card); color:var(--ink); font-size:14px; font-family:ui-monospace,monospace;">'+
    '<button class="btn btn-dark btn-block" id="submit-manual-code" style="margin-top:14px;">Check this code</button>'
  );
  qs('#submit-manual-code').addEventListener('click', function(){
    var v = qs('#manual-code-input').value;
    if (!v.trim()) return;
    closeModal();
    handleQrDecoded(v);
  });
}

var demoQrTimer = null;
function openSampleLabelModal(){
  var idx = 0;
  function paint(){
    var code = DEMO_CODES[idx];
    var rec = PRODUCT_DB[code];
    var payload = JSON.stringify({code:rec.code, name:rec.name, company:rec.company, qty:rec.qty, mfg:rec.mfg.toISOString().slice(0,10), exp:rec.exp.toISOString().slice(0,10)});
    var hue = [340, 300, 235, 150][idx % 4];
    var rgb = hsvToRgb(hue, 0.55, 0.72);
    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Sample label</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<p class="muted" style="font-size:12.5px; margin:6px 0 16px;">View this on a second screen and scan it with your phone to test the flow, or tap next to cycle.</p>'+
      '<div style="background:var(--card); border:1.5px dashed var(--card-border); border-radius:18px; padding:16px; display:flex; flex-direction:column; align-items:center; gap:12px;">'+
        '<div style="width:64px; height:64px; border-radius:14px; background:'+rgbHex(rgb.r,rgb.g,rgb.b)+'; box-shadow:inset 0 0 0 3px #ffffffb0, var(--shadow-2);"></div>'+
        '<div id="sample-qr-mount"></div>'+
        '<div style="text-align:center;"><div style="font-weight:700; font-size:13.5px;">'+escapeHtml(rec.name)+'</div><div class="faint" style="font-size:11px; font-family:ui-monospace,monospace; margin-top:2px;">'+escapeHtml(rec.code)+'</div></div>'+
      '</div>'+
      '<button class="btn btn-outline btn-block" id="next-sample" style="margin-top:14px;">Next sample label</button>'
    );
    var mount = qs('#sample-qr-mount');
    if (mount && typeof QRCode !== 'undefined'){
      new QRCode(mount, { text: payload, width:130, height:130, colorDark:'#15171a', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }
    qs('#next-sample').addEventListener('click', function(){ idx = (idx+1) % DEMO_CODES.length; paint(); });
  }
  paint();
}
function stopDemoQrRefresh(){ if (demoQrTimer) clearInterval(demoQrTimer); demoQrTimer = null; }

/* ======================================================================
   MISC UI BINDINGS
   ====================================================================== */
function bindGlobalUi(){
  qs('#btn-theme').addEventListener('click', toggleTheme);
  qs('#btn-search').addEventListener('click', openSearchModal);

  qs('#btn-alerts').addEventListener('click', function(){
    if (!isLoggedIn()){
      openModal(
        '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Notifications</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
        signInPrompt('Sign in for notifications', 'We\'ll flag scans that need attention here once you\'re signed in.')
      );
      bindSignInPrompts(qs('#modal-mount'));
      return;
    }
    qs('#alert-dot').style.display = 'none';
    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Notifications</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<div id="notif-body" style="margin-top:14px; display:flex; flex-direction:column; gap:10px;"><p class="faint" style="font-size:12.5px;">Loading…</p></div>'
    );
    fetchServerHistory().then(function(hist){
      var flagged = hist.map(normalizeScan).filter(function(h){ return h.overall !== 'safe'; }).slice(0,5);
      var body = qs('#notif-body');
      if (!body) return;
      body.innerHTML = flagged.length ? flagged.map(function(h){
        return '<div style="display:flex; gap:10px; align-items:center; padding:10px; border-radius:12px; background:var(--panel);">'+
          '<div class="swatch" style="width:34px;height:34px;background:'+h.hex+';"></div>'+
          '<div style="flex:1; font-size:12.5px;"><b>'+escapeHtml(h.name)+'</b><br><span class="faint">flagged '+timeAgo(h.when)+'</span></div>'+
          '<span class="badge '+h.overall+'">'+stateMeta(h.overall).label+'</span></div>';
      }).join('') : '<p class="faint" style="font-size:12.5px;">No flagged scans — everything checked out safe.</p>';
    });
  });

  qs('#btn-avatar').addEventListener('click', function(){
    var auth = getAuth();
    if (auth && auth.token){
      openModal(
        '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Your account</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
        '<div style="display:flex; align-items:center; gap:12px; margin-top:16px;">'+
          '<div class="avatar-btn" style="width:52px;height:52px;font-size:17px;">'+escapeHtml((auth.name||'?').trim().split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase())+'</div>'+
          '<div><div style="font-weight:700; font-size:14.5px;">'+escapeHtml(auth.name||'')+'</div><div class="faint" style="font-size:12px;">'+escapeHtml(auth.email||'')+' · Signed in</div></div>'+
        '</div>'+
        '<p class="muted" style="font-size:12.5px; margin-top:16px; line-height:1.6;">Your scan history and notifications are tied to this account and only visible to you.</p>'+
        '<a class="btn btn-dark btn-block" href="#/settings" data-close-modal style="margin-top:16px;">'+ICON.settings+' Settings</a>'+
        '<button class="btn btn-outline btn-block" id="sign-out-btn" style="margin-top:10px;">Sign out</button>'
      );
      qs('#sign-out-btn').addEventListener('click', function(){
        confirmDialog('Sign out', 'Do you definitely want to sign out?', 'Sign out', function(){
          clearAuth();
          toast('Signed out');
          refreshAuthUi();
        });
      });
      return;
    }

    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Your account</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<div style="display:flex; align-items:center; gap:12px; margin-top:16px;">'+
        '<div class="avatar-btn" style="width:52px;height:52px;font-size:17px;">?</div>'+
        '<div><div style="font-weight:700; font-size:14.5px;">Guest Account</div><div class="faint" style="font-size:12px;">Not signed in · on this device</div></div>'+
      '</div>'+
      '<p class="muted" style="font-size:12.5px; margin-top:16px; line-height:1.6;">Scan history and notifications are only visible after you sign in — a guest session can\'t see or save either.</p>'+
      '<button class="btn btn-dark btn-block" id="open-signin-btn" style="margin-top:16px;">Sign in or create account</button>'
    );
    qs('#open-signin-btn').addEventListener('click', function(){ openAuthModal('signin'); });
  });
}

function openSearchModal(){
  var searchIcon = ICON.search;
  var chevronIcon = ICON.chevron;

  var initialHtml =
    '<div class="search-header">'+
      '<div class="search-header-title">'+
        '<div class="search-item-icon" style="width:28px;height:28px;background:var(--panel);">'+searchIcon+'</div>'+
        '<span>Search</span>'+
      '</div>'+
      '<button class="modal-close" data-close-modal>'+ICON.cross+'</button>'+
    '</div>'+
    '<div class="search-box">'+
      '<div class="search-box-icon">'+searchIcon+'</div>'+
      '<input id="global-search-input" class="search-input" placeholder="Search products, labels or scan history…" autocomplete="off" spellcheck="false">'+
      '<button type="button" class="search-clear-btn" id="search-clear-btn" aria-label="Clear search">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'+
      '</button>'+
    '</div>'+
    '<div id="global-search-results" class="search-results-wrap"></div>';

  openModal(initialHtml, 'search-modal');

  var input = qs('#global-search-input');
  var clearBtn = qs('#search-clear-btn');
  var results = qs('#global-search-results');
  if (!input || !results) return;

  function renderSuggestions(){
    var chips = ['Fresh Paneer', 'Whole Milk', 'Greek Yogurt', 'Chicken Mince', 'Starter Pack', 'Cold-Chain'];
    var html =
      '<div class="search-suggestions">'+
        '<div class="search-suggestions-title">Quick searches</div>'+
        '<div class="search-chips">'+
          chips.map(function(c){
            return '<button type="button" class="search-chip" data-search-term="'+escapeHtml(c)+'">'+escapeHtml(c)+'</button>';
          }).join('')+
        '</div>'+
      '</div>';
    results.innerHTML = html;
    qsa('[data-search-term]', results).forEach(function(btn){
      btn.addEventListener('click', function(){
        input.value = btn.dataset.searchTerm;
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    });
  }

  renderSuggestions();
  setTimeout(function(){ input.focus(); }, 60);

  if (clearBtn){
    clearBtn.addEventListener('click', function(){
      input.value = '';
      clearBtn.style.display = 'none';
      renderSuggestions();
      input.focus();
    });
  }

  var historyPromise = isLoggedIn() ? fetchServerHistory() : Promise.resolve([]);
  historyPromise.then(function(hist){
    var rows = (hist || []).map(normalizeScan);

    input.addEventListener('input', function(){
      var q = input.value.trim().toLowerCase();
      if (clearBtn){
        clearBtn.style.display = q ? 'inline-flex' : 'none';
      }
      if (!q){
        renderSuggestions();
        return;
      }

      // 1. Products matching
      var prods = SHOP_PRODUCTS.filter(function(p){
        return p.name.toLowerCase().indexOf(q) >= 0 ||
               (p.desc && p.desc.toLowerCase().indexOf(q) >= 0) ||
               (p.price && p.price.toLowerCase().indexOf(q) >= 0);
      });

      // 2. Demo labels matching
      var demoMatches = [];
      Object.keys(PRODUCT_DB).forEach(function(code){
        var rec = PRODUCT_DB[code];
        if (rec.name.toLowerCase().indexOf(q) >= 0 ||
            code.toLowerCase().indexOf(q) >= 0 ||
            (rec.company && rec.company.toLowerCase().indexOf(q) >= 0)){
          demoMatches.push(rec);
        }
      });

      // 3. Scan history matching
      var historyMatches = rows.filter(function(h){
        return (h.name && h.name.toLowerCase().indexOf(q) >= 0) ||
               (h.overall && h.overall.toLowerCase().indexOf(q) >= 0) ||
               (h.ph && h.ph.toLowerCase().indexOf(q) >= 0);
      });

      var totalMatches = prods.length + demoMatches.length + historyMatches.length;

      if (totalMatches === 0){
        results.innerHTML =
          '<div class="search-empty">'+
            '<div class="search-empty-icon">'+searchIcon+'</div>'+
            '<div class="search-empty-title">No matches found for "'+escapeHtml(input.value.trim())+'"</div>'+
            '<div class="search-empty-sub">Try searching for products like "Paneer", "Milk", "Yogurt", or pack sizes like "Starter" or "Retail".</div>'+
          '</div>';
        return;
      }

      var html = '';

      // Render Products Section
      if (prods.length){
        html += '<div class="search-section">';
        html += '<div class="search-section-head"><span>Products ('+prods.length+')</span><span class="search-pill-tag">Shop</span></div>';
        prods.forEach(function(p){
          html +=
            '<div class="search-item" data-nav="products">'+
              '<div class="search-item-icon product-icon">'+ICON.box+'</div>'+
              '<div class="search-item-body">'+
                '<div class="search-item-title">'+escapeHtml(p.name)+'</div>'+
                '<div class="search-item-meta">'+escapeHtml(p.unit || p.desc)+'</div>'+
              '</div>'+
              '<div class="search-item-end">'+
                '<span class="search-price-tag">'+escapeHtml(p.price)+'</span>'+
                '<span class="search-chevron">'+chevronIcon+'</span>'+
              '</div>'+
            '</div>';
        });
        html += '</div>';
      }

      // Render Demo Labels Section
      if (demoMatches.length){
        html += '<div class="search-section">';
        html += '<div class="search-section-head"><span>Food Labels ('+demoMatches.length+')</span><span class="search-pill-tag">Sample QR</span></div>';
        demoMatches.forEach(function(m){
          html +=
            '<div class="search-item" data-sample-code="'+escapeHtml(m.code)+'">'+
              '<div class="search-item-icon label-icon">'+ICON.qr+'</div>'+
              '<div class="search-item-body">'+
                '<div class="search-item-title">'+escapeHtml(m.name)+'</div>'+
                '<div class="search-item-meta">'+escapeHtml(m.qty ? m.qty + ' · ' : '')+escapeHtml(m.code)+'</div>'+
              '</div>'+
              '<div class="search-item-end">'+
                '<span class="search-pill-tag">View QR</span>'+
                '<span class="search-chevron">'+chevronIcon+'</span>'+
              '</div>'+
            '</div>';
        });
        html += '</div>';
      }

      // Render Scan History Section
      if (historyMatches.length){
        html += '<div class="search-section">';
        html += '<div class="search-section-head"><span>Scan History ('+historyMatches.length+')</span><span class="search-pill-tag">History</span></div>';
        historyMatches.slice(0, 6).forEach(function(h){
          var badgeCls = h.overall || 'caution';
          var badgeLabel = stateMeta(h.overall).label;
          html +=
            '<div class="search-item" data-nav="history">'+
              '<div class="swatch" style="width:36px;height:36px;border-radius:11px;background:'+(h.hex || 'var(--card-border)')+';"></div>'+
              '<div class="search-item-body">'+
                '<div class="search-item-title">'+escapeHtml(h.name)+'</div>'+
                '<div class="search-item-meta">'+timeAgo(h.when)+' · '+escapeHtml(h.ph)+'</div>'+
              '</div>'+
              '<div class="search-item-end">'+
                '<span class="badge '+badgeCls+'" style="font-size:10.5px;padding:3px 8px;">'+badgeLabel+'</span>'+
                '<span class="search-chevron">'+chevronIcon+'</span>'+
              '</div>'+
            '</div>';
        });
        html += '</div>';
      }

      results.innerHTML = html;

      // Bind click navigation
      qsa('[data-nav]', results).forEach(function(item){
        item.addEventListener('click', function(){
          var route = item.dataset.nav;
          closeModal();
          navigate(route);
        });
      });
      qsa('[data-sample-code]', results).forEach(function(item){
        item.addEventListener('click', function(){
          closeModal();
          openSampleLabelModal();
        });
      });
    });
  });
}

/* ======================================================================
   AUTH MODAL — sign in / create account / OTP verification / Google
   ====================================================================== */
function authTabsHtml(active){
  return '<div style="display:flex; gap:6px; margin-top:14px; background:var(--panel); border-radius:12px; padding:4px;">'+
    '<button data-auth-tab="signin" style="flex:1; padding:9px; border:none; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; background:'+(active==='signin'?'var(--card)':'transparent')+'; color:var(--ink); box-shadow:'+(active==='signin'?'var(--shadow-2)':'none')+';">Sign in</button>'+
    '<button data-auth-tab="signup" style="flex:1; padding:9px; border:none; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; background:'+(active==='signup'?'var(--card)':'transparent')+'; color:var(--ink); box-shadow:'+(active==='signup'?'var(--shadow-2)':'none')+';">Create account</button>'+
  '</div>';
}
function authInputHtml(id, type, placeholder){
  return '<input id="'+id+'" type="'+type+'" placeholder="'+placeholder+'" autocomplete="'+(type==='password'?'current-password':'on')+'" style="width:100%; margin-top:10px; padding:13px 14px; border-radius:12px; border:1.5px solid var(--card-border); background:var(--card); color:var(--ink); font-size:14px;">';
}
function authErrorHtml(){ return '<p id="auth-error" class="faint" style="font-size:12.5px; margin-top:10px; color:var(--danger); display:none;"></p>'; }
function showAuthError(msg){
  var el = qs('#auth-error');
  if (el){ el.textContent = msg; el.style.display = 'block'; }
}
function googleButtonHtml(){
  if (!window.ANTHOLYTIX_GOOGLE_CLIENT_ID) return '';
  return '<div style="display:flex; align-items:center; gap:10px; margin:16px 0 12px;"><div style="flex:1; height:1px; background:var(--card-border);"></div><span class="faint" style="font-size:11.5px;">or</span><div style="flex:1; height:1px; background:var(--card-border);"></div></div>'+
    '<div id="google-btn-mount" style="display:flex; justify-content:center;"></div>';
}
function mountGoogleButton(){
  var mount = qs('#google-btn-mount');
  if (!mount || !window.ANTHOLYTIX_GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id){
    mount.innerHTML = '<p class="faint" style="font-size:11px;">Google sign-in is still loading…</p>';
    return;
  }
  try{
    google.accounts.id.initialize({ client_id: window.ANTHOLYTIX_GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    google.accounts.id.renderButton(mount, { theme: getTheme()==='dark' ? 'filled_black' : 'outline', size: 'large', width: 280 });
  }catch(e){ mount.innerHTML = '<p class="faint" style="font-size:11px;">Google sign-in unavailable.</p>'; }
}
function handleGoogleCredential(response){
  fetch(API_BASE + '/auth/google', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: response.credential })
  }).then(function(res){ return res.json(); })
    .then(function(data){
      if (data && data.success){
        setAuth({ token: data.token, name: data.name, email: data.email, is_admin: !!data.is_admin });
        closeModal(); toast('Signed in'); refreshAuthUi();
      } else {
        showAuthError((data && data.message) || 'Google sign-in failed.');
      }
    }).catch(function(){ showAuthError('Could not reach the server.'); });
}

function openAuthModal(tab){
  tab = tab || 'signin';
  if (tab === 'signup') renderAuthSignUp(); else renderAuthSignIn();
}

function renderAuthSignIn(){
  openModal(
    '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Sign in</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
    authTabsHtml('signin')+
    authInputHtml('signin-email','text','Email address or admin')+
    authInputHtml('signin-password','password','Password')+
    authErrorHtml()+
    '<button class="btn btn-dark btn-block" id="signin-submit" style="margin-top:14px;">Sign in</button>'+
    googleButtonHtml()
  );
  bindAuthTabs();
  mountGoogleButton();
  qs('#signin-submit').addEventListener('click', function(){
    var email = qs('#signin-email').value.trim().toLowerCase();
    var password = qs('#signin-password').value;
    if (!email || !password){ showAuthError('Enter your email and password.'); return; }
    var btn = qs('#signin-submit'); btn.disabled = true; btn.textContent = 'Signing in…';
    fetch(API_BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:email, password:password}) })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          setAuth({ token:data.token, name:data.name, email:data.email, is_admin: !!data.is_admin });
          closeModal(); toast('Signed in'); refreshAuthUi();
        } else {
          showAuthError(data.message || 'Sign in failed.');
          btn.disabled = false; btn.textContent = 'Sign in';
        }
      }).catch(function(){ showAuthError('Could not reach the server.'); btn.disabled = false; btn.textContent = 'Sign in'; });
  });
}

function renderAuthSignUp(){
  openModal(
    '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Create account</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
    authTabsHtml('signup')+
    authInputHtml('signup-name','text','Full name')+
    authInputHtml('signup-email','email','Email address')+
    authInputHtml('signup-password','password','Create a password')+
    authInputHtml('signup-confirm-password','password','Confirm password')+
    authErrorHtml()+
    '<button class="btn btn-dark btn-block" id="signup-submit" style="margin-top:14px;">Create account</button>'+
    googleButtonHtml()
  );
  bindAuthTabs();
  mountGoogleButton();
  var pwField = qs('#signup-password'); if (pwField) pwField.setAttribute('autocomplete','new-password');
  var cpwField = qs('#signup-confirm-password'); if (cpwField) cpwField.setAttribute('autocomplete','new-password');
  qs('#signup-submit').addEventListener('click', function(){
    var name = qs('#signup-name').value.trim();
    var email = qs('#signup-email').value.trim().toLowerCase();
    var password = qs('#signup-password').value;
    var confirmPassword = qs('#signup-confirm-password').value;
    if (!name || !email || !password || !confirmPassword){ showAuthError('Fill in your name, email and password.'); return; }
    if (password !== confirmPassword){ showAuthError('Passwords do not match.'); return; }
    if (password.length < 6){ showAuthError('Password must be at least 6 characters.'); return; }
    var btn = qs('#signup-submit'); btn.disabled = true; btn.textContent = 'Creating account…';
    fetch(API_BASE + '/auth/signup', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name:name, email:email, password:password, confirm_password:confirmPassword})
    })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){ renderAuthOtp(email); }
        else {
          showAuthError(data.message || 'Could not create account.');
          btn.disabled = false; btn.textContent = 'Create account';
        }
      }).catch(function(){ showAuthError('Could not reach the server.'); btn.disabled = false; btn.textContent = 'Create account'; });
  });
}

function renderAuthOtp(email){
  email = (email || '').trim().toLowerCase();
  var refreshIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>';
  var checkIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  openModal(
    '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Check your email</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
    '<p class="muted" style="font-size:12.5px; margin-top:10px;">We sent a 6-digit code to <b>'+escapeHtml(email)+'</b>.</p>'+
    authInputHtml('otp-code','text','6-digit code')+
    authErrorHtml()+
    '<button class="btn btn-dark btn-block" id="otp-submit" style="margin-top:14px;">Verify</button>'+
    '<button class="btn btn-outline btn-block" id="otp-resend" style="margin-top:10px; display:inline-flex; align-items:center; justify-content:center; gap:8px;">'+
      '<span class="resend-icon-wrap" style="display:inline-flex; align-items:center;">'+refreshIcon+'</span>'+
      '<span class="resend-label">Resend code</span>'+
    '</button>'
  );
  qs('#otp-submit').addEventListener('click', function(){
    var otp = qs('#otp-code').value.trim();
    if (!otp){ showAuthError('Enter the code from your email.'); return; }
    var btn = qs('#otp-submit'); btn.disabled = true; btn.textContent = 'Verifying…';
    fetch(API_BASE + '/auth/verify-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:email, otp:otp}) })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          setAuth({ token:data.token, name:data.name, email:data.email, is_admin: !!data.is_admin });
          closeModal(); toast('Account verified'); refreshAuthUi();
        } else {
          showAuthError(data.message || 'Invalid code.');
          btn.disabled = false; btn.textContent = 'Verify';
        }
      }).catch(function(){ showAuthError('Could not reach the server.'); btn.disabled = false; btn.textContent = 'Verify'; });
  });

  var resendTimer = null;
  function startCooldown(seconds){
    var btn = qs('#otp-resend');
    if (!btn) return;
    btn.disabled = true;
    var iconWrap = qs('.resend-icon-wrap', btn);
    var label = qs('.resend-label', btn);
    var remaining = seconds;
    btn.classList.remove('btn-resend-success', 'resend-pop');
    if (iconWrap) iconWrap.innerHTML = refreshIcon;
    if (label) label.textContent = 'Resend code ('+remaining+'s)';

    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(function(){
      remaining--;
      if (!document.body.contains(btn)){
        clearInterval(resendTimer);
        return;
      }
      if (remaining <= 0){
        clearInterval(resendTimer);
        btn.disabled = false;
        if (label) label.textContent = 'Resend code';
        btn.classList.add('resend-pop');
        setTimeout(function(){ btn.classList.remove('resend-pop'); }, 400);
      } else {
        if (label) label.textContent = 'Resend code ('+remaining+'s)';
      }
    }, 1000);
  }

  // Start 1-minute countdown initially since code was just dispatched
  startCooldown(60);

  qs('#otp-resend').addEventListener('click', function(){
    var btn = qs('#otp-resend');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    var iconWrap = qs('.resend-icon-wrap', btn);
    var label = qs('.resend-label', btn);
    if (iconWrap) iconWrap.innerHTML = '<span class="spin-icon">'+refreshIcon+'</span>';
    if (label) label.textContent = 'Sending code…';
    btn.classList.remove('btn-resend-success', 'resend-pop');

    fetch(API_BASE + '/auth/resend-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:email}) })
      .then(function(res){ return res.json(); })
      .then(function(data){
        if (data.success){
          toast('Code resent');
          btn.classList.add('btn-resend-success', 'resend-pop');
          if (iconWrap) iconWrap.innerHTML = checkIcon;
          if (label) label.textContent = 'Code sent!';

          setTimeout(function(){
            startCooldown(60);
          }, 1200);
        } else {
          toast(data.message || 'Could not resend code');
          btn.disabled = false;
          if (iconWrap) iconWrap.innerHTML = refreshIcon;
          if (label) label.textContent = 'Resend code';
        }
      })
      .catch(function(){
        toast('Could not reach the server');
        btn.disabled = false;
        if (iconWrap) iconWrap.innerHTML = refreshIcon;
        if (label) label.textContent = 'Resend code';
      });
  });
}

function bindAuthTabs(){
  qsa('[data-auth-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (btn.dataset.authTab === 'signup') renderAuthSignUp(); else renderAuthSignIn();
    });
  });
}

/* ======================================================================
   INIT
   ====================================================================== */
function init(){
  applyThemeFromPref();
  paintAccountButton();
  refreshAdminNav();
  bindGlobalUi();
  if (!location.hash){
    var p = (location.pathname || '').replace(/\/+$/, '');
    if (p === '/admin') location.hash = '#/admin';
    else location.hash = '#/home';
  }
  render(currentRoute());
  if (isLoggedIn()) syncCurrentUserRole();

  var resizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      if (currentRoute() === 'scan') renderScan();
    }, 220);
  });

  document.addEventListener('visibilitychange', function(){
    if (document.hidden && currentRoute() === 'scan') stopScanEngine();
  });
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
