// ===== HOTLINE DPI — UI =====
const api = window.hotline

const DEFAULT_CONFIG = {
  dnsServer: 'cloudflare', dpiMode: '2',
  targets: { steam: true, discord: true, reddit: true, netease: true, 'cn-games': true }
}

let state = { connected: false, connecting: false, queryCount: 0, ticker: null, tickSecs: 0, queryRates: [] }

// ===== DPI MODE DESCRIPTION =====
const DPI_DESC = {
  '1': 'Tách nhỏ gói TCP — không ảnh hưởng tốc độ tải xuống, CPU/RAM gần như không tăng. Dùng thử đầu tiên.',
  '2': 'Fake packet + tách gói — tốc độ tải xuống giữ nguyên, CPU tăng nhẹ (~1-2%). Phù hợp hầu hết ISP Việt Nam.',
  '3': 'Dùng preset -4 (tất cả kỹ thuật của GoodbyeDPI) — mạnh nhất, CPU cao hơn chút. Dùng khi 2 chế độ trên không hiệu quả.',
}

function updateDpiDesc(val) {
  const el = document.getElementById('dpi-mode-desc')
  if (el) el.textContent = DPI_DESC[val] ?? ''
}

// ===== SETTINGS PERSISTENCE =====
function collectSettings() {
  const settings = {
    dnsServer:  document.getElementById('dns-server')?.value  ?? 'cloudflare',
    dpiMode:    document.getElementById('dpi-mode')?.value    ?? '2',
    adapter:    document.getElementById('net-adapter')?.value ?? '__all__',
    services:   {}
  }
  document.querySelectorAll('.svc-check').forEach(cb => {
    settings.services[cb.dataset.svc] = cb.checked
  })
  return settings
}

async function saveSettings() {
  await api.saveSettings(collectSettings())
}

async function applySettings(s) {
  if (!s) return

  // Áp dụng vào các select (custom select wrapper)
  const setSelect = (id, val) => {
    const el = document.getElementById(id)
    if (!el) return
    el.value = val
    // Update custom select label nếu có
    const wrapper = el.closest('.custom-select')
    if (wrapper?._updateSelected) wrapper._updateSelected(val)
    else {
      // fallback: dispatch change
      el.dispatchEvent(new Event('change'))
    }
  }

  if (s.dnsServer) setSelect('dns-server', s.dnsServer)
  if (s.dpiMode)   setSelect('dpi-mode',   s.dpiMode)
  if (s.adapter)   setSelect('net-adapter', s.adapter)

  if (s.services) {
    document.querySelectorAll('.svc-check').forEach(cb => {
      const val = s.services[cb.dataset.svc]
      if (val !== undefined) cb.checked = val
    })
  }
}

// Lắng nghe thay đổi để auto-save
function watchSettingsChanges() {
  const saveDebounced = debounce(saveSettings, 600)
  document.querySelectorAll('#dns-server, #dpi-mode, #net-adapter').forEach(el => {
    el.addEventListener('change', saveDebounced)
  })
  document.querySelectorAll('.svc-check').forEach(cb => {
    cb.addEventListener('change', saveDebounced)
  })
}

function debounce(fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

// ===== CUSTOM SELECT =====
function createCustomSelect(nativeSelect) {
  if (!nativeSelect) return
  const wrapper = document.createElement('div')
  wrapper.className = 'custom-select'
  nativeSelect.parentNode.insertBefore(wrapper, nativeSelect)
  nativeSelect.style.display = 'none'
  wrapper.appendChild(nativeSelect)

  const options = Array.from(nativeSelect.options)

  const btn = document.createElement('div')
  btn.className = 'custom-select-btn'
  btn.innerHTML = `<span class="custom-select-label">${nativeSelect.options[nativeSelect.selectedIndex]?.text ?? ''}</span><span class="custom-select-arrow">▼</span>`
  wrapper.insertBefore(btn, nativeSelect)

  // Append dropdown thẳng vào body để thoát khỏi mọi overflow/stacking context
  const dropdown = document.createElement('div')
  dropdown.className = 'custom-select-dropdown'
  document.body.appendChild(dropdown)

  options.forEach(opt => {
    const item = document.createElement('div')
    item.className = 'custom-select-option' + (opt.selected ? ' selected' : '')
    item.textContent = opt.text
    item.dataset.value = opt.value
    item.addEventListener('mousedown', (e) => {
      // mousedown thay vì click để chạy trước blur
      e.preventDefault()
      nativeSelect.value = opt.value
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      btn.querySelector('.custom-select-label').textContent = opt.text
      dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'))
      item.classList.add('selected')
      closeDropdown()
    })
    dropdown.appendChild(item)
  })

  function openDropdown() {
    // Đóng tất cả dropdown khác
    document.querySelectorAll('.custom-select-btn.open').forEach(b => {
      if (b !== btn) b.classList.remove('open')
    })
    document.querySelectorAll('.custom-select-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open')
    })

    const rect = btn.getBoundingClientRect()
    dropdown.style.position = 'fixed'
    dropdown.style.top      = (rect.bottom + 2) + 'px'
    dropdown.style.left     = rect.left + 'px'
    dropdown.style.width    = rect.width + 'px'
    dropdown.style.zIndex   = '99999'
    btn.classList.add('open')
    dropdown.classList.add('open')
  }

  function closeDropdown() {
    btn.classList.remove('open')
    dropdown.classList.remove('open')
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    btn.classList.contains('open') ? closeDropdown() : openDropdown()
  })

  document.addEventListener('click', closeDropdown)

  // API để update selected từ bên ngoài
  wrapper._updateSelected = (val) => {
    nativeSelect.value = val
    const opt = options.find(o => o.value === val)
    if (opt) {
      btn.querySelector('.custom-select-label').textContent = opt.text
      dropdown.querySelectorAll('.custom-select-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.value === val)
      })
    }
  }
}

// Khởi tạo tất cả select trong app
function initCustomSelects() {
  document.querySelectorAll('select.sel').forEach(sel => createCustomSelect(sel))

  // Cập nhật mô tả DPI mode khi thay đổi
  const dpiMode = document.getElementById('dpi-mode')
  if (dpiMode) {
    updateDpiDesc(dpiMode.value)
    dpiMode.addEventListener('change', () => updateDpiDesc(dpiMode.value))
  }
}

// ===== NAV =====
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    const pg = document.getElementById('page-' + btn.dataset.page)
    if (pg) {
      // Restart animation bằng cách remove/add class
      pg.style.animation = 'none'
      void pg.offsetWidth
      pg.style.animation = ''
      pg.classList.add('active')
    }
    // Tự động refresh DNS panel khi vào tab công cụ
    if (btn.dataset.page === 'tools') refreshDnsPanel()
  })
})

// ===== WINDOW CONTROLS =====
document.getElementById('btn-min').addEventListener('click',   () => api.minimize())
document.getElementById('btn-max').addEventListener('click',   () => api.maximize())
document.getElementById('btn-close').addEventListener('click', () => api.close())

// ===== ADMIN CHECK =====
async function checkAdmin() {
  const ok = await api.checkAdmin()
  if (!ok) document.getElementById('admin-overlay').style.display = 'flex'
}
document.getElementById('btn-overlay-ok').addEventListener('click', () => {
  document.getElementById('admin-overlay').style.display = 'none'
})

// ===== CONFIG =====
function getConfig() {
  // Đọc dịch vụ được bật từ checkbox
  const targets = { 'cn-games': true }
  document.querySelectorAll('.svc-check').forEach(cb => {
    targets[cb.dataset.svc] = cb.checked
  })
  targets['cn-games'] = targets['netease'] ?? true

  return {
    dnsServer:    document.getElementById('dns-server')?.value   ?? 'cloudflare',
    dpiMode:      document.getElementById('dpi-mode')?.value     ?? '2',
    dpiBlacklist: true,
    dpiQuic:      true,
    dnsEncrypted: true,
    dnsAntiPoison:true,
    adapter:      document.getElementById('net-adapter')?.value  ?? '__all__',
    targets
  }
}

// ===== CONNECT / DISCONNECT =====
async function doConnect() {
  if (state.connecting) return
  state.connecting = true
  setUI('connecting')
  addLog('đang kết nối...', 'warn')
  const cfg = getConfig()
  const result = await api.connect(cfg)
  state.connecting = false
  if (result.success) {
    state.connected = true
    setUI('connected', cfg)
    startTicker()
    addLog('kết nối thành công', 'ok')
    addLog(result.message?.toLowerCase() ?? '', 'ok')
  } else {
    state.connected = false
    setUI('disconnected')
    addLog('lỗi: ' + (result.message ?? ''), 'err')
  }
}

async function doDisconnect() {
  if (state.connecting) return
  state.connecting = true
  addLog('đang ngắt kết nối...', 'warn')
  await api.disconnect()
  state.connecting = false
  state.connected  = false
  stopTicker()
  setUI('disconnected')
  addLog('đã ngắt kết nối · dns được khôi phục', 'ok')
}

// ===== UI STATE =====
function setUI(mode, cfg) {
  const homeTop = document.getElementById('home-top')
  const barBtn  = document.getElementById('bar-btn')
  const barDot  = document.getElementById('bar-dot')
  const barSB   = document.getElementById('statusbar')

  if (mode === 'connecting') {
    homeTop.classList.remove('connected'); barSB.classList.remove('on')
    setText('main-status-label', 'ĐANG KẾT NỐI...')
    setText('main-status-addr',  'vui lòng chờ')
    setText('connect-state-text','')
    setText('connect-hint',      '')
    barDot.className = 'status-dot'
    setText('bar-state', 'ĐANG KẾT NỐI...')
    barBtn.textContent = '◌ KẾT NỐI'; barBtn.className = 'connect-bar-btn'; barBtn.disabled = true

  } else if (mode === 'connected') {
    homeTop.classList.add('connected'); barSB.classList.add('on')
    const srvLabel = { cloudflare:'Cloudflare 1.1.1.1', google:'Google 8.8.8.8', quad9:'Quad9 9.9.9.9', adguard:'AdGuard DNS' }
    const srv = srvLabel[cfg?.dnsServer ?? 'cloudflare']
    setText('main-status-label', 'ĐANG BẢO VỆ')
    setText('main-status-addr',  '127.0.0.1 → ' + srv)
    setText('connect-state-text','')
    setText('connect-hint',      '')
    barDot.className = 'status-dot on'
    setText('bar-state', 'ĐANG BẢO VỆ')
    barBtn.textContent = '⏻ NGẮT KẾT NỐI'; barBtn.className = 'connect-bar-btn off'; barBtn.disabled = false
    setVal('stat-dpi',    'GoodbyeDPI', true)
    setVal('stat-server', srv,          true)
    const sq = document.getElementById('stat-queries')
    if (sq) sq.className = 'info-metric-val small on'

    // Cập nhật dịch vụ trên trang chủ
    const cfg2 = getConfig()
    ;['steam','discord','reddit','netease'].forEach((svc, i) => {
      const el = document.getElementById('hsvc-' + svc)
      if (el) {
        el.classList.toggle('active', cfg2.targets[svc] !== false)
        if (cfg2.targets[svc] !== false) {
          // stagger animation
          el.style.animation = 'none'
          void el.offsetWidth
          el.style.animation = `svcEntrance 0.3s ease ${i * 0.07}s both`
        }
      }
    })
  } else {
    homeTop.classList.remove('connected'); barSB.classList.remove('on')
    setText('main-status-label', 'CHƯA BẢO VỆ')
    setText('main-status-addr',  'bấm để kết nối')
    setText('connect-state-text','')
    setText('connect-hint',      '')
    barDot.className = 'status-dot'
    setText('bar-state', 'CHƯA BẢO VỆ')
    barBtn.textContent = '⏻ KẾT NỐI'; barBtn.className = 'connect-bar-btn'; barBtn.disabled = false
    setVal('stat-dpi',    'tắt', false); setVal('stat-server', '—', false)
    const sq2 = document.getElementById('stat-queries')
    if (sq2) { sq2.textContent = '0'; sq2.className = 'info-metric-val small off' }
    if (lv) { lv.textContent = '-- ms'; lv.className = 'info-metric-val small' }
    state.queryCount = 0; state.queryRates = []
    ;['steam','discord','reddit','netease'].forEach(svc => {
      document.getElementById('hsvc-' + svc)?.classList.remove('active')
    })
  }
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val }
function setVal(id, val, on) {
  const el = document.getElementById(id)
  if (!el) return
  el.textContent = val
  // Support cả class cũ và mới
  if (el.classList.contains('info-metric-val')) {
    el.classList.toggle('on',  !!on)
    el.classList.toggle('off', !on)
  } else {
    el.className = 'stat-val ' + (on ? 'on' : 'off')
  }
}

// ===== TICKER =====
function startTicker() {
  state.queryCount = 0; state.tickSecs = 0; state.queryRates = []
  state.ticker = setInterval(() => {
    state.tickSecs++

    // Mỗi giây sinh ra 0-5 DNS queries ngẫu nhiên (simulate thực tế)
    const delta = Math.floor(Math.random() * 5)
    state.queryRates.push(delta)
    if (state.queryRates.length > 60) state.queryRates.shift()

    // Tổng 60 giây qua = queries/phút
    const qpm = state.queryRates.reduce((a, b) => a + b, 0)
    const sqEl = document.getElementById('stat-queries')
    if (sqEl) {
      const prev = sqEl.textContent
      sqEl.textContent = qpm.toString()
      if (qpm.toString() !== prev) triggerPop(sqEl)
    }

    const ms = 8 + Math.floor(Math.random() * 18)
    const el = document.getElementById('latency-val')
    if (el) {
      el.textContent = ms + ' ms'
      el.className = 'info-metric-val' + (ms < 40 ? ' on' : '')
      triggerPop(el)
    }
  }, 1000)
}
function stopTicker() {
  if (state.ticker) clearInterval(state.ticker)
  state.ticker = null
  state.queryRates = []
}

function triggerPop(el) {
  el.classList.remove('num-pop')
  // force reflow để reset animation
  void el.offsetWidth
  el.classList.add('num-pop')
  setTimeout(() => el.classList.remove('num-pop'), 350)
}

// ===== CONNECT BUTTONS =====
document.getElementById('power-btn').addEventListener('click', () => { if (state.connected) doDisconnect(); else doConnect() })
document.getElementById('bar-btn').addEventListener('click',   () => { if (state.connected) doDisconnect(); else doConnect() })
api.onTrayToggle(() => { if (!state.connected && !state.connecting) doConnect(); else if (state.connected) doDisconnect() })

// ===== LOGS =====
const terminal = document.getElementById('log-terminal')
function addLog(msg, type = 'info') {
  if (!msg) return
  const d = document.createElement('div')
  d.className = 'log-line ' + type
  d.textContent = `[${new Date().toLocaleTimeString('vi-VN', { hour12: false })}] ${msg}`
  d.style.animation = 'logLine 0.18s ease both'
  terminal.appendChild(d)
  terminal.scrollTop = terminal.scrollHeight
}
api.onLog(msg => {
  const t = /^ERROR/.test(msg) ? 'err' : /^(SUCCESS|OK)/.test(msg) ? 'ok' : /^WARN/.test(msg) ? 'warn' : 'info'
  addLog(msg.toLowerCase(), t)
})
document.getElementById('btn-clear-logs').addEventListener('click', () => {
  terminal.innerHTML = '<div class="log-line info">[hotline-dpi] nhật ký đã xoá.</div>'
})

// ===== DNS INFO PANEL =====
let _dnsAdapters = []

function renderDnsPanel() {
  const panel = document.getElementById('dns-info-panel')
  if (!panel) return

  // Chỉ hiện adapter đang kết nối
  const list = _dnsAdapters.filter(a => a.isUp)

  if (list.length === 0) {
    panel.innerHTML = '<div class="dns-loading">không có adapter đang kết nối</div>'
    return
  }

  const knownDns = ['Cloudflare','Google','Quad9','AdGuard','Hotline DPI (dnsproxy)']

  panel.innerHTML = list.map(a => {
    const { name, isUp, isDisabled, ipv4, ipv6, isp, hasDoH } = a
    const isDHCP = !ipv4 || ipv4 === 'DHCP'

    const statusClass = isUp ? 'up' : 'down'
    const statusText  = isUp ? '● kết nối' : isDisabled ? '○ đã tắt' : '○ ngắt'

    const ipv4html = isDHCP
      ? '<span class="dns-row-val dhcp">DHCP (ISP mặc định)</span>'
      : `<span class="dns-row-val">${ipv4}${hasDoH ? '<span class="dns-tag">DoH</span>' : ''}</span>`

    const isIpv6DHCP = !ipv6 || ipv6 === 'DHCP'
    const ipv6html = isIpv6DHCP
      ? '<span class="dns-row-val dhcp">DHCP</span>'
      : `<span class="dns-row-val">${ipv6}</span>`

    const ispClass = knownDns.includes(isp) ? 'green'
                   : isp === 'Hotline DPI (dnsproxy)' ? 'green'
                   : isDHCP ? 'dhcp' : 'isp'

    return `<div class="dns-adapter-card">
      <div class="dns-adapter-head">
        <span class="dns-adapter-name">${name}</span>
        <span class="dns-adapter-status ${statusClass}">${statusText}</span>
      </div>
      <div class="dns-adapter-body">
        <div class="dns-row"><span class="dns-row-label">IPv4</span>${ipv4html}</div>
        <div class="dns-row"><span class="dns-row-label">IPv6</span>${ipv6html}</div>
        <div class="dns-row"><span class="dns-row-label">Nhà mạng</span><span class="dns-row-val ${ispClass}">${isp ?? '—'}</span></div>
        <div class="dns-row"><span class="dns-row-label">DoH</span><span class="dns-row-val ${hasDoH ? 'green' : 'dhcp'}">${hasDoH ? 'Bật — DNS mã hoá' : 'Tắt — DNS thường'}</span></div>
      </div>
    </div>`
  }).join('')
}

async function refreshDnsPanel() {
  const panel = document.getElementById('dns-info-panel')
  if (!panel) return
  panel.innerHTML = '<div class="dns-loading">↻ đang kiểm tra...</div>'

  const raw = await api.getCurrentDns()

  if (!raw || raw.startsWith('error:') || raw.trim() === '') {
    panel.innerHTML = '<div class="dns-loading" style="color:var(--red)">không lấy được thông tin DNS</div>'
    return
  }

  // parse: "name~status~ipv4~ipv6~isp~doh||..."
  _dnsAdapters = raw.split('||').filter(Boolean).map(entry => {
    const [name, status, ipv4, ipv6, isp, doh] = entry.split('~')
    const s = status?.trim().toLowerCase()
    return {
      name:       name?.trim()  ?? '?',
      isUp:       s === 'up',
      isDisabled: s === 'disabled',
      statusText: s,
      ipv4:       ipv4?.trim()  ?? 'DHCP',
      ipv6:       ipv6?.trim()  ?? 'DHCP',
      isp:        isp?.trim()   ?? '—',
      hasDoH:     doh?.trim()   === 'co'
    }
  })

  renderDnsPanel()

  // Highlight nút DNS đang dùng
  highlightActiveDnsBtn()
}

document.getElementById('btn-refresh-dns')?.addEventListener('click', refreshDnsPanel)

// Highlight nút DNS đang dùng dựa vào IPv4 hiện tại
function highlightActiveDnsBtn() {
  // Lấy IP đầu tiên của adapter đang kết nối
  const activeAdapter = _dnsAdapters.find(a => a.isUp)
  const currentIp = activeAdapter?.ipv4?.split(',')[0]?.trim() ?? ''

  // Map IP → profile
  const ipToProfile = {
    '1.1.1.1':     'cf',
    '1.0.0.1':     'cf',
    '8.8.8.8':     'gg',
    '8.8.4.4':     'gg',
    '9.9.9.9':     'q9',
    '94.140.14.14':'ag',
    '127.0.0.1':   '__hotline__', // dnsproxy đang chạy
    '127.0.0.2':   '__hotline__',
  }

  const activeProfile = ipToProfile[currentIp] ?? null

  document.querySelectorAll('.dns-q-btn[data-dns]').forEach(btn => {
    btn.classList.remove('dns-active')
    const p = btn.dataset.dns
    if (!activeProfile) return

    // Match profile với nút
    if (activeProfile === '__hotline__') {
      // Đang kết nối Hotline DPI — không highlight nút nào
      return
    }
    if ((activeProfile === 'cf'  && (p === 'cf' || p === 'cf-doh')) ||
        (activeProfile === 'gg'  && (p === 'gg' || p === 'gg-doh')) ||
        (activeProfile === 'q9'  && p === 'q9') ||
        (activeProfile === 'ag'  && p === 'ag')) {

      // Nếu có DoH thì highlight nút DoH, không thì nút thường
      const r4 = activeAdapter?.ipv4 ?? ''
      // Kiểm tra DoH qua isp field (Hotline DPI = dnsproxy)
      const hasDoh = activeAdapter?.hasDoH ?? false
      if (hasDoh && p.endsWith('-doh'))  btn.classList.add('dns-active')
      if (!hasDoh && !p.endsWith('-doh')) btn.classList.add('dns-active')
    }
  })
}

// ===== DNS QUICK BUTTONS =====
document.querySelectorAll('.dns-q-btn[data-dns]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const profile   = btn.dataset.dns
    const resultEl  = document.getElementById('dns-set-result')
    document.querySelectorAll('.dns-q-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.5' })
    resultEl.style.display = 'block'; resultEl.className = 'dns-set-result'
    resultEl.textContent = '↻ đang đặt DNS...'

    const result = await api.setDnsQuick(profile)
    document.querySelectorAll('.dns-q-btn').forEach(b => { b.disabled = false; b.style.opacity = '1' })
    resultEl.className = result.success ? 'dns-set-result' : 'dns-set-result err'
    resultEl.textContent = result.message?.toLowerCase() ?? (result.success ? 'hoàn tất' : 'lỗi')
    addLog((result.message ?? '').toLowerCase(), result.success ? 'ok' : 'err')

    if (result.success) setTimeout(refreshDnsPanel, 1200)
  })
})

// ===== TEST CONNECTIONS =====
document.getElementById('btn-test-conn')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-test-conn')
  const box = document.getElementById('test-results')
  btn.textContent = '◌ đang test...'; btn.disabled = true
  box.style.display = 'block'
  box.innerHTML = '<div class="test-row"><span class="wait">đang kiểm tra kết nối...</span></div>'
  const results = await api.testConnections()
  box.innerHTML = results.map(r =>
    `<div class="test-row">
      <span class="lbl">${r.label}</span>
      <span class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓  OK' : '✗  KHÔNG KẾT NỐI ĐƯỢC'}</span>
    </div>`
  ).join('')
  btn.textContent = '▶ chạy lại'; btn.disabled = false
})

// ===== OPEN NETWORK ADAPTER =====
document.getElementById('btn-open-adapter')?.addEventListener('click',  () => api.openNetworkAdapter())
document.getElementById('btn-open-adapter2')?.addEventListener('click', () => api.openNetworkAdapter())

// ===== LOAD ADAPTERS =====
async function loadAdapters() {
  const sel = document.getElementById('net-adapter')
  if (!sel) return
  try {
    const adapters = await api.getAdapters()
    adapters.forEach(a => {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.name + (a.connected ? '' : ' (ngắt)')
      if (!a.connected) opt.style.color = 'var(--text-faint)'
      sel.appendChild(opt)
    })
  } catch (e) { console.error('loadAdapters:', e) }
}

// ===== MATRIX RAIN =====
(function initMatrix() {
  const canvas = document.getElementById('matrix-canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')

  const CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモラリルレロ'
  const FONT_SIZE = 13
  let cols = []
  let animId = null

  function resize() {
    canvas.width  = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const numCols = Math.floor(canvas.width / FONT_SIZE)
    // Giữ lại giá trị cũ, thêm/bớt nếu cần
    while (cols.length < numCols) cols.push(Math.random() * canvas.height / FONT_SIZE | 0)
    cols.length = numCols
  }

  function draw() {
    // Fade trail
    ctx.fillStyle = 'rgba(13, 15, 13, 0.055)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.font = `${FONT_SIZE}px Consolas, monospace`

    cols.forEach((y, i) => {
      const ch = CHARS[Math.random() * CHARS.length | 0]
      const x  = i * FONT_SIZE

      // Đầu cột — sáng hơn
      ctx.fillStyle = `rgba(0, 230, 118, 0.9)`
      ctx.fillText(ch, x, y * FONT_SIZE)

      // Reset ngẫu nhiên
      if (y * FONT_SIZE > canvas.height && Math.random() > 0.975) {
        cols[i] = 0
      } else {
        cols[i] = y + 1
      }
    })

    animId = requestAnimationFrame(draw)
  }

  function start() {
    if (animId) return
    resize()
    draw()
  }

  function stop() {
    if (animId) { cancelAnimationFrame(animId); animId = null }
  }

  // Chỉ chạy khi trang chủ active
  const observer = new MutationObserver(() => {
    const homeActive = document.getElementById('page-home')?.classList.contains('active')
    if (homeActive) start(); else stop()
  })

  document.querySelectorAll('.page').forEach(p => {
    observer.observe(p, { attributes: true, attributeFilter: ['class'] })
  })

  window.addEventListener('resize', resize)

  // Khởi động nếu trang chủ đang active
  if (document.getElementById('page-home')?.classList.contains('active')) start()
})()

// ===== INIT =====
async function init() {
  await checkAdmin()
  await loadAdapters()
  initCustomSelects()

  // Load settings đã lưu
  const saved = await api.loadSettings()
  if (saved) {
    await applySettings(saved)
    addLog('đã tải thiết lập đã lưu', 'info')
  }

  // Watch thay đổi để auto-save
  watchSettingsChanges()

  addLog('hotline dpi v1.0.0', 'ok')
  addLog('goodbyedpi v0.2.2 · dnsproxy v0.86.0', 'info')
  refreshDnsPanel()
}

init()
