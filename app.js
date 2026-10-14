(function () {
  'use strict';

  // Supabase: chave publicável (pode ficar no código). Os dados só saem com o código de acesso.
  var API = 'https://ppgivsamhkrevbsztwxu.supabase.co/rest/v1/rpc/';
  var KEY = 'sb_publishable_uBF_jmM_XG1thi2G2c4H0Q_uDi0l-j0';
  var TOKEN_KEY = 'leituras.token';
  var CACHE_KEY = 'leituras.cache';

  var MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MONL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var DOWL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var nf = new Intl.NumberFormat('pt-BR');

  var app = document.getElementById('app');
  var token = lsGet(TOKEN_KEY);
  var books = [];
  var loaded = false;
  var offline = '';
  var settingsOpen = false;
  var chartObserver = null;

  // ---------- utilidades ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function $(sel, root) { return (root || app).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoOf(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return isoOf(d); }
  function diff(a, b) { return Math.round((parse(a) - parse(b)) / 864e5); }
  function today() { return isoOf(new Date()); }
  function fmtMD(s) { var d = parse(s); return d.getDate() + ' ' + MON[d.getMonth()]; }
  function fmtLong(s) { var d = parse(s); return d.getDate() + ' de ' + MONL[d.getMonth()]; }
  function fmtRange(a, b) {
    if (a === b) return fmtMD(a);
    var x = parse(a), y = parse(b);
    return x.getMonth() === y.getMonth() ? x.getDate() + '–' + fmtMD(b) : fmtMD(a) + ' – ' + fmtMD(b);
  }
  function fmtRow(s) { var d = parse(s); return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function pctTxt(p) { return (p * 100).toFixed(p >= 0.1 || p === 0 ? 0 : 1).replace('.', ',') + '%'; }
  function int(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }

  var CHEV_L = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEV_R = '<svg class="chev" viewBox="0 0 8 14" aria-hidden="true"><path d="m1 1 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PLUS = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  // ---------- servidor ----------
  async function rpc(fn, args) {
    var res;
    try {
      res = await fetch(API + fn, {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
    } catch (e) {
      var ne = new Error('Sem conexão. Tente de novo quando estiver online.');
      ne.offline = true;
      throw ne;
    }
    var text = await res.text();
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      var err = new Error((body && body.message) || ('Erro ' + res.status));
      err.code = body && body.code;
      throw err;
    }
    return body;
  }

  function errMsg(e) {
    if (e && e.offline) return e.message;
    var m = (e && e.message) || 'algo deu errado';
    return 'Não foi possível salvar: ' + m + '.';
  }

  function normalize(raw) {
    var logs = {};
    (raw.registros || []).forEach(function (r) { logs[String(r.dia).slice(0, 10)] = r.pagina; });
    return {
      id: raw.id, titulo: raw.titulo, autor: raw.autor || '', ano: raw.ano,
      total: raw.total, startPage: raw.pagina_inicial, startDate: String(raw.data_inicio).slice(0, 10),
      goalMin: raw.meta_min, goalMax: raw.meta_max, arquivado: !!raw.arquivado, logs: logs
    };
  }

  function useRaw(raw) { books = (raw || []).map(normalize); loaded = true; }

  async function refresh() {
    if (!token) return route();
    try {
      var raw = await rpc('leitura_estado', { p_token: token });
      useRaw(raw);
      lsSet(CACHE_KEY, JSON.stringify(raw));
      offline = '';
    } catch (e) {
      if (e.code === '42501') return logout('Esse código de acesso não vale mais. Digite o código novo.');
      offline = e.offline ? 'Sem conexão. Mostrando a última versão salva neste aparelho.' : ('O servidor não respondeu: ' + e.message);
    }
    route();
  }

  function logout(msg) {
    token = null;
    books = []; loaded = false;
    lsSet(TOKEN_KEY, null); lsSet(CACHE_KEY, null);
    location.hash = '#/';
    renderLogin(msg);
  }

  // ---------- cálculos de um livro ----------
  function calc(b, t) {
    var ds = Object.keys(b.logs).sort();
    function pageBefore(d) {
      var p = b.startPage;
      for (var i = 0; i < ds.length; i++) { if (ds[i] < d) p = b.logs[ds[i]]; else break; }
      return p;
    }
    function pageAfter(d) {
      for (var i = 0; i < ds.length; i++) if (ds[i] > d) return b.logs[ds[i]];
      return null;
    }
    function dayPages(d) { return b.logs[d] - pageBefore(d); }
    var cur = ds.length ? b.logs[ds[ds.length - 1]] : b.startPage;
    var rem = Math.max(0, b.total - cur);
    var base = pageBefore(t);
    var tp = (b.logs[t] != null ? b.logs[t] : base) - base;
    var pct = Math.min(1, Math.max(0, cur / b.total));
    var dMin = Math.ceil(rem / b.goalMax);
    var dMax = Math.ceil(rem / b.goalMin);
    var future = b.startDate > t;
    var from = future ? b.startDate : t;
    var shift = (!future && tp >= b.goalMin) ? 0 : -1;
    var early = add(from, dMin + shift);
    var late = add(from, dMax + shift);
    var elapsed = Math.max(0, diff(t, b.startDate));
    var expMin = b.startPage + b.goalMin * elapsed;
    var expMax = b.startPage + b.goalMax * elapsed;

    var status;
    if (rem === 0) status = { short: 'Concluído', long: 'Concluído', cls: 'ok' };
    else if (b.arquivado) status = { short: 'Arquivado', long: 'Arquivado', cls: 'mute' };
    else if (future) status = { short: 'Começa ' + fmtMD(b.startDate), long: 'Começa em ' + fmtLong(b.startDate), cls: 'mute' };
    else if (base < expMin) {
      var a = expMin - base;
      status = { short: 'Atrasado ' + a + ' p.', long: 'Dia ' + (elapsed + 1) + ' · Atrasado ' + a + ' ' + plural(a, 'página', 'páginas'), cls: 'warn' };
    } else if (base > expMax) {
      var f = base - expMax;
      status = { short: 'Adiantado ' + f + ' p.', long: 'Dia ' + (elapsed + 1) + ' · Adiantado ' + f + ' ' + plural(f, 'página', 'páginas'), cls: 'ok' };
    } else status = { short: 'No ritmo', long: 'Dia ' + (elapsed + 1) + ' · No ritmo', cls: 'ok' };

    var streak = 0, d = t;
    if (!(b.logs[d] != null && dayPages(d) >= b.goalMin)) d = add(d, -1);
    while (b.logs[d] != null && dayPages(d) >= b.goalMin) { streak++; d = add(d, -1); }

    return {
      ds: ds, cur: cur, rem: rem, base: base, tp: tp, pct: pct, dMin: dMin, dMax: dMax, early: early, late: late,
      status: status, streak: streak, pageBefore: pageBefore, pageAfter: pageAfter, dayPages: dayPages
    };
  }

  function ringSvg(pct, r, cls) {
    var C = 2 * Math.PI * r;
    return '<svg viewBox="0 0 ' + (2 * r + 16) + ' ' + (2 * r + 16) + '" aria-hidden="true">' +
      '<circle class="track" cx="' + (r + 8) + '" cy="' + (r + 8) + '" r="' + r + '"></circle>' +
      '<circle class="prog' + (cls || '') + '" cx="' + (r + 8) + '" cy="' + (r + 8) + '" r="' + r + '" stroke-dasharray="' + C.toFixed(2) +
      '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(2) + '"' + (pct === 0 ? ' stroke-opacity="0"' : '') + '></circle></svg>';
  }

  // ---------- rotas ----------
  function route() {
    if (chartObserver) { chartObserver.disconnect(); chartObserver = null; }
    if (!token) return renderLogin();
    if (!loaded) { app.innerHTML = '<p class="skeleton">Carregando sua estante…</p>'; return; }
    var h = location.hash || '#/';
    var m = h.match(/^#\/livro\/([0-9a-f-]{36})$/);
    if (h === '#/novo') return renderNew();
    if (m) {
      var b = books.find(function (x) { return x.id === m[1]; });
      if (b) return renderBook(b);
    }
    renderShelf();
  }

  function noticeHtml() {
    return offline ? '<p class="notice" role="status"><span>' + esc(offline) + '</span><button type="button" class="chip" data-retry>Tentar de novo</button></p>' : '';
  }
  function bindNotice() {
    var r = $('[data-retry]');
    if (r) r.addEventListener('click', refresh);
  }

  // ---------- entrada ----------
  function renderLogin(msg) {
    app.innerHTML =
      '<section class="login">' +
      '  <div class="hero"><h1>Leituras</h1><p class="lede">Digite o seu código de acesso para abrir a sua estante neste aparelho.</p></div>' +
      '  <form class="form" id="loginForm" novalidate>' +
      '    <label class="field"><span>Código de acesso</span><input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>' +
      '    <button class="btn" type="submit">Entrar</button>' +
      '    <div class="msg' + (msg ? ' err' : '') + '" id="loginMsg" role="status">' + esc(msg || '') + '</div>' +
      '  </form>' +
      '</section>';
    $('#loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var code = $('#code').value.trim().toUpperCase().replace(/\s+/g, '');
      var out = $('#loginMsg');
      if (!code) { out.className = 'msg err'; out.textContent = 'Digite o código.'; return; }
      var btn = $('#loginForm .btn');
      btn.disabled = true; out.className = 'msg'; out.textContent = 'Conferindo…';
      try {
        var raw = await rpc('leitura_estado', { p_token: code });
        token = code;
        lsSet(TOKEN_KEY, code);
        lsSet(CACHE_KEY, JSON.stringify(raw));
        useRaw(raw);
        offline = '';
        location.hash = '#/';
        route();
      } catch (err) {
        btn.disabled = false;
        out.className = 'msg err';
        out.textContent = err.code === '42501' ? 'Código não encontrado. Confira e tente de novo.' : err.message;
      }
    });
  }

  // ---------- estante ----------
  function bookCard(b, t) {
    var c = calc(b, t);
    var meta = 'p. ' + nf.format(c.cur) + ' de ' + nf.format(b.total);
    if (!b.arquivado && c.rem > 0 && c.tp > 0) meta += ' · hoje +' + c.tp;
    return '<a class="book" href="#/livro/' + b.id + '">' +
      '<div class="mini">' + ringSvg(c.pct, 28) + '<span>' + pctTxt(c.pct) + '</span></div>' +
      '<div class="book-info"><div class="book-t">' + esc(b.titulo) + '</div>' +
      (b.autor ? '<div class="book-a">' + esc(b.autor) + (b.ano ? ' · ' + b.ano : '') + '</div>' : '') +
      '<div class="book-m"><span class="pill ' + c.status.cls + '">' + esc(c.status.short) + '</span><span>' + meta + '</span></div></div>' +
      CHEV_R + '</a>';
  }

  function renderShelf() {
    var t = today();
    var td = parse(t);
    var reading = [], done = [], archived = [];
    var todayPages = 0;
    books.forEach(function (b) {
      var c = calc(b, t);
      if (b.arquivado) archived.push(b);
      else if (c.rem === 0) done.push(b);
      else { reading.push(b); todayPages += Math.max(0, c.tp); }
    });

    var lede;
    if (!books.length) lede = 'Sua estante está vazia. Adicione o livro que você está lendo agora.';
    else if (!reading.length) lede = 'Nenhum livro em andamento. Que tal começar o próximo?';
    else if (todayPages > 0) lede = 'Hoje você leu <span class="hl">' + nf.format(todayPages) + ' ' + plural(todayPages, 'página', 'páginas') + '</span>' +
      (reading.length > 1 ? ' em ' + reading.length + ' livros.' : '.');
    else lede = 'Você está lendo <span class="hl">' + reading.length + ' ' + plural(reading.length, 'livro', 'livros') + '</span>. Nada registrado hoje ainda.';

    function group(title, list) {
      if (!list.length) return '';
      return '<section><h2 class="group-t">' + title + '</h2><div class="shelf">' + list.map(function (b) { return bookCard(b, t); }).join('') + '</div></section>';
    }

    app.innerHTML =
      '<header class="bar"><span>' + DOWL[td.getDay()] + ', ' + td.getDate() + ' de ' + MONL[td.getMonth()] + '</span></header>' +
      '<section class="shelf-head"><div class="hero"><h1>Leituras</h1><p class="lede">' + lede + '</p></div>' +
      '<a class="add" href="#/novo">' + PLUS + 'Novo livro</a></section>' +
      noticeHtml() +
      group('Lendo', reading) + group('Concluídos', done) + group('Arquivados', archived) +
      '<footer class="foot"><button type="button" class="link" id="logout">Sair deste aparelho</button></footer>';
    bindNotice();
    var lo = $('#logout');
    lo.addEventListener('click', function () {
      if (lo.dataset.armed) return logout();
      lo.dataset.armed = '1'; lo.textContent = 'Toque de novo para sair (você vai precisar do código)';
      setTimeout(function () { delete lo.dataset.armed; lo.textContent = 'Sair deste aparelho'; }, 4000);
    });
  }

  // ---------- novo livro ----------
  function renderNew() {
    var t = today();
    app.innerHTML =
      '<header class="bar"><a class="back" href="#/">' + CHEV_L + 'Estante</a></header>' +
      '<section class="hero"><h1>Novo livro</h1><p class="lede">Informe o tamanho do livro e quantas páginas você quer ler por dia.</p></section>' +
      '<form class="form card" id="newForm" novalidate>' +
      '  <label class="field full"><span>Título</span><input id="nTitulo" autocomplete="off" required></label>' +
      '  <label class="field"><span>Autor</span><input id="nAutor" autocomplete="off"></label>' +
      '  <label class="field"><span>Ano (opcional)</span><input id="nAno" type="number" inputmode="numeric"></label>' +
      '  <label class="field"><span>Total de páginas</span><input id="nTotal" type="number" inputmode="numeric" min="2"></label>' +
      '  <label class="field"><span>Já estou na página</span><input id="nInicio" type="number" inputmode="numeric" min="0" value="0"></label>' +
      '  <label class="field full"><span>Começo a contar em</span><input id="nData" type="date" value="' + t + '"></label>' +
      '  <label class="field"><span>Meta mínima por dia</span><input id="nMin" type="number" inputmode="numeric" min="1" value="15"></label>' +
      '  <label class="field"><span>Meta ideal por dia</span><input id="nMax" type="number" inputmode="numeric" min="1" value="20"></label>' +
      '  <button class="btn" type="submit">Adicionar à estante</button>' +
      '  <div class="msg" id="newMsg" role="status"></div>' +
      '</form>';
    $('#nTitulo').focus();
    $('#newForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var out = $('#newMsg');
      function fail(m) { out.className = 'msg err'; out.textContent = m; }
      var titulo = $('#nTitulo').value.trim();
      var total = int($('#nTotal').value), ini = int($('#nInicio').value) || 0;
      var mn = int($('#nMin').value), mx = int($('#nMax').value);
      var ano = $('#nAno').value.trim() ? int($('#nAno').value) : null;
      var data = $('#nData').value || t;
      if (!titulo) return fail('Dê um título ao livro.');
      if (!total || total < 2) return fail('Informe o total de páginas.');
      if (ini < 0 || ini >= total) return fail('A página atual precisa ser menor que o total (' + total + ').');
      if (!mn || !mx || mn < 1 || mx < 1) return fail('Preencha as duas metas com números positivos.');
      if (mn > mx) return fail('A meta mínima não pode passar da meta ideal.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return fail('Escolha uma data válida.');
      var btn = $('#newForm .btn'); btn.disabled = true;
      try {
        var id = await rpc('leitura_salvar_livro', { p_token: token, p_livro: {
          titulo: titulo, autor: $('#nAutor').value.trim(), ano: ano, total: total,
          pagina_inicial: ini, data_inicio: data, meta_min: mn, meta_max: mx } });
        await refresh();
        location.hash = '#/livro/' + id;
      } catch (err) { btn.disabled = false; fail(errMsg(err)); }
    });
  }

  // ---------- livro ----------
  function stat(label, value, unit) {
    return '<div class="stat"><div class="stat-l">' + label + '</div><div class="stat-v">' + value +
      (unit ? '<span class="stat-u"> ' + unit + '</span>' : '') + '</div></div>';
  }

  function renderBook(b) {
    var t = today();
    var c = calc(b, t);
    var td = parse(t);

    var lede;
    if (c.rem === 0) lede = 'Livro concluído. <span class="hl">' + nf.format(b.total) + ' páginas</span> lidas.';
    else lede = 'Faltam <span class="hl">' + nf.format(c.rem) + ' ' + plural(c.rem, 'página', 'páginas') + '</span>. No ritmo de ' + b.goalMin + ' a ' + b.goalMax +
      ' por dia, você termina ' + (c.early === c.late ? 'em <span class="hl">' + fmtLong(c.early) + '</span>.' :
      'entre <span class="hl">' + fmtLong(c.early) + '</span> e <span class="hl">' + fmtLong(c.late) + '</span>.');

    var hint;
    var tMin = Math.min(b.total, c.base + b.goalMin), tMax = Math.min(b.total, c.base + b.goalMax);
    if (c.rem === 0) hint = 'Você chegou à última página.';
    else if (c.tp >= b.goalMax) hint = 'Meta ideal do dia superada.';
    else if (c.tp >= b.goalMin) hint = 'Meta mínima batida. Leia até a página ' + tMax + ' para chegar ao ideal.';
    else hint = 'Leia até a página ' + tMin + ' para bater a meta mínima, ou até a ' + tMax + ' para chegar ao ideal.';

    var daysTxt = c.rem === 0 ? '0' : (c.dMin === c.dMax ? String(c.dMin) : c.dMin + '–' + c.dMax);
    var byline = [b.autor, b.ano].filter(Boolean).join(' · ');
    var R = 86, C = 2 * Math.PI * R;

    app.innerHTML =
      '<header class="bar"><a class="back" href="#/">' + CHEV_L + 'Estante</a><span>' + DOWL[td.getDay()] + ', ' + td.getDate() + ' de ' + MONL[td.getMonth()] + '</span></header>' +
      '<section class="hero">' + (byline ? '<p class="byline">' + esc(byline) + '</p>' : '') +
      '<h1>' + esc(b.titulo) + '</h1><p class="lede">' + lede + '</p>' +
      '<span class="pill ' + c.status.cls + '">' + esc(c.status.long) + '</span></section>' +
      noticeHtml() +
      '<section class="top">' +
      '  <div class="card ring-card"><div class="ring" role="img" aria-label="Progresso: ' + pctTxt(c.pct) + ', página ' + c.cur + ' de ' + b.total + '">' +
      '    <svg viewBox="0 0 200 200" aria-hidden="true"><circle class="track" cx="100" cy="100" r="' + R + '"></circle>' +
      '    <circle class="prog" id="ringProg" cx="100" cy="100" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '"' + (c.pct === 0 ? ' stroke-opacity="0"' : '') + '></circle></svg>' +
      '    <div class="ring-center"><div class="ring-pct">' + pctTxt(c.pct) + '</div><div class="ring-sub">lido</div></div></div>' +
      '    <div class="ring-cap">Página ' + nf.format(c.cur) + ' de ' + nf.format(b.total) + '</div></div>' +
      '  <div class="card today-card"><div class="label">Hoje</div>' +
      '    <div class="td-row"><span class="td-num">' + nf.format(c.tp) + '</span><span class="td-unit">' + plural(c.tp, 'página', 'páginas') + ' · meta de ' + b.goalMin + ' a ' + b.goalMax + '</span></div>' +
      '    <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:' + Math.min(100, Math.max(0, c.tp / b.goalMax * 100)) + '%"></div>' +
      '    <div class="bar-tick" style="left:calc(' + (b.goalMin / b.goalMax * 100) + '% - 1px)"></div></div>' +
      '    <p class="hint">' + hint + '</p>' +
      '    <form class="form" id="logForm" novalidate>' +
      '      <label class="field"><span>Data</span><input type="date" id="logDate" value="' + t + '" max="' + t + '"></label>' +
      '      <label class="field"><span>Página em que parou</span><input type="number" inputmode="numeric" id="logPage" min="1" max="' + b.total + '"></label>' +
      '      <div class="chips" id="chips"></div>' +
      '      <button class="btn" type="submit">Registrar leitura</button>' +
      '      <div class="msg" id="logMsg" role="status" aria-live="polite"></div>' +
      '    </form></div>' +
      '</section>' +
      '<section class="stats">' +
      stat('Restam', nf.format(c.rem), plural(c.rem, 'página', 'páginas')) +
      stat('Para terminar', daysTxt, 'dias') +
      stat('Previsão', c.rem === 0 ? '—' : fmtRange(c.early, c.late)) +
      stat('Sequência', String(c.streak), plural(c.streak, 'dia', 'dias') + ' na meta') +
      '</section>' +
      '<section class="card chart-card"><div class="sec-head"><h2>Trilha de leitura</h2><div class="legend">' +
      '<span><i class="sw-line"></i>Você</span><span><i class="sw-band"></i>Faixa de ' + b.goalMin + ' a ' + b.goalMax + ' por dia</span></div></div>' +
      '<div class="chart" id="chart"></div></section>' +
      '<section class="diary"><div class="sec-head"><h2>Diário</h2></div><ul id="diary"></ul></section>' +
      '<details class="settings" id="settings"' + (settingsOpen ? ' open' : '') + '><summary>Ajustes do livro e da meta</summary>' +
      '  <form class="form" id="setForm" novalidate>' +
      '    <label class="field full"><span>Título</span><input id="sTitulo" value="' + esc(b.titulo) + '"></label>' +
      '    <label class="field"><span>Autor</span><input id="sAutor" value="' + esc(b.autor) + '"></label>' +
      '    <label class="field"><span>Ano</span><input id="sAno" type="number" inputmode="numeric" value="' + (b.ano == null ? '' : b.ano) + '"></label>' +
      '    <label class="field full"><span>Total de páginas</span><input id="sTotal" type="number" inputmode="numeric" min="2" value="' + b.total + '"></label>' +
      '    <label class="field"><span>Meta mínima por dia</span><input id="sMin" type="number" inputmode="numeric" min="1" value="' + b.goalMin + '"></label>' +
      '    <label class="field"><span>Meta ideal por dia</span><input id="sMax" type="number" inputmode="numeric" min="1" value="' + b.goalMax + '"></label>' +
      '    <button class="btn" type="submit">Salvar ajustes</button>' +
      '    <div class="msg" id="setMsg" role="status" aria-live="polite"></div>' +
      '  </form>' +
      '  <div class="danger-zone">' +
      '    <button type="button" class="btn ghost" id="archive">' + (b.arquivado ? 'Voltar para a estante' : 'Arquivar livro') + '</button>' +
      '    <button type="button" class="btn danger" id="delete">Excluir livro</button>' +
      '  </div>' +
      '</details>';

    bindNotice();
    requestAnimationFrame(function () {
      var rp = document.getElementById('ringProg');
      if (rp) rp.setAttribute('stroke-dashoffset', (C * (1 - c.pct)).toFixed(2));
    });
    renderDiary(b, c);
    updateChips(b, c);

    var chart = $('#chart');
    drawChart(chart, b, c);
    if (window.ResizeObserver) {
      chartObserver = new ResizeObserver(function () { drawChart(chart, b, c); });
      chartObserver.observe(chart);
    }

    $('#settings').addEventListener('toggle', function (e) { settingsOpen = e.target.open; });
    $('#logDate').addEventListener('change', function () { updateChips(b, c); });

    $('#logForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var out = $('#logMsg');
      function fail(m) { out.className = 'msg err'; out.textContent = m; }
      var date = $('#logDate').value || t;
      var page = int($('#logPage').value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Escolha uma data válida.');
      if (date > t) return fail('Escolha uma data de hoje ou anterior.');
      if (page == null) return fail('Informe a página em que você parou.');
      if (page > b.total) return fail('O livro tem ' + b.total + ' páginas.');
      var base = c.pageBefore(date), next = c.pageAfter(date);
      if (page < base) return fail('Até esse dia você já estava na página ' + base + '. Informe um número igual ou maior.');
      if (next != null && page > next) return fail('Há um registro posterior na página ' + next + '. Informe um número até ele.');
      var btn = $('#logForm .btn'); btn.disabled = true;
      try {
        await rpc('leitura_registrar', { p_token: token, p_livro: b.id, p_dia: date, p_pagina: page });
        b.logs[date] = page;
        route();
        var m = $('#logMsg');
        if (m) m.textContent = page >= b.total ? 'Salvo. Você terminou o livro!' : 'Salvo: página ' + page + ' em ' + fmtMD(date) + '.';
      } catch (err) { btn.disabled = false; fail(errMsg(err)); }
    });

    $('#setForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var out = $('#setMsg');
      function fail(m) { out.className = 'msg err'; out.textContent = m; }
      var titulo = $('#sTitulo').value.trim();
      var total = int($('#sTotal').value), mn = int($('#sMin').value), mx = int($('#sMax').value);
      var ano = $('#sAno').value.trim() ? int($('#sAno').value) : null;
      if (!titulo) return fail('Dê um título ao livro.');
      if (!total || !mn || !mx || total < 2 || mn < 1 || mx < 1) return fail('Preencha total e metas com números positivos.');
      if (mn > mx) return fail('A meta mínima não pode passar da meta ideal.');
      if (total < c.cur || total <= b.startPage) return fail('O total precisa ser pelo menos a página atual (' + Math.max(c.cur, b.startPage + 1) + ').');
      try {
        await rpc('leitura_salvar_livro', { p_token: token, p_livro: { id: b.id, titulo: titulo, autor: $('#sAutor').value.trim(), ano: ano, total: total, meta_min: mn, meta_max: mx } });
        Object.assign(b, { titulo: titulo, autor: $('#sAutor').value.trim(), ano: ano, total: total, goalMin: mn, goalMax: mx });
        route();
        var m = $('#setMsg'); if (m) m.textContent = 'Ajustes salvos.';
      } catch (err) { fail(errMsg(err)); }
    });

    $('#archive').addEventListener('click', async function () {
      try {
        await rpc('leitura_salvar_livro', { p_token: token, p_livro: { id: b.id, titulo: b.titulo, autor: b.autor, ano: b.ano, total: b.total, meta_min: b.goalMin, meta_max: b.goalMax, arquivado: !b.arquivado } });
        b.arquivado = !b.arquivado;
        settingsOpen = false;
        location.hash = '#/';
      } catch (err) { var m = $('#setMsg'); m.className = 'msg err'; m.textContent = errMsg(err); }
    });

    var del = $('#delete');
    del.addEventListener('click', async function () {
      if (!del.dataset.armed) {
        del.dataset.armed = '1'; del.textContent = 'Toque de novo: apaga o livro e o diário';
        setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Excluir livro'; } }, 4000);
        return;
      }
      try {
        await rpc('leitura_excluir_livro', { p_token: token, p_id: b.id });
        books = books.filter(function (x) { return x.id !== b.id; });
        settingsOpen = false;
        location.hash = '#/';
      } catch (err) { var m = $('#setMsg'); m.className = 'msg err'; m.textContent = errMsg(err); }
    });
  }

  function renderDiary(b, c) {
    var ul = $('#diary');
    var ds = c.ds.slice().reverse();
    if (!ds.length) {
      ul.innerHTML = '<li class="empty">Nenhuma leitura registrada ainda. Informe acima a página em que você parou hoje.</li>';
      return;
    }
    ul.innerHTML = ds.map(function (d) {
      var n = c.dayPages(d);
      var hit = n >= b.goalMin;
      return '<li class="row"><span class="d">' + fmtRow(d) + '</span><span class="p">p. ' + b.logs[d] + '</span>' +
        '<span class="n">+' + n + ' ' + plural(n, 'página', 'páginas') + '</span>' +
        '<span class="tag ' + (hit ? 'ok' : 'low') + '">' + (hit ? 'Meta batida' : 'Abaixo da meta') + '</span>' +
        '<button type="button" class="rm" data-day="' + d + '">Remover</button></li>';
    }).join('');
    ul.querySelectorAll('.rm').forEach(function (rm) {
      rm.addEventListener('click', async function () {
        var d = rm.dataset.day;
        if (!rm.dataset.armed) {
          rm.dataset.armed = '1'; rm.textContent = 'Confirmar remoção';
          setTimeout(function () { if (rm.isConnected) { delete rm.dataset.armed; rm.textContent = 'Remover'; } }, 3000);
          return;
        }
        try {
          await rpc('leitura_remover_registro', { p_token: token, p_livro: b.id, p_dia: d });
          delete b.logs[d];
          route();
        } catch (err) { rm.textContent = 'Falhou. Tentar de novo'; delete rm.dataset.armed; }
      });
    });
  }

  function updateChips(b, c) {
    var date = $('#logDate').value || today();
    var base = c.pageBefore(date);
    var a = Math.min(b.total, base + b.goalMin), z = Math.min(b.total, base + b.goalMax);
    var box = $('#chips');
    var opts = a === z ? [[a, 'Até a p. ' + a]] : [[a, 'Até a p. ' + a + ' (mínimo)'], [z, 'Até a p. ' + z + ' (ideal)']];
    box.innerHTML = opts.map(function (x) { return '<button type="button" class="chip" data-p="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    box.querySelectorAll('.chip').forEach(function (btn) {
      btn.addEventListener('click', function () { $('#logPage').value = btn.dataset.p; $('#logPage').focus(); });
    });
    $('#logPage').placeholder = 'ex.: ' + a;
  }

  function niceStep(total) {
    var steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    for (var i = 0; i < steps.length; i++) if (total / steps[i] <= 6) return steps[i];
    return 10000;
  }

  function drawChart(el, b, c) {
    var W = Math.floor(el.clientWidth);
    if (W < 200) return;
    var H = W < 480 ? 230 : 280;
    var m = { l: 44, r: 14, t: 22, b: 28 };
    var T = b.total, S = b.startPage;
    var lastX = 0;
    c.ds.forEach(function (d) { var i = diff(d, b.startDate); if (i >= 0) lastX = Math.max(lastX, i + 1); });
    var Dmax = Math.max(2, Math.ceil((T - S) / b.goalMin), lastX);
    var Dmin = Math.max(1, Math.ceil((T - S) / b.goalMax));
    function X(i) { return m.l + (W - m.l - m.r) * i / Dmax; }
    function Y(p) { return m.t + (H - m.t - m.b) * (1 - p / T); }
    function f(n) { return n.toFixed(1); }

    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trilha de leitura: páginas lidas contra a faixa de ritmo">';
    var v, step = niceStep(T);
    for (v = 0; v <= T; v += step) {
      s += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + f(Y(v)) + '" y2="' + f(Y(v)) + '"/>';
      s += '<text class="ax" x="' + (m.l - 8) + '" y="' + f(Y(v) + 4) + '" text-anchor="end">' + nf.format(v) + '</text>';
    }
    var xs = Math.max(1, Math.ceil(Dmax / (W < 480 ? 4 : 7)));
    var i;
    for (i = 0; i <= Dmax; i += xs) {
      var anchor = i === 0 ? 'start' : (X(i) > W - m.r - 24 ? 'end' : 'middle');
      s += '<text class="ax" x="' + f(X(i)) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + fmtMD(add(b.startDate, i)) + '</text>';
    }
    var up = [], lo = [];
    for (i = 0; i <= Dmax; i++) {
      up.push(f(X(i)) + ',' + f(Y(Math.min(T, S + b.goalMax * i))));
      lo.push(f(X(i)) + ',' + f(Y(Math.min(T, S + b.goalMin * i))));
    }
    s += '<polygon class="band" points="' + up.join(' ') + ' ' + lo.slice().reverse().join(' ') + '"/>';
    s += '<polyline class="pace" points="' + up.join(' ') + '"/>';
    s += '<polyline class="pace" points="' + lo.join(' ') + '"/>';
    if (Dmin !== Dmax) s += '<text class="ax" x="' + f(X(Dmin) - 6) + '" y="' + (m.t - 8) + '" text-anchor="end">' + b.goalMax + '/dia</text>';
    s += '<text class="ax" x="' + f(X(Dmax) + 2) + '" y="' + (m.t - 8) + '" text-anchor="end">' + b.goalMin + '/dia</text>';

    var pts = [[0, S]];
    c.ds.forEach(function (d) { var k = diff(d, b.startDate); if (k >= 0) pts.push([k + 1, b.logs[d]]); });
    if (pts.length > 1) s += '<polyline class="act" points="' + pts.map(function (p) { return f(X(p[0])) + ',' + f(Y(p[1])); }).join(' ') + '"/>';
    var last = pts[pts.length - 1];
    s += '<circle class="halo" cx="' + f(X(last[0])) + '" cy="' + f(Y(last[1])) + '" r="9"/>';
    s += '<circle class="dot" cx="' + f(X(last[0])) + '" cy="' + f(Y(last[1])) + '" r="4.5"/>';
    s += '</svg>';
    el.innerHTML = s;
  }

  // ---------- início ----------
  window.addEventListener('hashchange', function () { window.scrollTo(0, 0); route(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token) refresh(); });

  if (token) {
    var cached = lsGet(CACHE_KEY);
    if (cached) { try { useRaw(JSON.parse(cached)); } catch (e) {} }
    route();
    refresh();
  } else {
    route();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
