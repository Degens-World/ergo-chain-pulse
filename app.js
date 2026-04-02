// ============================================================
// Ergo Chain Pulse — app.js
// Live network health monitor with EKG block-time visualization
// ============================================================

const EXPLORER  = 'https://api.ergoplatform.com/api/v1';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd';
const REFRESH_INTERVAL = 30; // seconds

// ── DOM refs ─────────────────────────────────────────────────
const statusDot      = document.getElementById('statusDot');
const ekgSub         = document.getElementById('ekgSub');
const lastBlockEl    = document.getElementById('lastBlock');
const blockHeightEl  = document.getElementById('blockHeight');
const blockIntervalEl= document.getElementById('blockInterval');
const hashrateEl     = document.getElementById('hashrate');
const txCountEl      = document.getElementById('txCount');
const ergPriceEl     = document.getElementById('ergPrice');
const difficultyEl   = document.getElementById('difficulty');
const healthFill     = document.getElementById('healthFill');
const healthScore    = document.getElementById('healthScore');
const healthLabel    = document.getElementById('healthLabel');
const healthBreakdown= document.getElementById('healthBreakdown');
const blocksBody     = document.getElementById('blocksBody');
const nextRefreshEl  = document.getElementById('nextRefresh');
const refreshBtn     = document.getElementById('refreshBtn');
const canvas         = document.getElementById('ekgCanvas');
const ctx            = canvas.getContext('2d');

// ── Stars ────────────────────────────────────────────────────
(function spawnStars() {
  const container = document.getElementById('stars');
  for (let i = 0; i < 100; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%; top:${Math.random()*100}%;
      --d:${(Math.random()*4+2).toFixed(1)}s;
      animation-delay:${(Math.random()*4).toFixed(1)}s;
      opacity:${Math.random()*0.5+0.1};
    `;
    container.appendChild(s);
  }
})();

// ── EKG canvas state ─────────────────────────────────────────
const EKG_POINTS = 60; // how many block-time samples to show
let ekgData      = [];  // array of block times in seconds
let ekgAnimFrame = null;
let ekgScanX     = 0;   // animated scan line position (0-1)
let lastEkgTs    = performance.now();

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = rect.width  * devicePixelRatio;
  canvas.height = 120         * devicePixelRatio;
  canvas.style.height = '120px';
  drawEkg();
}

function drawEkg() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // background grid
  ctx.strokeStyle = 'rgba(30,37,53,0.8)';
  ctx.lineWidth = 1;
  const cols = 10, rows = 4;
  for (let i = 0; i <= cols; i++) {
    ctx.beginPath(); ctx.moveTo(i/cols*W, 0); ctx.lineTo(i/cols*W, H); ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    ctx.beginPath(); ctx.moveTo(0, j/rows*H); ctx.lineTo(W, j/rows*H); ctx.stroke();
  }

  if (ekgData.length < 2) {
    ctx.fillStyle = 'rgba(85,96,112,0.7)';
    ctx.font = `${14*devicePixelRatio}px Courier New`;
    ctx.textAlign = 'center';
    ctx.fillText('Collecting block data…', W/2, H/2);
    return;
  }

  // compute scale: target ~120s average → mid of canvas
  const TARGET_TIME = 120;
  const maxT = Math.max(...ekgData, TARGET_TIME * 1.8);

  const stepX = W / (EKG_POINTS - 1);
  const baseline = H * 0.85;

  // glow under curve
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,255,170,0.18)');
  grad.addColorStop(1, 'rgba(0,255,170,0)');

  ctx.beginPath();
  ctx.moveTo(0, baseline);
  for (let i = 0; i < ekgData.length; i++) {
    const x = i * stepX;
    const t = ekgData[i];
    // spike: fast up proportional to block time deviation, then sharp drop
    const spike = (t / maxT) * baseline * 0.9;
    const y = baseline - spike;
    if (i === 0) ctx.lineTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.lineTo((ekgData.length-1)*stepX, baseline);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // main line
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  for (let i = 0; i < ekgData.length; i++) {
    const x = i * stepX;
    const t = ekgData[i];
    const spike = (t / maxT) * baseline * 0.9;
    const y = baseline - spike;
    ctx.lineTo(x, y);
  }
  ctx.lineTo((ekgData.length-1)*stepX, baseline);
  ctx.strokeStyle = '#00ffaa';
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.shadowColor = '#00ffaa';
  ctx.shadowBlur  = 8 * devicePixelRatio;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 120s reference line (target)
  const refY = baseline - (TARGET_TIME / maxT) * baseline * 0.9;
  ctx.beginPath();
  ctx.setLineDash([6*devicePixelRatio, 6*devicePixelRatio]);
  ctx.moveTo(0, refY); ctx.lineTo(W, refY);
  ctx.strokeStyle = 'rgba(255,209,102,0.35)';
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.stroke();
  ctx.setLineDash([]);

  // animated scan line
  const scanX = ekgScanX * W;
  ctx.beginPath();
  ctx.moveTo(scanX, 0); ctx.lineTo(scanX, H);
  ctx.strokeStyle = 'rgba(0,255,170,0.3)';
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.stroke();
}

function animateEkg() {
  const now  = performance.now();
  const dt   = (now - lastEkgTs) / 1000;
  lastEkgTs  = now;
  ekgScanX   = (ekgScanX + dt * 0.08) % 1;
  drawEkg();
  ekgAnimFrame = requestAnimationFrame(animateEkg);
}

// ── Data state ────────────────────────────────────────────────
let lastSeenHeight = 0;
let refreshCountdown = REFRESH_INTERVAL;
let countdownTimer   = null;

// ── Helpers ───────────────────────────────────────────────────
function fmtHashrate(hps) {
  if (hps >= 1e15) return (hps/1e15).toFixed(2) + ' PH/s';
  if (hps >= 1e12) return (hps/1e12).toFixed(2) + ' TH/s';
  if (hps >= 1e9)  return (hps/1e9).toFixed(2)  + ' GH/s';
  if (hps >= 1e6)  return (hps/1e6).toFixed(2)  + ' MH/s';
  return hps.toFixed(0) + ' H/s';
}
function fmtDifficulty(d) {
  if (d >= 1e15) return (d/1e15).toFixed(2) + ' P';
  if (d >= 1e12) return (d/1e12).toFixed(2) + ' T';
  if (d >= 1e9)  return (d/1e9).toFixed(2)  + ' G';
  if (d >= 1e6)  return (d/1e6).toFixed(2)  + ' M';
  return d.toString();
}
function timeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)  return secs + 's ago';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  return Math.floor(secs/3600) + 'h ago';
}
function blockTimeClass(secs) {
  if (secs < 90)  return 'tag-good';
  if (secs < 180) return 'tag-mid';
  return 'tag-bad';
}
function flash(el) {
  el.classList.remove('flash');
  void el.offsetWidth; // reflow
  el.classList.add('flash');
}

// ── Fetch helpers ─────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ── Main refresh ──────────────────────────────────────────────
async function refresh() {
  statusDot.className = 'status-dot';
  ekgSub.textContent  = '— polling…';

  try {
    // Fetch last 20 blocks for EKG + table
    const [blocksRes, priceRes] = await Promise.allSettled([
      fetchJSON(`${EXPLORER}/blocks?limit=20&sortBy=height&sortDirection=desc`),
      fetchJSON(COINGECKO),
    ]);

    if (blocksRes.status === 'rejected') throw blocksRes.reason;
    const blocks = blocksRes.value.items || [];
    if (blocks.length === 0) throw new Error('No blocks returned');

    // Price
    if (priceRes.status === 'fulfilled') {
      const price = priceRes.value?.ergo?.usd;
      if (price != null) {
        ergPriceEl.textContent = '$' + price.toFixed(3);
        flash(document.getElementById('cardPrice'));
      }
    }

    // Compute block-time intervals
    const intervals = [];
    for (let i = 0; i < blocks.length - 1; i++) {
      const dt = (blocks[i].timestamp - blocks[i+1].timestamp) / 1000;
      if (dt > 0 && dt < 3600) intervals.push(Math.round(dt));
    }

    // EKG data: prepend newest to history (keep last EKG_POINTS)
    const newIntervals = intervals.slice(0, 15);
    for (const t of newIntervals.reverse()) {
      ekgData.push(t);
    }
    if (ekgData.length > EKG_POINTS) ekgData = ekgData.slice(-EKG_POINTS);

    // Stats from latest block
    const latest = blocks[0];
    const height = latest.height;
    const isNew  = height !== lastSeenHeight;
    lastSeenHeight = height;

    blockHeightEl.textContent = height.toLocaleString();
    if (isNew) flash(document.getElementById('cardHeight'));

    const avgInterval = intervals.length
      ? Math.round(intervals.slice(0,10).reduce((a,b)=>a+b,0) / Math.min(intervals.length,10))
      : null;

    if (avgInterval) {
      blockIntervalEl.textContent = avgInterval + 's';
      flash(document.getElementById('cardInterval'));
    }

    // Hashrate estimate: difficulty / (block_time * 2^32)
    // Ergo uses modified difficulty (autolykos2): hashrate ≈ difficulty / (target_time)
    const diff = latest.difficulty || 0;
    difficultyEl.textContent = fmtDifficulty(diff);
    if (diff && avgInterval) {
      const hr = diff / avgInterval;
      hashrateEl.textContent = fmtHashrate(hr);
      flash(document.getElementById('cardHashrate'));
    }
    flash(document.getElementById('cardDiff'));

    txCountEl.textContent = (latest.transactionsCount || 0).toString();
    flash(document.getElementById('cardTxs'));

    const secsSinceLast = Math.floor((Date.now() - latest.timestamp) / 1000);
    lastBlockEl.textContent = `Last block: ${timeAgo(latest.timestamp)}`;
    ekgSub.textContent = `— #${height.toLocaleString()} · ${secsSinceLast}s since last block`;

    // ── Health score ──────────────────────────────────────────
    let score = 0;
    const chips = [];
    // 1. Block regularity (0-35): avg interval close to 120s
    if (avgInterval) {
      const dev = Math.abs(avgInterval - 120) / 120;
      const reg = Math.max(0, 35 - dev * 70);
      score += reg;
      chips.push({ label: 'Regularity', val: Math.round(reg) + '/35', color: reg > 25 ? 'good' : reg > 15 ? 'mid' : 'bad' });
    }
    // 2. Freshness (0-25): how recent the last block is
    const freshScore = Math.max(0, 25 - (secsSinceLast / 120) * 25);
    score += freshScore;
    chips.push({ label: 'Freshness', val: Math.round(freshScore) + '/25', color: freshScore > 18 ? 'good' : freshScore > 10 ? 'mid' : 'bad' });
    // 3. Tx throughput (0-20): more txs = healthier
    const txScore = Math.min(20, (latest.transactionsCount || 0) * 2);
    score += txScore;
    chips.push({ label: 'Throughput', val: Math.round(txScore) + '/20', color: txScore > 14 ? 'good' : txScore > 7 ? 'mid' : 'bad' });
    // 4. Variance (0-20): low spread of block times
    if (intervals.length >= 3) {
      const mean = intervals.reduce((a,b)=>a+b,0)/intervals.length;
      const variance = intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length;
      const cv = Math.sqrt(variance) / mean; // coefficient of variation
      const varScore = Math.max(0, 20 - cv * 40);
      score += varScore;
      chips.push({ label: 'Consistency', val: Math.round(varScore) + '/20', color: varScore > 14 ? 'good' : varScore > 7 ? 'mid' : 'bad' });
    }

    const pct = Math.min(100, Math.round(score));
    healthFill.style.width = pct + '%';
    healthScore.textContent = pct;

    const labels = [
      [0,  30,  'CRITICAL — Chain needs attention'],
      [30, 50,  'WEAK — Below target performance'],
      [50, 70,  'FAIR — Mostly stable, some lag'],
      [70, 85,  'GOOD — Network running well'],
      [85, 95,  'STRONG — Chain is healthy'],
      [95, 101, 'EXCELLENT — Peak performance'],
    ];
    for (const [lo, hi, msg] of labels) {
      if (pct >= lo && pct < hi) { healthLabel.textContent = msg; break; }
    }

    healthBreakdown.innerHTML = chips
      .map(c => `<div class="breakdown-chip">${c.label}: <span class="tag-${c.color}">${c.val}</span></div>`)
      .join('');

    // ── Recent blocks table ───────────────────────────────────
    const rows = blocks.slice(0, 15).map((b, idx) => {
      const bt = intervals[idx] != null ? intervals[idx] : '—';
      const btClass = typeof bt === 'number' ? blockTimeClass(bt) : '';
      const shortMiner = b.minerReward != null ? '' : '';
      // miner address from header if available
      const miner = b.minerId
        ? b.minerId.slice(0,8) + '…'
        : (b.miner?.name || b.miner?.address?.slice(0,8) + '…' || '—');
      const sizeKb = b.size ? (b.size / 1024).toFixed(1) + ' KB' : '—';
      const isNewRow = idx === 0 && isNew ? ' class="new-block"' : '';
      return `<tr${isNewRow}>
        <td>#${b.height.toLocaleString()}</td>
        <td>${timeAgo(b.timestamp)}</td>
        <td class="${btClass}">${typeof bt === 'number' ? bt + 's' : bt}</td>
        <td>${b.transactionsCount ?? '—'}</td>
        <td>${sizeKb}</td>
        <td>${miner}</td>
      </tr>`;
    });
    blocksBody.innerHTML = rows.join('');

    statusDot.className = 'status-dot live';
    startCountdown();

  } catch (err) {
    console.error('Chain Pulse error:', err);
    statusDot.className = 'status-dot error';
    ekgSub.textContent  = '— fetch failed, retrying…';
    startCountdown();
  }
}

// ── Countdown ─────────────────────────────────────────────────
function startCountdown() {
  clearInterval(countdownTimer);
  refreshCountdown = REFRESH_INTERVAL;
  nextRefreshEl.textContent = `Auto-refresh in ${refreshCountdown}s`;
  countdownTimer = setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
      clearInterval(countdownTimer);
      refresh();
    } else {
      nextRefreshEl.textContent = `Auto-refresh in ${refreshCountdown}s`;
    }
  }, 1000);
}

// ── Init ──────────────────────────────────────────────────────
refreshBtn.addEventListener('click', () => {
  clearInterval(countdownTimer);
  refresh();
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
animateEkg();
refresh();
