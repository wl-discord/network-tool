const Connector = require('proxy-chain');
const axios = require('axios');
const net = require('net');
const cheerio = require('cheerio');
const httpProxy = require('http-proxy');
require('dotenv').config();

const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
const DATA_SOURCE = process.env.DATA_SOURCE || "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/refs/heads/main/socks5_proxies.txt";
let allNodes = [];

// 生存確認 (0.1秒)
function isAlive(proxyUrl) {
    return new Promise((resolve) => {
        try {
            const url = proxyUrl.replace('socks5://', '');
            const [host, port] = url.split(':');
            const socket = new net.Socket();
            socket.setTimeout(100);
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            const fail = () => { socket.destroy(); resolve(false); };
            socket.on('timeout', fail);
            socket.on('error', fail);
            socket.connect(port, host);
        } catch (e) { resolve(false); }
    });
}

async function syncList() {
    try {
        const res = await axios.get(DATA_SOURCE);
        allNodes = [...new Set(res.data.split('\n').map(s => s.trim()).filter(s => s.startsWith('socks5://')))];
    } catch (e) {}
}
syncList();
setInterval(syncList, 15 * 60 * 1000);

const bridge = new Connector.Server({
    port: process.env.PORT || 10000,
    host: '0.0.0.0',
    prepareRequestFunction: async ({ request }) => {
        // SwitchyOmega（SOCKS5プロキシモード）時の処理
        for (let i = 0; i < Math.min(allNodes.length, 30); i++) {
            if (await isAlive(allNodes[i])) {
                return { upstreamProxyUrl: allNodes[i], requestHeaders: { ...request.headers, 'x-forwarded-for': undefined } };
            }
        }
        return {};
    },
});

bridge.listen(async () => {
    process.stdout.write(`[READY] Hybrid Engine for chochat\n`);

    // HTTP/HTMLの処理
    bridge.server.on('request', async (req, res) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;

        if (urlParam === "" || urlParam === "index.html") {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getDashboardHTML());
            return;
        }

        if (urlParam.startsWith('http')) {
            try {
                const targetUrl = new URL(urlParam);
                // Socket.IOのパス(/socket.io/...)はそのまま中継するためスキップ
                if (targetUrl.pathname.includes('socket.io')) return;

                const response = await axios.get(targetUrl.href, { responseType: 'text', headers: { 'User-Agent': req.headers['user-agent'] } });
                const $ = cheerio.load(response.data);
                
                // リンクとスクリプトの書き換え
                $('a, link, script, img').each((i, el) => {
                    const attr = $(el).attr('href') ? 'href' : 'src';
                    const val = $(el).attr(attr);
                    if (val && !val.startsWith('data:') && !val.startsWith('#')) {
                        try {
                            const absoluteUrl = new URL(val, targetUrl.href).href;
                            $(el).attr(attr, '/' + absoluteUrl);
                        } catch (e) {}
                    }
                });

                res.writeHead(200, { 'Content-Type': response.headers['content-type'] });
                res.end($.html());
            } catch (e) { res.end("Error: " + e.message); }
        }
    });

    // WebSocket / Socket.IO のアップグレード処理
    bridge.server.on('upgrade', (req, socket, head) => {
        const urlParam = req.url.startsWith('/') ? req.url.substring(1) : req.url;
        
        // Socket.IOリクエストをターゲットサーバーに中継
        if (urlParam.includes('socket.io') || urlParam.startsWith('http')) {
            try {
                const targetHost = urlParam.startsWith('http') ? new URL(urlParam).origin : req.headers.referer ? new URL(req.headers.referer.substring(1)).origin : null;
                if (targetHost) {
                    process.stdout.write(`[WS-UPGRADE] Routing to: ${targetHost}\n`);
                    proxy.ws(req, socket, head, { target: targetHost });
                }
            } catch (e) {
                socket.destroy();
            }
        }
    });
});

function getDashboardHTML() {
    return `
    <!DOCTYPE html>
    <html>
    <head><title>chochat Proxy</title><style>body{background:#1a1a1a;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;}input{padding:10px;width:300px;}button{padding:10px;background:#007bff;color:#fff;border:none;cursor:pointer;}</style></head>
    <body>
        <h1>chochat Proxy Node</h1>
        <input type="text" id="u" placeholder="https://chochat-url.onrender.com">
        <button onclick="location.href='/'+document.getElementById('u').value">チャットを開始</button>
    </body>
    </html>`;
}
