// Peer Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the launch board, the live-token evidence and one protocol's detail: its price taken apart and
// its farm plan. Sortable, filterable, deep-linkable (?detail=, ?watch=1, ?cat=, ?tab=live).
// No network: every byte it shows is in data.js.

(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '<span class="chains">n/a</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function age(a) {
    if (a == null) return '—';
    if (a < 365) return a + 'd';
    return (a / 365).toFixed(1) + 'y';
  }

  // ---- masthead, model line, footer, peer table ----
  el('mastMeta').innerHTML =
    '<strong>' + D.board_size + ' pre-token protocols ranked</strong><br>' +
    'Snapshot of ' + esc(D.as_of) + ' · ' + D.watchlist_size + ' on the watchlist · ' + D.live_size + ' trading peers shown';
  el('modelLine').innerHTML =
    'Model <b>' + esc(D.model_version) + '</b>: implied value = TVL × <b>peer multiple</b> (median MCap/TVL of the category’s tokened protocols; ' +
    'market-wide ' + D.global_multiple.toFixed(3) + '× where a category is thin) × <b>growth</b> × <b>maturity</b>. ' +
    'Every row carries its own arithmetic — open one.';
  el('footLine').textContent = 'Source: ' + D.source + '. Board built from that snapshot alone; it does not move.';

  var peerBody = document.querySelector('#peerTable tbody');
  peerBody.innerHTML = D.peers.map(function (p) {
    return '<tr><td>' + esc(p.category) + '</td><td class="num">' + p.multiple.toFixed(3) + '×</td><td class="num">' + p.peers + '</td></tr>';
  }).join('');

  // ---- filter options ----
  var cats = {}, chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  function fillSelect(sel, names) {
    names.sort().forEach(function (n) {
      var o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
  }
  fillSelect(el('cat'), Object.keys(cats));
  fillSelect(el('chain'), Object.keys(chains));

  // ---- state ----
  var params = new URLSearchParams(location.search);
  var state = {
    tab: params.get('tab') === 'live' ? 'live' : 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    sort: 'rank',
    asc: true,
    picked: params.get('detail') || null,
  };
  el('q').value = state.q;
  el('cat').value = state.cat;
  el('chain').value = state.chain;
  el('watch').checked = state.watch;

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    peer: function (r) { return r.model.peer_multiple; },
    implied: function (r) { return r.implied_value_usd; },
  };

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var ka = SORTS[state.sort](a), kb = SORTS[state.sort](b);
      var d = ka < kb ? -1 : ka > kb ? 1 : a.rank - b.rank;
      return state.asc ? d : -d;
    });
  }

  function renderBoard() {
    var rows = visibleRows();
    el('rowCount').textContent = rows.length + ' of ' + D.board_size + ' protocols';
    el('emptyMsg').classList.toggle('hidden', rows.length > 0);
    el('boardBody').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.picked === r.slug ? ' class="picked"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="pname">' + esc(r.name) + (r.watchlist ? '<span class="star" title="On the snapshot watchlist">★</span>' : '') + '</td>' +
        '<td class="pcat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + r.model.peer_multiple.toFixed(2) + '×</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
  }

  function renderLive() {
    el('liveBody').innerHTML = D.live.map(function (r) {
      return '<tr><td class="pname">' + esc(r.name) + '</td>' +
        '<td class="pcat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_tvl == null ? '—' : r.mcap_tvl.toFixed(2) + '×') + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  // ---- detail ----
  function openDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.picked = slug;
    var m = r.model;
    var base = r.tvl_usd * m.peer_multiple;
    el('detail').innerHTML =
      '<button class="close" id="dClose" type="button" aria-label="Close detail">×</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="watch-flag">Watchlist</span>' : '') + '</h2>' +
      '<p class="d-sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain recorded') +
      ' · tracked since ' + esc(r.listed_at || 'an unrecorded date') + ' (' + age(r.age_days) + ')<br>' +
      'Records no token in the snapshot of ' + esc(D.as_of) + ' — pre-token, so the radar prices it.</p>' +
      '<p class="d-implied"><small>Implied value if it launched at its peers’ price</small>' + money(r.implied_value_usd) + '</p>' +
      '<div class="math"><table>' +
      '<tr><td class="k">TVL (snapshot)</td><td class="v">' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td class="k">Peer multiple — ' + esc(m.peer_scope) + '</td><td class="v">× ' + m.peer_multiple.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">At peer price</td><td class="v">' + money(Math.round(base)) + '</td></tr>' +
      '<tr><td class="k">Growth (7d ' + (r.change_7d == null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ')</td><td class="v">× ' + m.growth_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">Maturity (' + (r.age_days == null ? 'age unrecorded, mid-curve taken' : age(r.age_days) + ' with no token') + ')</td><td class="v">× ' + m.maturity_multiplier.toFixed(3) + '</td></tr>' +
      '<tr><td class="k">Implied value</td><td class="v">' + money(r.implied_value_usd) + '</td></tr>' +
      '</table></div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="plan">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    el('dClose').addEventListener('click', function () {
      state.picked = null;
      el('detail').innerHTML = '<p class="detail-hint">Pick any row: its price is taken apart here — every factor, the peers behind the multiple, and the plan to farm it.</p>';
      renderBoard();
    });
    renderBoard();
  }

  // ---- wiring ----
  el('boardBody').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#boardTable th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.asc = !state.asc;
      else { state.sort = key; state.asc = key === 'rank' || key === 'name' || key === 'category'; }
      document.querySelectorAll('#boardTable th').forEach(function (h) { h.classList.remove('sorted', 'asc'); });
      th.classList.add('sorted');
      if (state.asc) th.classList.add('asc');
      renderBoard();
    });
  });
  function onFilter() {
    state.q = el('q').value; state.cat = el('cat').value; state.chain = el('chain').value; state.watch = el('watch').checked;
    renderBoard();
  }
  ['q', 'cat', 'chain', 'watch'].forEach(function (id) {
    el(id).addEventListener('input', onFilter);
    el(id).addEventListener('change', onFilter);
  });
  function setTab(tab) {
    state.tab = tab;
    el('tabBoard').classList.toggle('on', tab === 'board');
    el('tabLive').classList.toggle('on', tab === 'live');
    el('boardTable').classList.toggle('hidden', tab !== 'board');
    el('liveTable').classList.toggle('hidden', tab !== 'live');
    el('rowCount').textContent = tab === 'live' ? D.live_size + ' trading peers' : '';
    if (tab === 'board') renderBoard();
  }
  el('tabBoard').addEventListener('click', function () { setTab('board'); });
  el('tabLive').addEventListener('click', function () { setTab('live'); });

  renderLive();
  setTab(state.tab);
  if (state.picked) openDetail(state.picked);
})();
