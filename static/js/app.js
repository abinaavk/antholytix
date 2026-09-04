(function(){
"use strict";

/* ======================================================================
   CONFIG — edit these two lines for your business
   ====================================================================== */
var WHATSAPP_NUMBER = "919876543210"; // <-- replace with your real WhatsApp business number, digits only, country code first
var BRAND_NAME = "Antholytix";
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

function openModal(innerHtml){
  var mount = qs('#modal-mount');
  mount.innerHTML = '<div class="modal">'+innerHtml+'</div>';
  mount.classList.add('open');
  qsa('[data-close-modal]', mount).forEach(function(b){ b.addEventListener('click', closeModal); });
  mount.addEventListener('click', function(e){ if(e.target === mount) closeModal(); });
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
  rec('K7#9-QD4$-N2!B-8XM6', 'Fresh Paneer, 200 g', 'Antholytix Foods Pvt. Ltd.', '200 g', -6, 8);
  rec('B3$M-8K!Q-7N#D-Z1V4', 'Greek Yogurt Cup', 'Antholytix Foods Pvt. Ltd.', '150 g', -20, -2);
  rec('R5!P-2X$K-9M#B-Q7C3', 'Chicken Mince, 500 g', 'Antholytix Foods Pvt. Ltd.', '500 g', -2, 1);
  rec('T8@L-4V%R-1J&Y-5PS2', 'Whole Milk, 1 L', 'Antholytix Foods Pvt. Ltd.', '1 L', -1, 5);
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
   HISTORY (localStorage)
   ====================================================================== */
var HISTORY_KEY = 'antholytix_scan_history_v1';
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e){ return []; }
}
function saveHistoryEntry(entry){
  var h = loadHistory();
  h.unshift(entry);
  h = h.slice(0, 40);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}
function seedHistoryIfEmpty(){
  if (loadHistory().length) return;
  var today = new Date();
  var seed = [
    { hex:'#C23E86', name:'Fresh Paneer, 200 g', overall:'safe', ph:'pH 1–4', when: addDays(today,-1).toISOString() },
    { hex:'#3F70DA', name:'Chicken Mince, 500 g', overall:'caution', ph:'pH 7–8', when: addDays(today,-2).toISOString() },
    { hex:'#3F9142', name:'Greek Yogurt Cup', overall:'danger', ph:'pH 9–10', when: addDays(today,-4).toISOString() }
  ];
  seed.forEach(function(s){ saveHistoryEntry(s); });
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
  starter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

/* ======================================================================
   ROUTER
   ====================================================================== */
var ROUTES = ['home','scan','products','history','about'];
var TITLES = {
  home:{t:'Home', s:'Welcome back'},
  scan:{t:'Scan a label', s:'Pigment + QR check'},
  products:{t:'Shop labels', s:'Order on WhatsApp'},
  history:{t:'Scan history', s:'Your last 40 scans'},
  about:{t:'How it works', s:'The science on your label'}
};

function currentRoute(){
  var h = location.hash.replace('#/','').split('?')[0];
  return ROUTES.indexOf(h) >= 0 ? h : 'home';
}

function navigate(route){
  if (location.hash !== '#/'+route) { location.hash = '#/'+route; }
  else { render(route); }
}

function render(route){
  qsa('.view').forEach(function(v){ v.classList.toggle('active', v.dataset.view === route); });
  qsa('[data-route]').forEach(function(n){ n.classList.toggle('active', n.dataset.route === route); });
  qs('#topbar-title').textContent = TITLES[route].t;
  qs('#topbar-sub').textContent = TITLES[route].s;

  if (route !== 'scan') stopScanEngine();

  if (route === 'home') renderHome();
  else if (route === 'scan') renderScan();
  else if (route === 'products') renderProducts();
  else if (route === 'history') renderHistory();
  else if (route === 'about') renderAbout();

  window.scrollTo({top:0, behavior:'instant' in window ? 'instant' : 'auto'});
}

window.addEventListener('hashchange', function(){ render(currentRoute()); });

/* ======================================================================
   VIEW: HOME
   ====================================================================== */
function renderHome(){
  var host = qs('#view-home');
  var hist = loadHistory();
  var safeCount = hist.filter(function(h){return h.overall==='safe';}).length;
  var pct = hist.length ? Math.round(safeCount/hist.length*100) : 0;

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

  qs('#home-stats').innerHTML = [
    statTile(ICON.scan,'var(--spec-3)', hist.length, 'Total scans logged'),
    statTile(ICON.check,'var(--safe)', pct+'%', 'Marked safe to consume'),
    statTile(ICON.qr,'var(--spec-2)', DEMO_CODES.length, 'Registered demo labels'),
    statTile(ICON.box,'var(--spec-5)', SHOP_PRODUCTS.length, 'Label packs in shop')
  ].join('');

  var recentHost = qs('#home-recent');
  if (!hist.length){
    recentHost.innerHTML = emptyState(ICON.clock, 'No scans yet', 'Your scan results will show up here.');
  } else {
    recentHost.innerHTML = hist.slice(0,4).map(scanRowHtml).join('');
  }

  qs('#home-products').innerHTML = SHOP_PRODUCTS.slice(0,4).map(function(p){ return miniProductHtml(p); }).join('');
  qsa('[data-whatsapp]', host).forEach(bindWhatsappButton);
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
  var hist = loadHistory();
  host.innerHTML =
  '<section class="card" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">'+
    '<div style="flex:1; min-width:200px;"><h2 style="font-size:19px;">Your scan history</h2><p class="muted" style="font-size:12.5px; margin-top:3px;">Stored on this device only — kept for your last 40 scans.</p></div>'+
    (hist.length ? '<button class="btn btn-outline" id="clear-history">Clear history</button>' : '')+
  '</section>'+
  '<div class="card"><div class="scanlist" id="history-list"></div></div>';

  var list = qs('#history-list');
  list.innerHTML = hist.length ? hist.map(scanRowHtml).join('') : emptyState(ICON.clock, 'Nothing scanned yet', 'Scan a label to start building your history.');

  var clearBtn = qs('#clear-history');
  if (clearBtn) clearBtn.addEventListener('click', function(){
    localStorage.removeItem(HISTORY_KEY);
    toast('History cleared');
    renderHistory();
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
  return '<tr style="border-top:1px solid #00000009;"><td style="padding:9px 4px; display:flex; align-items:center; gap:8px;"><span style="width:12px;height:12px;border-radius:4px;background:'+color+'; display:inline-block;"></span>'+name+'</td>'+
    '<td style="padding:9px 4px;">'+ph+'</td><td style="padding:9px 4px; font-weight:600;">'+verdict+'</td></tr>';
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
  return fetch(API_BASE + '/scan/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  saveHistoryEntry({
    hex: pigment ? pigment.hex : '#9a979a',
    name: payload.name,
    overall: overall,
    ph: pigment ? pigment.classification.ph : '—',
    when: new Date().toISOString()
  });

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

  saveHistoryEntry({
    hex: pigment ? pigment.hex : '#9a979a',
    name: payload.name,
    overall: overall,
    ph: serverData.pigment.ph,
    when: new Date().toISOString()
  });

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
    '<input id="manual-code-input" placeholder="e.g. K7#9-QD4$-N2!B-8XM6" style="width:100%; margin-top:14px; padding:13px 14px; border-radius:12px; border:1.5px solid #00000022; font-size:14px; font-family:ui-monospace,monospace;">'+
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
      '<div style="background:#fff; border:1.5px dashed #00000022; border-radius:18px; padding:16px; display:flex; flex-direction:column; align-items:center; gap:12px;">'+
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
  qs('#btn-search').addEventListener('click', function(){
    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Search</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<input id="global-search-input" placeholder="Search products or scan history…" style="width:100%; margin-top:14px; padding:13px 14px; border-radius:12px; border:1.5px solid #00000022; font-size:14px;">'+
      '<div id="global-search-results" style="margin-top:14px; display:flex; flex-direction:column; gap:6px;"></div>'
    );
    var input = qs('#global-search-input');
    input.focus();
    input.addEventListener('input', function(){
      var q = input.value.trim().toLowerCase();
      var results = qs('#global-search-results');
      if (!q){ results.innerHTML=''; return; }
      var prod = SHOP_PRODUCTS.filter(function(p){ return p.name.toLowerCase().indexOf(q)>=0; });
      var hist = loadHistory().filter(function(h){ return h.name.toLowerCase().indexOf(q)>=0; });
      var out = '';
      prod.forEach(function(p){ out += '<a href="#/products" data-close-modal style="display:block; padding:10px 12px; border-radius:10px; background:var(--panel); font-size:13px; font-weight:600;">'+ICON.box+' '+escapeHtml(p.name)+'</a>'; });
      hist.slice(0,5).forEach(function(h){ out += '<a href="#/history" data-close-modal style="display:block; padding:10px 12px; border-radius:10px; background:var(--panel); font-size:13px; font-weight:600;">'+ICON.clock+' '+escapeHtml(h.name)+'</a>'; });
      results.innerHTML = out || '<p class="faint" style="font-size:12.5px;">No matches yet.</p>';
      qsa('[data-close-modal]', results).forEach(function(a){ a.addEventListener('click', closeModal); });
    });
  });

  qs('#btn-alerts').addEventListener('click', function(){
    qs('#alert-dot').style.display = 'none';
    var hist = loadHistory();
    var flagged = hist.filter(function(h){ return h.overall !== 'safe'; }).slice(0,5);
    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Notifications</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<div style="margin-top:14px; display:flex; flex-direction:column; gap:10px;">'+
      (flagged.length ? flagged.map(function(h){
        return '<div style="display:flex; gap:10px; align-items:center; padding:10px; border-radius:12px; background:var(--panel);">'+
          '<div class="swatch" style="width:34px;height:34px;background:'+h.hex+';"></div>'+
          '<div style="flex:1; font-size:12.5px;"><b>'+escapeHtml(h.name)+'</b><br><span class="faint">flagged '+timeAgo(h.when)+'</span></div>'+
          '<span class="badge '+h.overall+'">'+stateMeta(h.overall).label+'</span></div>';
      }).join('') : '<p class="faint" style="font-size:12.5px;">No flagged scans — everything checked out safe.</p>')+
      '</div>'
    );
  });

  qs('#btn-avatar').addEventListener('click', function(){
    openModal(
      '<div style="display:flex; align-items:center;"><h3 style="font-size:16px;">Your account</h3><button class="modal-close" data-close-modal>'+ICON.cross+'</button></div>'+
      '<div style="display:flex; align-items:center; gap:12px; margin-top:16px;">'+
        '<div class="avatar-btn" style="width:52px;height:52px;font-size:17px;">AL</div>'+
        '<div><div style="font-weight:700; font-size:14.5px;">Antholytix Local</div><div class="faint" style="font-size:12px;">Guest session · on this device</div></div>'+
      '</div>'+
      '<p class="muted" style="font-size:12.5px; margin-top:16px; line-height:1.6;">Scan history is stored locally on this device. Sign-in and cloud sync connect to your existing account backend.</p>'
    );
  });
}

/* ======================================================================
   INIT
   ====================================================================== */
function init(){
  seedHistoryIfEmpty();
  bindGlobalUi();
  if (!location.hash) location.hash = '#/home';
  render(currentRoute());

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
