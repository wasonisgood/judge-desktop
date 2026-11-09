// 登入端到端測試（手動執行：npx electron scripts/auth-e2e.cjs；需先 npm run build）。
// 登入端到端測試：真的 Electron 主程序 + 真的本機回呼 + 真的瀏覽器重新導向 + 真的 PKCE 換 token。
// 授權伺服器為本機假伺服器（模擬 judge-remote-mcp 的 /oauth/register、/oauth/authorize、/oauth/token）。
// userData 指向暫存資料夾，不碰使用者的真實資料。
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');

const AUTH_PORT = 53999;
process.env.JUDGE_AUTH_BASE = `http://127.0.0.1:${AUTH_PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-auth-e2e-'));
app.setPath('userData', tmp);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + String(detail).slice(0, 160) + ']' : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- 假授權伺服器 ----
const seen = { challenge: null, redirectUri: null, state: null, tokenCalls: 0, refreshCalls: 0 };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${AUTH_PORT}`);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (u.pathname === '/oauth/register' && req.method === 'POST') {
      const j = JSON.parse(body || '{}');
      seen.registered = j;
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ client_id: 'jmc_e2e', redirect_uris: j.redirect_uris, token_endpoint_auth_method: 'none' }));
    }
    if (u.pathname === '/oauth/authorize' && req.method === 'GET') {
      seen.challenge = u.searchParams.get('code_challenge');
      seen.redirectUri = u.searchParams.get('redirect_uri');
      seen.state = u.searchParams.get('state');
      seen.method = u.searchParams.get('code_challenge_method');
      seen.clientId = u.searchParams.get('client_id');
      // 模擬「已登入」：直接導回本機回呼，附上授權碼與原樣的 state。
      res.writeHead(302, { location: `${seen.redirectUri}?code=E2E_CODE&state=${encodeURIComponent(seen.state)}` });
      return res.end();
    }
    if (u.pathname === '/oauth/token' && req.method === 'POST') {
      const f = new URLSearchParams(body);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (f.get('grant_type') === 'authorization_code') {
        seen.tokenCalls++;
        const verifier = f.get('code_verifier') || '';
        const ok = f.get('code') === 'E2E_CODE' && f.get('client_id') === 'jmc_e2e' && f.get('redirect_uri') === seen.redirectUri
          && b64u(createHash('sha256').update(verifier, 'ascii').digest()) === seen.challenge;
        if (!ok) return json(400, { error: 'invalid_grant', error_description: 'PKCE 或授權碼不符' });
        return json(200, { access_token: 'jma_e2e', token_type: 'Bearer', expires_in: 3600, refresh_token: 'jmr_e2e', scope: 'mcp' });
      }
      if (f.get('grant_type') === 'refresh_token') {
        seen.refreshCalls++;
        return json(200, { access_token: 'jma_e2e_2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'jmr_e2e_2', scope: 'mcp' });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    res.writeHead(404); res.end();
  });
});

const mainPath = path.resolve(__dirname, '..', 'dist', 'main', 'main.js');
server.listen(AUTH_PORT, '127.0.0.1', () => {
  require(mainPath);
  app.whenReady().then(async () => {
    try {
      let win = null;
      for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html') && !w.webContents.isLoading()); if (!win) await wait(150); }
      if (!win) throw new Error('主視窗沒有載入');
      await wait(800);
      const js = (c) => win.webContents.executeJavaScript(c);

      const gateShown = await js(`!document.getElementById('authGate').hidden`);
      check('未登入時顯示登入閘門', gateShown === true, gateShown);

      const st0 = await js(`window.api.auth.status()`);
      check('啟動時狀態為未登入', st0.signedIn === false, JSON.stringify(st0));

      // 以真的按鈕操作：按下「開啟瀏覽器登入」，等待閘門隱藏（控制器在成功後才隱藏）。
      await js(`document.getElementById('authStart').click()`);
      let hidden = false;
      for (let i = 0; i < 300 && !hidden; i++) { hidden = await js(`document.getElementById('authGate').hidden`); if (!hidden) await wait(200); }
      const st1 = await js(`window.api.auth.status()`);
      check('登入流程完成（按鈕→瀏覽器→回呼→換 token）', st1.signedIn === true && hidden === true, JSON.stringify(st1));
      check('註冊用戶端時送出本機回呼 redirect_uri', seen.registered?.redirect_uris?.[0] === 'http://127.0.0.1:53682/callback', JSON.stringify(seen.registered?.redirect_uris));
      check('授權網址使用 PKCE S256', seen.method === 'S256' && !!seen.challenge, seen.method);
      check('換 token 時 code_verifier 與 challenge 相符（伺服器已驗證）', seen.tokenCalls === 1, `tokenCalls=${seen.tokenCalls}`);
      const gateAfter = await js(`document.getElementById('authGate').hidden`);
      check('登入後閘門隱藏', gateAfter === true, gateAfter);

      const st2 = await js(`window.api.auth.status()`);
      check('登入狀態持久（未過期，不呼叫更新）', st2.signedIn === true && seen.refreshCalls === 0, JSON.stringify(st2));

      const enc = fs.readFileSync(path.join(tmp, 'auth-session.json'), 'utf8');
      check('權杖在磁碟上為加密內容（不含明文）', !enc.includes('jma_e2e') && enc.includes('"enc"'), enc.slice(0, 60));

      await js(`window.api.auth.signOut()`);
      const st3 = await js(`window.api.auth.status()`);
      check('登出後回到未登入', st3.signedIn === false, JSON.stringify(st3));
    } catch (err) {
      check('測試過程未發生例外', false, err && err.stack ? err.stack.split('\n')[0] : err);
    } finally {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n共 ${results.length} 項，通過 ${results.length - failed}，失敗 ${failed}`);
      fs.writeFileSync(path.join(tmp, '..', 'judge-auth-e2e-result.json'), JSON.stringify(results, null, 2));
      server.close();
      app.exit(failed ? 1 : 0);
    }
  });
});
