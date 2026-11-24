(function () {
  'use strict';

  // ---------- Waitlist ----------
  const config = window.PIPELINE_LANDING_CONFIG || {};
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function joinWaitlist(email, source) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error('Signups open soon — please check back in a bit.');
    }
    const res = await fetch(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/landing_waitlist', {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: 'Bearer ' + config.supabaseKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ email: email, source: 'landing-' + source })
    });
    // 409 = this email is already on the list; treat it as success.
    if (res.ok || res.status === 409) return;
    throw new Error('Something went wrong. Please try again.');
  }

  document.querySelectorAll('form.waitlist').forEach(function (form) {
    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('button');
    const status = form.querySelector('.form-status');

    function show(msg, kind) {
      status.textContent = msg;
      status.classList.toggle('is-error', kind === 'error');
      status.classList.toggle('is-ok', kind === 'ok');
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = input.value.trim();

      // Honeypot: bots fill hidden fields, people don't.
      if (form.querySelector('.hp').value) {
        form.classList.add('is-done');
        show("You're on the list. We'll be in touch.", 'ok');
        return;
      }
      if (!EMAIL_RE.test(email) || email.length > 254) {
        show('Please enter a valid email address.', 'error');
        input.focus();
        return;
      }

      button.disabled = true;
      show('Adding you…');
      try {
        await joinWaitlist(email, form.dataset.source || 'page');
        form.classList.add('is-done');
        show("You're on the list. We'll let you know when your group is live.", 'ok');
      } catch (err) {
        show(err.message, 'error');
        button.disabled = false;
      }
    });
  });

  // ---------- Background network ----------
  // Clusters of dots (groups) whose members link to each other, with a few
  // bridges between clusters and light pulses flowing along the bridges.
  const canvas = document.getElementById('network');
  const ctx = canvas && canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, nodes = [], links = [], bridges = [], pulses = [];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    nodes = []; links = []; bridges = []; pulses = [];
    const clusterCount = W < 640 ? 4 : 7;
    const clusters = [];
    for (let c = 0; c < clusterCount; c++) {
      // Keep clusters toward the edges so the center text stays clean.
      const side = c % 2 === 0 ? rand(0.02, 0.24) : rand(0.76, 0.98);
      clusters.push({ x: side * W, y: rand(0.08, 0.95) * H, members: [] });
    }
    clusters.forEach(function (cl) {
      const n = Math.round(rand(5, 9));
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), r = rand(10, 70);
        const node = {
          x: cl.x + Math.cos(a) * r, y: cl.y + Math.sin(a) * r,
          ox: 0, oy: 0, phase: rand(0, Math.PI * 2), r: rand(1.2, 2.4)
        };
        node.ox = node.x; node.oy = node.y;
        cl.members.push(node);
        nodes.push(node);
      }
      for (let i = 0; i < cl.members.length; i++) {
        for (let j = i + 1; j < cl.members.length; j++) {
          if (Math.random() < 0.35) links.push([cl.members[i], cl.members[j]]);
        }
      }
    });
    for (let c = 0; c < clusters.length; c++) {
      const a = clusters[c], b = clusters[(c + 1) % clusters.length];
      bridges.push([a.members[0], b.members[1] || b.members[0]]);
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const time = t / 1000;

    nodes.forEach(function (n) {
      n.x = n.ox + Math.sin(time * 0.3 + n.phase) * 4;
      n.y = n.oy + Math.cos(time * 0.25 + n.phase) * 4;
    });

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(142,164,245,0.16)';
    links.forEach(function (l) {
      ctx.beginPath(); ctx.moveTo(l[0].x, l[0].y); ctx.lineTo(l[1].x, l[1].y); ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(142,164,245,0.07)';
    bridges.forEach(function (b) {
      ctx.beginPath(); ctx.moveTo(b[0].x, b[0].y); ctx.lineTo(b[1].x, b[1].y); ctx.stroke();
    });

    ctx.fillStyle = 'rgba(238,242,255,0.75)';
    nodes.forEach(function (n) {
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    });

    if (!reduceMotion) {
      if (pulses.length < 4 && Math.random() < 0.02) {
        pulses.push({ bridge: bridges[Math.floor(Math.random() * bridges.length)], p: 0, speed: rand(0.002, 0.004) });
      }
      pulses = pulses.filter(function (pl) {
        pl.p += pl.speed;
        const a = pl.bridge[0], b = pl.bridge[1];
        const x = a.x + (b.x - a.x) * pl.p, y = a.y + (b.y - a.y) * pl.p;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, 'rgba(180,196,255,0.9)');
        g.addColorStop(1, 'rgba(142,164,245,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
        return pl.p < 1;
      });
      requestAnimationFrame(draw);
    }
  }

  build();
  requestAnimationFrame(draw);
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { build(); if (reduceMotion) requestAnimationFrame(draw); }, 150);
  });
})();
