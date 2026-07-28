import urllib.request, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Try to find one more unique source to replace the duplicate Guovin/TV
urls = [
    # vbskycn/iptv - try different paths
    'https://ghproxy.net/https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv6.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.txt',
    # Try other known repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/xisohuai/iptv/main/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/xisohuai/iptv/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/yuanzl77/iptv/main/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/yuanzl77/iptv/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/main/cn.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/master/cn.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/main/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/main/Gather.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/dongyubin/IPTV/master/Gather.m3u',
    # Try testingcf.jsdelivr.net with other repos
    'https://testingcf.jsdelivr.net/gh/iptv-china/iptv-china.github.io@master/cqyx.m3u',
    'https://testingcf.jsdelivr.net/gh/iptv-china/iptv-china.github.io@master/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/iptv-china/iptv-china.github.io@master/live.m3u',
    'https://testingcf.jsdelivr.net/gh/iptv-china/iptv-china.github.io@master/README.md',
    'https://testingcf.jsdelivr.net/gh/iptv-china/iptv-china.github.io@main/README.md',
    'https://testingcf.jsdelivr.net/gh/xisohuai/iptv@main/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/xisohuai/iptv@master/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/yuanzl77/iptv@main/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/yuanzl77/iptv@master/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@main/cn.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@master/cn.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@main/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@master/iptv.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@main/Gather.m3u',
    'https://testingcf.jsdelivr.net/gh/dongyubin/IPTV@master/Gather.m3u',
    # Try more repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
    # Try other repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
    # Try other repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
    # Try other repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
    # Try other repos
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/cqyx.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/iptv.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/live.m3u',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/master/README.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/iptv-china/iptv-china.github.io/main/README.md',
]
for url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        r = urllib.request.urlopen(req, timeout=10, context=ctx)
        data = r.read(100)
        print(f'OK ({len(data)}b): {url}')
    except Exception as e:
        pass  # Only print successes
print('Done')
