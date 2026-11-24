(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Where this visitor came from ----------
  // A short, non-identifying tag from the link (e.g. ?source=experiment or ?group=harvard-baseball).
  // Letters, numbers and hyphens only; nothing about a person ever goes in the URL.
  function sourceTag() {
    try {
      var q = new URLSearchParams(window.location.search);
      var raw = (q.get('source') || q.get('group') || '').toLowerCase();
      var tag = raw.replace(/[^a-z0-9-]/g, '').slice(0, 20);
      return tag;
    } catch (e) {
      return '';
    }
  }
  var TAG = sourceTag();

  // ---------- Waitlist ----------
  var config = window.PIPELINE_LANDING_CONFIG || {};
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function joinWaitlist(email, place) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      return Promise.reject(new Error('Signups open soon. Please check back in a bit.'));
    }
    var source = ('landing-' + place + (TAG ? ':' + TAG : '')).slice(0, 40);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    return fetch(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/landing_waitlist', {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: 'Bearer ' + config.supabaseKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ email: email, source: source }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      // 409: this email is already on the list. That's a success from the visitor's side.
      if (res.ok || res.status === 409) return;
      if (res.status === 400) throw new Error('Please enter a valid email address.');
      throw new Error('Something went wrong. Please try again.');
    }, function () {
      throw new Error('We couldn’t reach the server. Check your connection and try again.');
    }).then(function (v) { if (timer) clearTimeout(timer); return v; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  document.querySelectorAll('form.waitlist').forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector('button[type="submit"]');
    var status = form.querySelector('.form-status');
    var done = form.querySelector('.done');

    function show(msg, kind) {
      status.textContent = msg;
      status.classList.toggle('is-error', kind === 'error');
    }
    function finish() {
      form.classList.remove('is-busy');
      form.classList.add('is-done');
      input.blur();
      if (done) done.setAttribute('aria-hidden', 'true'); // the live region below announces it instead
      status.classList.remove('is-error');
      status.classList.add('sr-only');
      status.textContent = 'You’re on the list. We’ll email you when your community opens.';
    }

    input.addEventListener('input', function () { if (status.classList.contains('is-error')) show(''); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();

      // Honeypot: bots fill hidden fields, people don't. Look successful, store nothing.
      if (form.querySelector('.hp').value) { finish(); return; }

      if (!EMAIL_RE.test(email) || email.length > 254) {
        show('Please enter a valid email address.', 'error');
        input.focus();
        return;
      }

      button.disabled = true;
      form.classList.add('is-busy');
      show('');
      joinWaitlist(email, form.dataset.source || 'page').then(finish, function (err) {
        form.classList.remove('is-busy');
        button.disabled = false;
        show(err.message, 'error');
      });
    });
  });

  // ---------- Nav ----------
  var nav = document.getElementById('nav');
  function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > window.innerHeight * 0.55); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Reveal on scroll ----------
  var reveals = document.querySelectorAll('.reveal');
  var steps = document.querySelectorAll('.step');
  var demo = document.querySelector('[data-demo]');

  function lightDemo() {
    if (!demo) return;
    demo.classList.add('is-lit');
  }
  function replayDemo() {
    if (!demo) return;
    demo.classList.remove('is-lit');
    void demo.offsetWidth; // restart the transitions
    requestAnimationFrame(function () { demo.classList.add('is-lit'); });
  }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
    steps.forEach(function (el) { el.classList.add('is-in'); });
    lightDemo();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });

    // Each step lights as it comes into view.
    steps.forEach(function (el) { io.observe(el); });

    // The example path starts when most of it is on screen.
    if (demo) {
      var dio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { lightDemo(); dio.disconnect(); }
        });
      }, { threshold: 0.55 });
      dio.observe(demo);
    }
  }

  var replay = document.querySelector('[data-replay]');
  if (replay) replay.addEventListener('click', replayDemo);

  // ---------- Background network ----------
  // Small clusters of people (groups) with a few long bridges between them.
  // Every so often a pulse travels a route across several clusters and leaves
  // the path softly lit behind it, then it fades. The middle of the page stays clear.
  var canvas = document.getElementById('network');
  var ctx = canvas && canvas.getContext('2d');
  if (!ctx) return;

  var W = 0, H = 0, dpr = 1;
  var clusters = [], nodes = [], edges = [], bridges = [];
  var route = null, nextRouteAt = 0, running = false, lastTs = 0, lastW = 0, lastH = 0;
  var zone = { x: 0, y: 0, rx: 1, ry: 1 };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    lastW = W; lastH = H;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var small = W < 640;
    var want = small ? 6 : Math.max(8, Math.min(13, Math.round((W * H) / 130000)));
    var spread = small ? 0.62 : 1;
    clusters = []; nodes = []; edges = []; bridges = []; route = null;

    // Keep clusters out of the centre ellipse where the text sits.
    var cx = W / 2, cy = H * 0.46;
    var rx = W * (small ? 0.5 : 0.3), ry = H * (small ? 0.32 : 0.34);
    zone = { x: cx, y: cy, rx: rx, ry: ry };
    var minGap = Math.min(W, H) * (small ? 0.2 : 0.17);
    var tries = 0;
    while (clusters.length < want && tries++ < 600) {
      var p = { x: rand(0.03, 0.97) * W, y: rand(0.04, 0.97) * H };
      var inside = Math.pow((p.x - cx) / rx, 2) + Math.pow((p.y - cy) / ry, 2) < 1;
      if (inside) continue;
      var tooClose = clusters.some(function (c) { return dist(c, p) < minGap; });
      if (tooClose) continue;
      clusters.push({ x: p.x, y: p.y, members: [], hub: null, glow: 0 });
    }

    clusters.forEach(function (cl) {
      var n = Math.round(rand(5, 8));
      for (var i = 0; i < n; i++) {
        var a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * rand(34, 78) * spread;
        var node = {
          x: cl.x + Math.cos(a) * r, y: cl.y + Math.sin(a) * r,
          ox: 0, oy: 0, ph: rand(0, 6.28), sp: rand(0.18, 0.34), amp: rand(2.5, 5.5),
          r: rand(1.2, 2.3), glow: 0, cluster: cl
        };
        node.ox = node.x; node.oy = node.y;
        cl.members.push(node);
        nodes.push(node);
      }
      // Each person links to their two nearest neighbours in the group.
      cl.members.forEach(function (m, i) {
        var near = cl.members.map(function (o, j) { return { o: o, j: j, d: i === j ? 1e9 : dist(m, o) }; })
          .sort(function (a, b) { return a.d - b.d; }).slice(0, 2);
        near.forEach(function (nb) {
          var exists = edges.some(function (e) { return (e.a === m && e.b === nb.o) || (e.a === nb.o && e.b === m); });
          if (!exists) edges.push({ a: m, b: nb.o, glow: 0 });
        });
      });
      cl.hub = cl.members.reduce(function (best, m) { return dist(m, cl) < dist(best, cl) ? m : best; }, cl.members[0]);
    });

    // Bridges: a spanning tree over the cluster hubs, plus a few extra shortcuts.
    if (clusters.length > 1) {
      var inTree = [clusters[0]], rest = clusters.slice(1);
      while (rest.length) {
        var best = null;
        inTree.forEach(function (a) {
          rest.forEach(function (b) {
            var d = dist(a, b);
            if (!best || d < best.d) best = { a: a, b: b, d: d };
          });
        });
        addBridge(best.a, best.b);
        inTree.push(best.b);
        rest.splice(rest.indexOf(best.b), 1);
      }
      var extra = Math.max(2, Math.round(clusters.length / 3)), guard = 0;
      while (extra > 0 && guard++ < 60) {
        var a = clusters[Math.floor(Math.random() * clusters.length)];
        var b = clusters[Math.floor(Math.random() * clusters.length)];
        if (a === b || bridgeBetween(a, b)) continue;
        if (dist(a, b) > Math.max(W, H) * 0.55) continue;
        addBridge(a, b);
        extra--;
      }
    }
    nextRouteAt = performance.now() + 900;
  }

  function addBridge(a, b) {
    var sign = Math.random() < 0.5 ? -1 : 1;
    bridges.push({ a: a, b: b, bend: rand(0.12, 0.22) * sign, glow: 0, len: dist(a, b) });
  }
  function bridgeBetween(a, b) {
    return bridges.find(function (br) { return (br.a === a && br.b === b) || (br.a === b && br.b === a); });
  }
  function bridgeControl(br) {
    var ax = br.a.hub.x, ay = br.a.hub.y, bx = br.b.hub.x, by = br.b.hub.y;
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    return { x: mx - (by - ay) * br.bend, y: my + (bx - ax) * br.bend, ax: ax, ay: ay, bx: bx, by: by };
  }
  function bezier(c, t) {
    var u = 1 - t;
    return { x: u * u * c.ax + 2 * u * t * c.x + t * t * c.bx, y: u * u * c.ay + 2 * u * t * c.y + t * t * c.by };
  }

  // Pick a route of 3 to 4 clusters that follows existing bridges.
  function startRoute(now) {
    if (!bridges.length) return;
    var cur = clusters[Math.floor(Math.random() * clusters.length)];
    var legs = [], seen = [cur], hops = Math.random() < 0.5 ? 3 : 4;
    for (var i = 0; i < hops; i++) {
      var opts = bridges.filter(function (br) {
        var other = br.a === cur ? br.b : br.b === cur ? br.a : null;
        return other && seen.indexOf(other) === -1;
      });
      if (!opts.length) break;
      var br = opts[Math.floor(Math.random() * opts.length)];
      var forward = br.a === cur;
      legs.push({ br: br, forward: forward });
      cur = forward ? br.b : br.a;
      seen.push(cur);
    }
    if (!legs.length) { nextRouteAt = now + 1500; return; }
    route = { legs: legs, i: 0, t: 0, start: now };
    pulseCluster(legs[0].forward ? legs[0].br.a : legs[0].br.b);
  }

  function pulseCluster(cl) {
    cl.members.forEach(function (m) { m.glow = 1; });
    edges.forEach(function (e) { if (e.a.cluster === cl) e.glow = 1; });
  }

  function frame(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    draw(ts / 1000, dt, ts);
    requestAnimationFrame(frame);
  }

  function draw(time, dt, now) {
    ctx.clearRect(0, 0, W, H);

    // Slow, organic drift.
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.x = n.ox + Math.sin(time * n.sp + n.ph) * n.amp;
      n.y = n.oy + Math.cos(time * n.sp * 0.8 + n.ph) * n.amp;
    }

    // Light fades back out slowly.
    var decay = Math.pow(0.5, dt / 2.2);
    for (i = 0; i < nodes.length; i++) nodes[i].glow *= decay;
    for (i = 0; i < edges.length; i++) edges[i].glow *= decay;
    for (i = 0; i < bridges.length; i++) bridges[i].glow *= Math.pow(0.5, dt / 3.2);

    // Groups.
    ctx.lineWidth = 1;
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      ctx.strokeStyle = 'rgba(142,164,245,' + (0.13 + e.glow * 0.32).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    }

    // Bridges between groups.
    for (i = 0; i < bridges.length; i++) {
      var br = bridges[i], c = bridgeControl(br);
      ctx.strokeStyle = 'rgba(142,164,245,' + (0.075 + br.glow * 0.5).toFixed(3) + ')';
      ctx.lineWidth = 1 + br.glow * 0.6;
      ctx.beginPath(); ctx.moveTo(c.ax, c.ay); ctx.quadraticCurveTo(c.x, c.y, c.bx, c.by); ctx.stroke();
    }

    // People.
    for (i = 0; i < nodes.length; i++) {
      var m = nodes[i];
      var g = m.glow;
      if (g > 0.05) {
        var halo = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 12);
        halo.addColorStop(0, 'rgba(185,199,255,' + (0.45 * g).toFixed(3) + ')');
        halo.addColorStop(1, 'rgba(142,164,245,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(m.x, m.y, 12, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = 'rgba(238,242,255,' + (0.5 + g * 0.45).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r + g * 0.6, 0, 6.2832); ctx.fill();
    }

    // The travelling pulse.
    if (!reduceMotion) {
      if (!route && now > nextRouteAt) startRoute(now);
      if (route) {
        var leg = route.legs[route.i], b = leg.br, ctl = bridgeControl(b);
        var speed = 150; // pixels per second
        route.t += (speed * dt) / Math.max(120, b.len);
        var t = Math.min(1, route.t);
        var pos = bezier(ctl, leg.forward ? t : 1 - t);
        b.glow = Math.max(b.glow, 0.35 + 0.65 * t);
        var pg = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 14);
        pg.addColorStop(0, 'rgba(210,220,255,0.95)');
        pg.addColorStop(1, 'rgba(142,164,245,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 14, 0, 6.2832); ctx.fill();
        if (route.t >= 1) {
          pulseCluster(leg.forward ? b.b : b.a);
          route.i++; route.t = 0;
          if (route.i >= route.legs.length) { route = null; nextRouteAt = now + rand(2200, 4800); }
        }
      }
    }

    // Fade everything out in the middle so the text always sits on calm black.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.translate(zone.x, zone.y);
    ctx.scale(1, zone.ry / zone.rx);
    var clear = ctx.createRadialGradient(0, 0, zone.rx * 0.55, 0, 0, zone.rx * 1.25);
    clear.addColorStop(0, 'rgba(0,0,0,1)');
    clear.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = clear;
    ctx.fillRect(-zone.rx * 1.4, -zone.rx * 1.4, zone.rx * 2.8, zone.rx * 2.8);
    ctx.restore();
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  build();
  if (reduceMotion) {
    // One calm still frame, with a single path softly lit.
    if (bridges.length) {
      bridges.slice(0, Math.min(3, bridges.length)).forEach(function (br) { br.glow = 0.35; pulseCluster(br.a); pulseCluster(br.b); });
    }
    nodes.forEach(function (n) { n.glow *= 0.6; });
    draw(0, 0, 0);
  } else {
    start();
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      // Phone toolbars show and hide while scrolling; don't rebuild for those small height changes.
      if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 160) return;
      build();
      if (reduceMotion) draw(0, 0, 0);
    }, 180);
  });
})();
