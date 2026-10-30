/* Airbnb Ops permanent-hosting shim (2026-10-16).
   The UIs live on GitHub Pages (never dies). Data/actions go to the box API, whose address is in url.json.
   - rewrites backend fetches to the current API base (self-heals when url.json changes)
   - caches successful GET JSON locally and serves it (flagged offline) when the box is unreachable
   - never touches Pages' own static files */
(function () {
  'use strict';
  var OWNER = 'manuelbarrantes604-afk', REPO = 'airbnb-ops', PFX = '/' + REPO + '/';
  var STATIC_RE = /^\/airbnb-ops\/(url\.json|ops-shim\.js|manifest|icon-|apple-touch|limpiezas\/(icon-|apple-touch|manifest))/;
  var origFetch = window.fetch.bind(window);
  var base = '', baseAt = 0, resolving = null, stale = false, banner = null;
  var LS = window.localStorage;
  function lsGet(k) { try { return LS.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { LS.setItem(k, v); } catch (e) {} }
  function validUrl(u) { return typeof u === 'string' && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(u.trim()); }
  function timed(url, init, ms) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
    var i = Object.assign({}, init || {}, { signal: c.signal });
    return origFetch(url, i).finally(function () { clearTimeout(t); });
  }
  function readCfg(src) {
    return timed(src + (src.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' }, 7000)
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { return j && validUrl(j.url) ? { url: j.url.trim().replace(/\/+$/, ''), updated: Date.parse(j.updated) || 0 } : null; })
      .catch(function () { return null; });
  }
  function resolveBase(force) {
    if (!force && base && Date.now() - baseAt < 120000) return Promise.resolve(base);
    if (resolving) return resolving;
    resolving = Promise.all([
      readCfg(PFX + 'url.json'),
      readCfg('https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/url.json')
    ]).then(function (l) {
      var best = null; l.forEach(function (c) { if (c && (!best || c.updated > best.updated)) best = c; });
      if (best) { base = best.url; baseAt = Date.now(); lsSet('ops-backend-base', base); }
      else if (!base) base = lsGet('ops-backend-base');
      return base;
    }).finally(function () { resolving = null; });
    return resolving;
  }
  function backendPath(input) {
    var u; try { u = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin) return null;
    if (STATIC_RE.test(u.pathname)) return null;
    var p = u.pathname;
    if (p.indexOf(PFX) === 0) p = '/' + p.slice(PFX.length);
    if (p.indexOf('/limpiezas/') === 0) return null;
    return p + u.search;
  }
  function showBanner(on, when) {
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#fff4d6;color:#6b4e00;font:13px/1.35 -apple-system,system-ui,sans-serif;padding:8px 12px;text-align:center;border-bottom:1px solid #f0d58a;display:none';
      (document.body || document.documentElement).appendChild(banner);
    }
    var es = /^en/i.test(document.documentElement.lang || '') || /lang=en/.test(location.search);
    banner.textContent = es ? 'Reconnecting to the server… showing the last saved data' + (when ? ' (' + when + ')' : '') + '. Changes are paused.'
      : 'Reconectando con el servidor… mostrando los últimos datos guardados' + (when ? ' (' + when + ')' : '') + '. Los cambios están en pausa.';
    banner.style.display = on ? 'block' : 'none';
  }
  var healing = false;
  function heal() {
    if (healing) return; healing = true;
    var iv = setInterval(function () {
      resolveBase(true).then(function (b) {
        if (!b) return;
        return timed(b + '/__permalink_ping__', { cache: 'no-store' }, 8000).then(function (r) {
          if (r.status === 204 || r.ok) { clearInterval(iv); healing = false; stale = false; showBanner(false); if (document.visibilityState === 'visible') location.reload(); }
        });
      }).catch(function () {});
    }, 15000);
  }
  function down(r) { return !r || r.status === 530 || r.status === 502 || r.status === 503 || r.status === 504 || r.status === 404 && /cloudflare|tunnel/i.test(r.headers.get('server') || ''); }
  function clean(init) { var i = Object.assign({}, init || {}); delete i.credentials; return i; }
  function ck(p) { return 'opscache:' + p.replace(/([?&])(ts|t)=\d+&?/g, '$1').replace(/[?&]$/, ''); }
  function fromCache(p) {
    var raw = lsGet(ck(p)); if (!raw) return null;
    var o; try { o = JSON.parse(raw); } catch (e) { return null; }
    stale = true; showBanner(true, new Date(o.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); heal();
    return new Response(o.body, { status: 200, headers: { 'Content-Type': 'application/json', 'X-Portal-Offline': '1', 'X-Ops-Stale': '1' } });
  }
  function offlineResp(method) {
    stale = true; showBanner(true, ''); heal();
    return new Response(JSON.stringify({ ok: false, error: 'offline', message: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  window.fetch = function (input, init) {
    var p = backendPath(input);
    if (p === null) return origFetch(input, init);
    var method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (/^\/api\/portal-session/.test(p)) {   // cookie sessions don't cross origins; the device token lives in localStorage
      var tk = lsGet('limpiezas-token');
      return Promise.resolve(new Response(JSON.stringify({ ok: true, token: /^[A-Za-z0-9_-]{10,64}$/.test(tk) ? tk : null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (/^\/api\/portal-logout/.test(p)) return Promise.resolve(new Response(null, { status: 204 }));
    function attempt(force) {
      return resolveBase(force).then(function (b) {
        if (!b) return null;
        var req = (typeof input === 'string') ? [b + p, clean(init)] : [new Request(b + p, input), clean(init)];
        return timed(req[0], req[1], 25000).catch(function () { return null; });
      });
    }
    return attempt(false).then(function (r) {
      if (down(r)) return attempt(true);
      return r;
    }).then(function (r) {
      if (down(r)) {
        if (method === 'GET' || method === 'HEAD') { var c = fromCache(p); if (c) return c; }
        return offlineResp(method);
      }
      if (stale) { stale = false; showBanner(false); }
      if (method === 'GET' && r.ok && /json/.test(r.headers.get('content-type') || '')) {
        r.clone().text().then(function (t) { if (t.length < 1500000) lsSet(ck(p), JSON.stringify({ at: Date.now(), body: t })); }).catch(function () {});
      }
      return r;
    });
  };
  window.__opsShim = { resolveBase: resolveBase, getBase: function () { return base; } };
  resolveBase(true);
})();
