/**
 * Hotline DPI — Node.js Backend
 * Thay thế hoàn toàn Python backend.
 * Chạy trong main process của Electron (đã có admin qua start.bat).
 */

'use strict'

const { exec, spawn } = require('child_process')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

// ===== PATHS =====
const BASE_DIR = path.join(__dirname, '..')

// Detect packaged vs dev
let IS_PACKAGED = false
try {
  const { app: electronApp } = require('electron')
  IS_PACKAGED = electronApp.isPackaged
} catch {}

const ACTUAL_BIN = IS_PACKAGED
  ? path.join(process.resourcesPath, 'bin')
  : path.join(BASE_DIR, 'bin')

const STATE_DIR  = IS_PACKAGED
  ? path.join(os.homedir(), '.hotlinedpi')
  : BASE_DIR
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const GOODBYEDPI_EXE = path.join(ACTUAL_BIN, 'goodbyedpi', 'goodbyedpi.exe')
const DNSPROXY_EXE   = path.join(ACTUAL_BIN, 'dnsproxy',   'dnsproxy.exe')
const HOSTS_FILE     = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
const HOSTS_START    = '# === HOTLINE DPI START ==='
const HOSTS_END      = '# === HOTLINE DPI END ==='

// ===== STATE =====
let _dpiProc     = null
let _dnsProc     = null
let _logCallback = null

function setLogCallback(fn) { _logCallback = fn }

function log(msg) {
  console.log('[backend]', msg)
  if (_logCallback) _logCallback(msg)
}

// ===== STATE FILE =====
function saveState(data) {
  try {
    const dir = path.dirname(STATE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8')
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

// ===== EXEC HELPER =====
function run(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), err })
    })
  })
}

// ===== ADMIN CHECK =====
async function checkAdmin() {
  const r = await run('net session')
  return r.ok
}

// ===== ADAPTER HELPERS =====
async function getConnectedAdapters() {
  const r = await run('netsh interface show interface')
  const adapters = []
  for (const line of r.stdout.split('\n')) {
    if (line.includes('Connected')) {
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length >= 4) adapters.push(parts[parts.length - 1].trim())
    }
  }
  return adapters
}

async function getAllAdapters() {
  const r = await run('netsh interface show interface')
  const adapters = []
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(Enabled|Disabled)\s+(Connected|Disconnected)\s+\S+\s+(.+)$/)
    if (m) adapters.push({
      name:      m[3].trim(),
      connected: m[2] === 'Connected' && m[1] === 'Enabled',
      enabled:   m[1] === 'Enabled',
      status:    m[2]  // 'Connected' | 'Disconnected'
    })
  }
  return adapters
}

// ===== DNS INFO =====
const ISP_MAP = [
  [['127.0.0.'],                          'Hotline DPI (dnsproxy)'],
  [['1.1.1.', '1.0.0.'],                  'Cloudflare'],
  [['8.8.8.', '8.8.4.'],                   'Google'],
  [['9.9.9.', '149.112.'],                  'Quad9'],
  [['94.140.14.', '94.140.15.'],            'AdGuard'],
  [['208.67.222.', '208.67.220.'],          'OpenDNS'],
  [['117.', '27.72.', '171.', '203.113.', '125.235.'], 'Viettel'],
  [['118.69.', '118.70.', '210.245.', '42.113.'],       'FPT'],
  [['123.', '203.162.', '113.16'],                       'VNPT'],
]

function getISP(ip) {
  if (!ip) return 'DHCP'
  for (const [prefixes, name] of ISP_MAP) {
    if (prefixes.some(p => ip.startsWith(p))) return name
  }
  return `Khác (${ip})`
}

async function getDnsInfo() {
  const adapters = await getAllAdapters()
  const results = []

  for (const { name, connected, enabled, status } of adapters) {
    // IPv4
    const r4 = await run(`netsh interface ip show dnsservers name="${name}"`)
    const ipv4List = []
    for (const line of r4.stdout.split('\n')) {
      const m = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)
      if (m) ipv4List.push(m[1])
    }
    const ipv4 = ipv4List.length ? ipv4List.join(', ') : 'DHCP'

    // IPv6
    const r6 = await run(`netsh interface ipv6 show dnsservers name="${name}"`)
    const ipv6List = []
    for (const line of r6.stdout.split('\n')) {
      const m = line.match(/[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}/)
      if (m && m[0].includes(':')) ipv6List.push(m[0])
    }
    const ipv6 = ipv6List.length ? ipv6List.join(', ') : 'DHCP'

    const isp = getISP(ipv4List[0])

    // status: 'up' | 'down' | 'disabled'
    let adapterStatus = 'up'
    if (!enabled)     adapterStatus = 'disabled'
    else if (!connected) adapterStatus = 'down'

    results.push(`${name}~${adapterStatus}~${ipv4}~${ipv6}~${isp}~khong`)
  }

  return results.join('||')
}

// ===== DNS QUICK SET =====
const DNS_PROFILES = {
  'cf':     { ipv4: ['1.1.1.1', '1.0.0.1'],   doh: '' },
  'cf-doh': { ipv4: ['1.1.1.1', '1.0.0.1'],   doh: 'https://cloudflare-dns.com/dns-query' },
  'gg':     { ipv4: ['8.8.8.8', '8.8.4.4'],   doh: '' },
  'gg-doh': { ipv4: ['8.8.8.8', '8.8.4.4'],   doh: 'https://dns.google/dns-query' },
  'dhcp':   { ipv4: [],                         doh: '' },
}

async function setDnsQuick(profile) {
  const p = DNS_PROFILES[profile]
  if (!p) return { success: false, message: 'Profile không hợp lệ' }

  const adapters = await getConnectedAdapters()
  if (!adapters.length) return { success: false, message: 'Không tìm thấy adapter mạng' }

  if (profile === 'dhcp') {
    for (const a of adapters) {
      await run(`netsh interface ip set dns name="${a}" dhcp`)
      await run(`netsh interface ipv6 set dnsservers name="${a}" dhcp`)
    }
    await run('ipconfig /flushdns')
    return { success: true, message: `OK DNS đã về DHCP (${adapters.join(', ')})` }
  }

  let okCount = 0
  for (const a of adapters) {
    const r = await run(`netsh interface ip set dns name="${a}" static ${p.ipv4[0]} primary`)
    if (r.ok) {
      if (p.ipv4[1]) await run(`netsh interface ip add dns name="${a}" ${p.ipv4[1]} index=2`)
      okCount++
    } else {
      log(`WARN ${a}: ${r.stderr || r.stdout}`)
    }
  }

  await run('ipconfig /flushdns')

  if (okCount === 0) return { success: false, message: 'ERROR Không thể đặt DNS — cần quyền Administrator' }

  const dohStr = p.doh ? ' + DoH' : ''
  return { success: true, message: `OK DNS đã đặt thành ${p.ipv4[0]}${dohStr} (${okCount} adapter)` }
}

// ===== HOSTS FILE =====
const TARGET_HOSTS = {
  steam: {
    'store.steampowered.com':           '104.64.33.7',
    'steamcommunity.com':                '104.64.33.3',
    'steampowered.com':                  '104.64.33.5',
    'api.steampowered.com':              '104.64.33.8',
    'cdn.cloudflare.steamstatic.com':    '104.16.0.1',
  },
  discord: {
    'discord.com':                       '162.159.130.232',
    'discordapp.com':                    '162.159.130.232',
    'gateway.discord.gg':                '162.159.130.234',
    'media.discordapp.net':              '162.159.130.233',
  },
  reddit: {
    'reddit.com':                        '151.101.129.140',
    'www.reddit.com':                    '151.101.129.140',
    'old.reddit.com':                    '151.101.193.140',
    'i.redd.it':                         '151.101.193.140',
  },
}

const NETEASE_HOSTS = {
  'logincdn.ms.netease.com':  '223.252.199.12',
  'game.gt.163.com':          '223.252.199.15',
  'update.niemc.163.com':     '223.252.199.32',
  'cdn-e.game.163.com':       '223.252.199.20',
  'ntlb.nie.163.com':         '223.252.199.40',
}

function readHosts() {
  try { return fs.readFileSync(HOSTS_FILE, 'utf8') } catch { return '' }
}

function writeHosts(content) {
  try { fs.writeFileSync(HOSTS_FILE, content, 'utf8'); return true }
  catch (e) { log(`ERROR writeHosts: ${e.message}`); return false }
}

function removeHotlineHosts() {
  const content = readHosts()
  if (!content.includes(HOSTS_START)) return
  const lines    = content.split('\n')
  const newLines = []
  let inside     = false
  for (const line of lines) {
    if (line.includes(HOSTS_START)) { inside = true; continue }
    if (line.includes(HOSTS_END))   { inside = false; continue }
    if (!inside) newLines.push(line)
  }
  writeHosts(newLines.join('\n').trimEnd() + '\n')
}

function applyHosts(targets) {
  removeHotlineHosts()
  const entries = [HOSTS_START]

  for (const [name, enabled] of Object.entries(targets)) {
    if (!enabled) continue
    if (TARGET_HOSTS[name]) {
      entries.push(`# ${name.toUpperCase()}`)
      for (const [domain, ip] of Object.entries(TARGET_HOSTS[name])) {
        entries.push(`${ip}\t${domain}`)
      }
    }
    if (name === 'netease') {
      entries.push('# NETEASE GAMES')
      for (const [domain, ip] of Object.entries(NETEASE_HOSTS)) {
        entries.push(`${ip}\t${domain}`)
      }
    }
  }
  entries.push(HOSTS_END)

  const current    = readHosts()
  const newContent = current.trimEnd() + '\n\n' + entries.join('\n') + '\n'
  writeHosts(newContent)
  log(`OK Đã thêm ${entries.length - 2} hosts entries`)
}

// ===== DNSPROXY =====
const DNS_SERVERS = {
  cloudflare: { doh: 'https://cloudflare-dns.com/dns-query', fallback: '1.1.1.1' },
  google:     { doh: 'https://dns.google/dns-query',         fallback: '8.8.8.8' },
  quad9:      { doh: 'https://dns.quad9.net/dns-query',      fallback: '9.9.9.9' },
  adguard:    { doh: 'https://dns.adguard-dns.com/dns-query',fallback: '94.140.14.14' },
}

async function startDnsproxy(dnsServer = 'cloudflare') {
  if (!fs.existsSync(DNSPROXY_EXE)) {
    log('WARN dnsproxy không có sẵn')
    return false
  }
  const srv = DNS_SERVERS[dnsServer] || DNS_SERVERS.cloudflare
  _dnsProc = spawn(DNSPROXY_EXE, [
    '-u', srv.doh, '-b', srv.fallback,
    '-l', '127.0.0.1', '-p', '53',
    '--cache', '--cache-size', '4096'
  ], { stdio: 'ignore', windowsHide: true })

  await new Promise(r => setTimeout(r, 1000))

  if (_dnsProc.exitCode !== null) {
    log('ERROR dnsproxy khởi động thất bại')
    _dnsProc = null
    return false
  }
  log(`OK dnsproxy đang chạy — ${srv.doh}`)
  return true
}

function stopDnsproxy() {
  if (_dnsProc) {
    try { _dnsProc.kill() } catch {}
    _dnsProc = null
    log('OK dnsproxy đã dừng')
  }
}

async function setDnsToLocalhost(adapters) {
  for (const a of adapters) {
    await run(`netsh interface ip set dns name="${a}" static 127.0.0.1 primary`)
    await run(`netsh interface ip add dns name="${a}" 127.0.0.2 index=2`)
  }
}

// ===== GOODBYEDPI =====
async function startGoodbyeDPI(config) {
  if (!fs.existsSync(GOODBYEDPI_EXE)) {
    log('WARN GoodbyeDPI không có sẵn')
    return false
  }

  const mode = config.dpiMode || '2'
  const args = [GOODBYEDPI_EXE]

  if      (mode === '1') args.push('-1', '--set-ttl', '5')
  else if (mode === '2') args.push('-3', '--set-ttl', '5', '--auto-ttl')
  else if (mode === '3') args.push('-4', '--set-ttl', '5', '--auto-ttl')

  if (config.dpiQuic !== false) args.push('--allow-no-sni')
  args.push('--port', '443', '--port', '80')

  // Blacklist
  if (config.dpiBlacklist !== false) {
    const domains = []
    const targets = config.targets || {}
    for (const [k, v] of Object.entries(targets)) {
      if (!v) continue
      if (TARGET_HOSTS[k]) domains.push(...Object.keys(TARGET_HOSTS[k]))
      if (k === 'netease') domains.push(...Object.keys(NETEASE_HOSTS))
      if (k === 'cn-games') domains.push('nie.163.com', 'game.163.com', 'netease.com', '163.com')
    }
    if (domains.length) {
      const blFile = path.join(os.tmpdir(), 'hotlinedpi_blacklist.txt')
      fs.writeFileSync(blFile, domains.join('\n') + '\n', 'utf8')
      args.push('--blacklist', blFile)
    }
  }

  _dpiProc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

  // Capture stderr để debug
  _dpiProc.stderr?.on('data', d => log(`WARN GoodbyeDPI: ${d.toString().trim()}`))

  await new Promise(r => setTimeout(r, 1500))

  if (_dpiProc.exitCode !== null) {
    log(`ERROR GoodbyeDPI thoát ngay — exit code ${_dpiProc.exitCode}. Kiểm tra: 1) Chạy với quyền Admin 2) Antivirus có block WinDivert không`)
    _dpiProc = null
    return false
  }

  const modeNames = { '1': 'Nhẹ', '2': 'Cân bằng', '3': 'Mạnh' }
  log(`OK GoodbyeDPI đang chạy — chế độ ${modeNames[mode]}`)
  return true
}

function stopGoodbyeDPI() {
  if (_dpiProc) {
    try { _dpiProc.kill() } catch {}
    _dpiProc = null
    log('OK GoodbyeDPI đã dừng')
  }
}

// ===== CONNECT / DISCONNECT =====
async function saveOriginalDns(adapters) {
  const original = {}
  for (const a of adapters) {
    // Lấy IPv4 DNS hiện tại
    const r = await run(`netsh interface ip show dnsservers name="${a}"`)
    const ips = []
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)
      if (m) ips.push(m[1])
    }
    // Kiểm tra có phải DHCP không
    const isDhcp = r.stdout.toLowerCase().includes('dhcp') || ips.length === 0
    original[a] = isDhcp ? 'dhcp' : ips
  }
  return original
}

async function restoreOriginalDns(originalDns) {
  for (const [adapter, value] of Object.entries(originalDns)) {
    if (value === 'dhcp' || !value || value.length === 0) {
      await run(`netsh interface ip set dns name="${adapter}" dhcp`)
    } else {
      // Khôi phục DNS tĩnh
      await run(`netsh interface ip set dns name="${adapter}" static ${value[0]} primary`)
      for (let i = 1; i < value.length; i++) {
        await run(`netsh interface ip add dns name="${adapter}" ${value[i]} index=${i + 1}`)
      }
    }
  }
  await run('ipconfig /flushdns')
}

async function connect(config) {
  const targets = config.targets || {}

  // 1. Hosts file
  log('INFO Đang áp dụng hosts entries...')
  applyHosts(targets)

  // 2. DNS
  if (config.dnsEncrypted !== false) {
    log('INFO Đang khởi động DNS mã hoá...')
    const adapters = config.adapter && config.adapter !== '__all__'
      ? [config.adapter]
      : await getConnectedAdapters()

    if (adapters.length) {
      // Lưu DNS gốc trước khi thay đổi
      const originalDns = await saveOriginalDns(adapters)
      log(`INFO DNS gốc đã lưu: ${JSON.stringify(originalDns)}`)

      const dnsOk = await startDnsproxy(config.dnsServer || 'cloudflare')
      if (dnsOk) {
        await setDnsToLocalhost(adapters)
      } else {
        const srv = DNS_SERVERS[config.dnsServer] || DNS_SERVERS.cloudflare
        for (const a of adapters) {
          await run(`netsh interface ip set dns name="${a}" static ${srv.fallback} primary`)
        }
        log(`OK DNS fallback: ${srv.fallback}`)
      }

      // Lưu state kèm DNS gốc
      const active = Object.entries(targets).filter(([, v]) => v).map(([k]) => k)
      saveState({ connected: true, config, originalDns, adapters })
      log(`SUCCESS Đã kết nối — Bảo vệ: ${active.join(', ')}`)

      // 3. GoodbyeDPI
      log('INFO Đang khởi động GoodbyeDPI...')
      await startGoodbyeDPI(config)
      return
    }
  }

  // 3. GoodbyeDPI (nếu không dùng DNS)
  log('INFO Đang khởi động GoodbyeDPI...')
  await startGoodbyeDPI(config)

  const active = Object.entries(targets).filter(([, v]) => v).map(([k]) => k)
  log(`SUCCESS Đã kết nối — Bảo vệ: ${active.join(', ')}`)
  saveState({ connected: true, config, originalDns: {}, adapters: [] })
}

async function disconnect() {
  log('INFO Đang dừng GoodbyeDPI...')
  stopGoodbyeDPI()

  log('INFO Đang dừng dnsproxy...')
  stopDnsproxy()

  log('INFO Đang khôi phục DNS...')
  const state = loadState()
  const originalDns = state.originalDns || {}

  if (Object.keys(originalDns).length > 0) {
    await restoreOriginalDns(originalDns)
    // Log từng adapter
    for (const [a, v] of Object.entries(originalDns)) {
      const val = v === 'dhcp' ? 'DHCP' : (Array.isArray(v) ? v.join(', ') : v)
      log(`OK ${a} → ${val}`)
    }
  } else {
    // Fallback: về DHCP
    const adapters = await getConnectedAdapters()
    for (const a of adapters) {
      await run(`netsh interface ip set dns name="${a}" dhcp`)
    }
    await run('ipconfig /flushdns')
  }

  log('INFO Đang xoá hosts entries...')
  removeHotlineHosts()

  saveState({ connected: false })
  log('SUCCESS Đã ngắt kết nối. DNS đã được khôi phục.')
}

// Recovery khi khởi động lại sau crash
async function recoveryCheck() {
  const state = loadState()
  if (state.connected) {
    log('WARN Phiên trước chưa ngắt, đang khôi phục DNS...')
    if (state.originalDns && Object.keys(state.originalDns).length > 0) {
      await restoreOriginalDns(state.originalDns)
    } else {
      const adapters = await getConnectedAdapters()
      for (const a of adapters) await run(`netsh interface ip set dns name="${a}" dhcp`)
    }
    removeHotlineHosts()
    saveState({ connected: false })
    log('OK Recovery hoàn tất')
  }
}

// ===== TEST CONNECTIONS =====
async function testConnections() {
  const hosts = [
    ['NetEase Games',    'game.gt.163.com'],
    ['Steam Store',      'store.steampowered.com'],
    ['Steam Community',  'steamcommunity.com'],
    ['Discord',          'discord.com'],
    ['Reddit',           'reddit.com'],
    ['Cloudflare DNS',   '1.1.1.1'],
    ['Google DNS',       '8.8.8.8'],
  ]
  const results = await Promise.all(
    hosts.map(([label, host]) =>
      run(`ping -n 1 -w 2000 ${host}`).then(r => ({
        label, host, ok: r.ok && r.stdout.includes('TTL=')
      }))
    )
  )
  return results
}

module.exports = {
  setLogCallback,
  checkAdmin,
  getAllAdapters,
  getDnsInfo,
  setDnsQuick,
  connect,
  disconnect,
  recoveryCheck,
  testConnections,
}
