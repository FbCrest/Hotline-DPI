"""
Hotline DPI - Backend
Xử lý DNS mã hoá, DPI bypass (GoodbyeDPI), và ISP throttle bypass
Cần quyền Administrator để chạy
"""

import sys
import os
import re

# Fix encoding cho Windows console
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import json
import subprocess
import threading
import time
import ctypes
import argparse
import signal
import tempfile

# Đường dẫn
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN_DIR = os.path.join(BASE_DIR, 'bin')
STATE_FILE = os.path.join(BASE_DIR, 'state.json')

GOODBYEDPI_EXE = os.path.join(BIN_DIR, 'goodbyedpi', 'goodbyedpi.exe')
DNSPROXY_EXE   = os.path.join(BIN_DIR, 'dnsproxy', 'dnsproxy.exe')

DNS_SERVERS = {
    'cloudflare': {'doh': 'https://cloudflare-dns.com/dns-query', 'fallback': '1.1.1.1'},
    'google':     {'doh': 'https://dns.google/dns-query',         'fallback': '8.8.8.8'},
    'quad9':      {'doh': 'https://dns.quad9.net/dns-query',      'fallback': '9.9.9.9'},
    'adguard':    {'doh': 'https://dns.adguard-dns.com/dns-query','fallback': '94.140.14.14'},
}

TARGET_HOSTS = {
    'steam': {
        'store.steampowered.com':             '104.64.33.7',
        'steamcommunity.com':                  '104.64.33.3',
        'steampowered.com':                    '104.64.33.5',
        'api.steampowered.com':                '104.64.33.8',
        'cdn.cloudflare.steamstatic.com':      '104.16.0.1',
    },
    'discord': {
        'discord.com':                         '162.159.130.232',
        'discordapp.com':                      '162.159.130.232',
        'gateway.discord.gg':                  '162.159.130.234',
        'media.discordapp.net':                '162.159.130.233',
    },
    'reddit': {
        'reddit.com':                          '151.101.129.140',
        'www.reddit.com':                      '151.101.129.140',
        'old.reddit.com':                      '151.101.193.140',
        'i.redd.it':                           '151.101.193.140',
    },
}

NETEASE_HOSTS = {
    'logincdn.ms.netease.com':   '223.252.199.12',
    'game.gt.163.com':           '223.252.199.15',
    'update.niemc.163.com':      '223.252.199.32',
    'cdn-e.game.163.com':        '223.252.199.20',
    'ntlb.nie.163.com':          '223.252.199.40',
}

DNS_PROFILES = {
    'cf':     {'ipv4': ['1.1.1.1', '1.0.0.1'], 'doh': ''},
    'cf-doh': {'ipv4': ['1.1.1.1', '1.0.0.1'], 'doh': 'https://cloudflare-dns.com/dns-query'},
    'gg':     {'ipv4': ['8.8.8.8', '8.8.4.4'], 'doh': ''},
    'gg-doh': {'ipv4': ['8.8.8.8', '8.8.4.4'], 'doh': 'https://dns.google/dns-query'},
    'dhcp':   {'ipv4': [],                       'doh': ''},
}

_processes  = {}
_state_lock = threading.Lock()

# ===== UTILS =====

def log(msg):
    print(msg, flush=True)

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def save_state(data):
    with _state_lock:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}

# ===== ADAPTER HELPERS =====

def get_network_adapters():
    """Trả về list tên adapter đang Connected."""
    adapters = []
    try:
        result = subprocess.run(
            ['netsh', 'interface', 'show', 'interface'],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            if 'Connected' in line:
                parts = line.split()
                if len(parts) >= 4:
                    adapters.append(' '.join(parts[3:]))
    except Exception as e:
        log(f'WARN get_network_adapters: {e}')
    return adapters

def get_all_adapters_info():
    """Trả về list (name, status) cho tất cả adapter."""
    adapters = []
    try:
        result = subprocess.run(
            ['netsh', 'interface', 'show', 'interface'],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 4 and parts[0] in ('Enabled', 'Disabled'):
                name   = ' '.join(parts[3:])
                status = parts[1]  # Connected / Disconnected
                adapters.append((name, status))
    except Exception as e:
        log(f'WARN get_all_adapters_info: {e}')
    return adapters

def resolve_adapters(config):
    chosen = config.get('adapter', '__all__')
    if chosen and chosen != '__all__':
        return [chosen]
    return get_network_adapters()

# ===== DNS MANAGEMENT =====

def save_original_dns():
    original = {}
    for adapter in get_network_adapters():
        original[adapter] = 'dhcp'
    return original

def set_dns_to_localhost(adapters):
    for adapter in adapters:
        try:
            subprocess.run(['netsh', 'interface', 'ip', 'set', 'dns',
                            f'name={adapter}', 'static', '127.0.0.1', 'primary'],
                           capture_output=True, timeout=10, check=False)
            subprocess.run(['netsh', 'interface', 'ip', 'add', 'dns',
                            f'name={adapter}', '127.0.0.2', 'index=2'],
                           capture_output=True, timeout=10, check=False)
        except Exception as e:
            log(f'WARN set_dns_to_localhost {adapter}: {e}')

def restore_dns(original_dns=None):
    if original_dns is None:
        state = load_state()
        original_dns = state.get('original_dns', {})
    adapters = list(original_dns.keys()) if original_dns else get_network_adapters()
    for adapter in adapters:
        try:
            subprocess.run(['netsh', 'interface', 'ip', 'set', 'dns',
                            f'name={adapter}', 'dhcp'],
                           capture_output=True, timeout=10, check=False)
        except Exception as e:
            log(f'WARN restore_dns {adapter}: {e}')
    log('OK DNS đã được khôi phục về DHCP')

# ===== DNS QUICK SET =====

def cmd_set_dns(profile):
    """Đặt DNS hệ thống theo profile mà không cần kết nối đầy đủ."""
    if not is_admin():
        log('ERROR Cần quyền Administrator để đổi DNS')
        return

    p = DNS_PROFILES.get(profile)
    if not p:
        log(f'ERROR Profile không hợp lệ: {profile}')
        return

    adapters = get_network_adapters()
    if not adapters:
        log('ERROR Không tìm thấy adapter mạng đang kết nối')
        return

    if profile == 'dhcp':
        for adapter in adapters:
            try:
                subprocess.run(['netsh', 'interface', 'ip', 'set', 'dns',
                                f'name={adapter}', 'dhcp'],
                               capture_output=True, timeout=10, check=False)
                subprocess.run(['netsh', 'interface', 'ipv6', 'set', 'dnsservers',
                                f'name={adapter}', 'dhcp'],
                               capture_output=True, timeout=10, check=False)
            except Exception as e:
                log(f'WARN {adapter}: {e}')
        subprocess.run(['ipconfig', '/flushdns'], capture_output=True)
        log('OK DNS đã được đặt về DHCP (mặc định ISP)')
    else:
        ipv4 = p['ipv4']
        ok_count = 0
        for adapter in adapters:
            try:
                r = subprocess.run(
                    ['netsh', 'interface', 'ip', 'set', 'dns',
                     f'name={adapter}', 'static', ipv4[0], 'primary'],
                    capture_output=True, text=True, timeout=10, check=False)
                if r.returncode == 0:
                    if len(ipv4) > 1:
                        subprocess.run(
                            ['netsh', 'interface', 'ip', 'add', 'dns',
                             f'name={adapter}', ipv4[1], 'index=2'],
                            capture_output=True, timeout=10, check=False)
                    ok_count += 1
                else:
                    log(f'WARN {adapter}: {r.stderr.strip() or r.stdout.strip()}')
            except Exception as e:
                log(f'WARN {adapter}: {e}')

        subprocess.run(['ipconfig', '/flushdns'], capture_output=True)
        doh_str = ' + DoH' if p['doh'] else ''
        if ok_count > 0:
            log(f'OK DNS đã đặt thành {ipv4[0]}{doh_str} ({ok_count} adapter)')
        else:
            log('ERROR Không thể đặt DNS — kiểm tra lại quyền Administrator')

# ===== DNS INFO =====

def get_isp_label(ip):
    if not ip:
        return 'DHCP'
    isp_map = [
        (['1.1.1.', '1.0.0.'],         'Cloudflare'),
        (['8.8.8.', '8.8.4.'],          'Google'),
        (['9.9.9.', '149.112.'],         'Quad9'),
        (['94.140.14.', '94.140.15.'],   'AdGuard'),
        (['208.67.222.', '208.67.220.'], 'OpenDNS'),
        (['117.', '27.72.', '171.', '203.113.', '125.235.', '115.79.'], 'Viettel'),
        (['118.69.', '118.70.', '210.245.', '42.113.'],                  'FPT'),
        (['123.', '203.162.', '113.16'],                                  'VNPT'),
    ]
    for prefixes, name in isp_map:
        if any(ip.startswith(p) for p in prefixes):
            return name
    return f'Khác ({ip})'

def cmd_dns_info():
    """In thông tin DNS hiện tại của tất cả adapter theo format name~status~ipv4~ipv6~isp~doh||..."""
    results = []
    for name, status in get_all_adapters_info():
        # IPv4
        r4 = subprocess.run(
            ['netsh', 'interface', 'ip', 'show', 'dnsservers', f'name={name}'],
            capture_output=True, text=True, timeout=5
        )
        ipv4_list = []
        for line in r4.stdout.splitlines():
            found = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', line)
            ipv4_list.extend(found)
        ipv4 = ', '.join(ipv4_list) if ipv4_list else 'DHCP'

        # IPv6
        r6 = subprocess.run(
            ['netsh', 'interface', 'ipv6', 'show', 'dnsservers', f'name={name}'],
            capture_output=True, text=True, timeout=5
        )
        ipv6_list = []
        for line in r6.stdout.splitlines():
            found = re.findall(r'[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}', line)
            ipv6_list.extend([x for x in found if x.count(':') >= 2])
        ipv6 = ', '.join(ipv6_list) if ipv6_list else 'DHCP'

        first_ip = ipv4_list[0] if ipv4_list else ''
        isp  = get_isp_label(first_ip)
        is_up = 'Connected' in status

        results.append(f'{name}~{"up" if is_up else "down"}~{ipv4}~{ipv6}~{isp}~khong')

    print('||'.join(results), flush=True)

# ===== HOSTS FILE =====

HOSTS_FILE         = r'C:\Windows\System32\drivers\etc\hosts'
HOSTS_MARKER_START = '# === HOTLINE DPI START ==='
HOSTS_MARKER_END   = '# === HOTLINE DPI END ==='

def read_hosts():
    try:
        with open(HOSTS_FILE, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except:
        return ''

def write_hosts(content):
    try:
        with open(HOSTS_FILE, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    except Exception as e:
        log(f'ERROR write_hosts: {e}')
        return False

def remove_hotline_hosts():
    content = read_hosts()
    if HOSTS_MARKER_START not in content:
        return
    lines    = content.splitlines()
    new_lines = []
    inside   = False
    for line in lines:
        if HOSTS_MARKER_START in line:
            inside = True; continue
        if HOSTS_MARKER_END in line:
            inside = False; continue
        if not inside:
            new_lines.append(line)
    write_hosts('\n'.join(new_lines).rstrip() + '\n')

def apply_hosts(targets):
    remove_hotline_hosts()
    entries = [HOSTS_MARKER_START]
    for target_name, enabled in targets.items():
        if not enabled:
            continue
        if target_name in TARGET_HOSTS:
            entries.append(f'# {target_name.upper()}')
            for domain, ip in TARGET_HOSTS[target_name].items():
                entries.append(f'{ip}\t{domain}')
        if target_name == 'netease':
            entries.append('# NETEASE GAMES')
            for domain, ip in NETEASE_HOSTS.items():
                entries.append(f'{ip}\t{domain}')
    entries.append(HOSTS_MARKER_END)
    current     = read_hosts()
    new_content = current.rstrip() + '\n\n' + '\n'.join(entries) + '\n'
    write_hosts(new_content)
    log(f'OK Đã thêm {len(entries) - 2} hosts entries')

# ===== DNSPROXY =====

def start_dnsproxy(dns_server='cloudflare'):
    if not os.path.exists(DNSPROXY_EXE):
        log('WARN dnsproxy không có sẵn')
        return None
    srv = DNS_SERVERS.get(dns_server, DNS_SERVERS['cloudflare'])
    cmd = [DNSPROXY_EXE, '-u', srv['doh'], '-b', srv['fallback'],
           '-l', '127.0.0.1', '-p', '53', '--cache', '--cache-size', '4096']
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        time.sleep(1)
        if proc.poll() is None:
            log(f'OK dnsproxy đang chạy — {srv["doh"]}')
            return proc
        log('ERROR dnsproxy khởi động thất bại')
        return None
    except Exception as e:
        log(f'ERROR dnsproxy: {e}')
        return None

def stop_dnsproxy():
    proc = _processes.pop('dnsproxy', None)
    if proc:
        proc.terminate()
        try: proc.wait(timeout=5)
        except: proc.kill()
        log('OK dnsproxy đã dừng')

# ===== GOODBYEDPI =====

def build_goodbyedpi_args(mode, quic):
    args = [GOODBYEDPI_EXE]
    if mode == '1':   args += ['-1', '--set-ttl', '5']
    elif mode == '2': args += ['-3', '--set-ttl', '5', '--auto-ttl']
    elif mode == '3': args += ['-4', '--set-ttl', '5', '--auto-ttl', '--wrong-seq', '--reverse-frag']
    if quic: args += ['--allow-no-sni']
    args += ['--port', '443', '--port', '80']
    return args

def build_goodbyedpi_blacklist(targets):
    domains = []
    for target, enabled in targets.items():
        if not enabled: continue
        if target in TARGET_HOSTS: domains.extend(TARGET_HOSTS[target].keys())
        if target == 'netease':    domains.extend(NETEASE_HOSTS.keys())
        if target == 'cn-games':   domains += ['nie.163.com', 'game.163.com', 'netease.com', '163.com']
    if not domains: return None
    bl = os.path.join(tempfile.gettempdir(), 'hotlinedpi_blacklist.txt')
    with open(bl, 'w', encoding='utf-8') as f:
        f.write('\n'.join(domains) + '\n')
    return bl

def start_goodbyedpi(config):
    if not os.path.exists(GOODBYEDPI_EXE):
        log('WARN GoodbyeDPI không có sẵn')
        return None
    args = build_goodbyedpi_args(config.get('dpiMode', '2'), config.get('dpiQuic', True))
    if config.get('dpiBlacklist', True):
        bl = build_goodbyedpi_blacklist(config.get('targets', {}))
        if bl: args += ['--blacklist', bl]
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        time.sleep(1.5)
        if proc.poll() is None:
            mode_names = {'1': 'Nhẹ', '2': 'Cân bằng', '3': 'Mạnh'}
            log(f'OK GoodbyeDPI — chế độ {mode_names.get(config.get("dpiMode","2"), "")}')
            return proc
        stderr = proc.stderr.read().decode(errors='ignore')
        log(f'ERROR GoodbyeDPI thất bại: {stderr[:200]}')
        return None
    except Exception as e:
        log(f'ERROR GoodbyeDPI: {e}')
        return None

def stop_dpi():
    proc = _processes.pop('dpi', None)
    if proc:
        proc.terminate()
        try: proc.wait(timeout=5)
        except: proc.kill()
    log('OK GoodbyeDPI đã dừng')

# ===== CONNECT / DISCONNECT =====

def cmd_connect(config):
    if not is_admin():
        log('ERROR Cần quyền Administrator!')
        return

    original_dns = save_original_dns()
    save_state({'connected': True, 'original_dns': original_dns, 'config': config})

    targets = config.get('targets', {})
    log('INFO Đang áp dụng hosts entries...')
    apply_hosts(targets)

    if config.get('dnsEncrypted', True):
        log('INFO Đang khởi động DNS mã hoá...')
        adapters = resolve_adapters(config)
        if adapters:
            dns_proc = start_dnsproxy(config.get('dnsServer', 'cloudflare'))
            if dns_proc:
                _processes['dnsproxy'] = dns_proc
                set_dns_to_localhost(adapters)
            else:
                srv = DNS_SERVERS.get(config.get('dnsServer', 'cloudflare'))
                for adapter in adapters:
                    try:
                        subprocess.run(['netsh', 'interface', 'ip', 'set', 'dns',
                                        f'name={adapter}', 'static', srv['fallback'], 'primary'],
                                       capture_output=True, timeout=10)
                    except: pass
                log(f'OK DNS fallback: {srv["fallback"]}')

    log('INFO Đang khởi động GoodbyeDPI...')
    dpi_proc = start_goodbyedpi(config)
    if dpi_proc:
        _processes['dpi'] = dpi_proc

    active = [k for k, v in targets.items() if v]
    log(f'SUCCESS Đã kết nối — Bảo vệ: {", ".join(active)}')

def cmd_disconnect():
    log('INFO Đang dừng GoodbyeDPI...')
    stop_dpi()
    log('INFO Đang dừng dnsproxy...')
    stop_dnsproxy()
    log('INFO Đang khôi phục DNS...')
    restore_dns()
    log('INFO Đang xoá hosts entries...')
    remove_hotline_hosts()
    save_state({'connected': False})
    log('SUCCESS Đã ngắt kết nối. Mọi thứ đã được khôi phục.')

def cmd_status():
    state = load_state()
    result = {
        'connected': state.get('connected', False),
        'dpi': 'running' if ('dpi' in _processes and _processes['dpi'].poll() is None) else 'off',
        'dns': 'encrypted' if ('dnsproxy' in _processes and _processes['dnsproxy'].poll() is None) else 'system',
        'config': state.get('config', {})
    }
    print(json.dumps(result))

def recovery_check():
    state = load_state()
    if state.get('connected', False):
        log('WARN Phiên trước chưa ngắt, đang khôi phục...')
        restore_dns(state.get('original_dns', {}))
        remove_hotline_hosts()
        save_state({'connected': False})
        log('OK Recovery hoàn tất')

# ===== ENTRY POINT =====

def main():
    parser = argparse.ArgumentParser(description='Hotline DPI Backend')
    parser.add_argument('--daemon', action='store_true')
    parser.add_argument('--cmd', type=str)
    args = parser.parse_args()

    def cleanup(signum, frame):
        cmd_disconnect()
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT,  cleanup)

    if args.daemon:
        recovery_check()
        log('INFO Hotline DPI backend sẵn sàng')
        while True:
            time.sleep(60)

    elif args.cmd:
        cmd = args.cmd

        if cmd.startswith('connect:'):
            try:
                cmd_connect(json.loads(cmd[len('connect:'):]))
            except json.JSONDecodeError as e:
                log(f'ERROR JSON không hợp lệ: {e}'); sys.exit(1)

        elif cmd == 'disconnect': cmd_disconnect()
        elif cmd == 'status':     cmd_status()
        elif cmd == 'restore':    restore_dns(); remove_hotline_hosts()
        elif cmd == 'dns-info':   cmd_dns_info()
        elif cmd.startswith('dns:'):
            cmd_set_dns(cmd[4:])
        else:
            log(f'ERROR Lệnh không hợp lệ: {cmd}'); sys.exit(1)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
