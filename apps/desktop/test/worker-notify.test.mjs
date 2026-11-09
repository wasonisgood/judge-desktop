// v3.9.0 背景工人通知：通知內容組裝、跨平台通道選擇、是否通知的判斷。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const n = require('../dist/main/services/workerNotify.js');

const base = { label: '範圍整理：民法第 184 條', page: 'scope', summary: '', error: null, attention: false };

test('完成：標題、工作名稱、摘要與點擊頁面都在內容中', () => {
  const notice = n.buildNotice({ ...base, status: 'done', summary: '共 12 件判決，3 件需要複核' });
  assert.equal(notice.kind, 'done');
  assert.equal(notice.status, '已完成');
  assert.equal(notice.title, '司法院裁判研究');
  assert.equal(notice.heading, '範圍整理：民法第 184 條');
  assert.equal(notice.body, '共 12 件判決，3 件需要複核');
  assert.equal(notice.page, 'scope');
});

test('完成但需要確認：種類為 attention，內容提示回來確認', () => {
  const notice = n.buildNotice({ ...base, status: 'done', attention: true, summary: '法名有兩個候選' });
  assert.equal(notice.kind, 'attention');
  assert.equal(notice.status, '需要你確認');
  assert.equal(notice.body, '法名有兩個候選');
});

test('失敗、取消、中斷各有對應的狀態文字與說明', () => {
  assert.deepEqual(
    [n.buildNotice({ ...base, status: 'failed', error: '連線逾時' })].map((x) => [x.kind, x.status, x.body]),
    [['failed', '失敗', '連線逾時']],
  );
  assert.equal(n.buildNotice({ ...base, status: 'cancelled' }).status, '已取消');
  const interrupted = n.buildNotice({ ...base, status: 'interrupted' });
  assert.equal(interrupted.kind, 'interrupted');
  assert.match(interrupted.body, /續跑/);
});

test('內容會壓成單行並截短，避免撐破通知版面', () => {
  const long = `第一行\n\n第二行   ${'很長的摘要'.repeat(60)}`;
  const notice = n.buildNotice({ ...base, status: 'done', summary: long });
  assert.ok(!notice.body.includes('\n'));
  assert.ok(notice.body.length <= n.NOTICE_BODY_MAX);
  assert.ok(notice.body.endsWith('…'));
  assert.ok(n.buildNotice({ ...base, label: 'x'.repeat(200), status: 'done' }).heading.length <= 80);
});

test('沒有摘要或錯誤時仍有合理的預設文字', () => {
  assert.equal(n.buildNotice({ ...base, status: 'done' }).body, '工作已完成。');
  assert.equal(n.buildNotice({ ...base, status: 'failed', error: null }).body, '工作失敗，請重試。');
});

test('排隊與執行中不算終止狀態，不需要通知', () => {
  assert.equal(n.isNotifiableStatus('queued'), false);
  assert.equal(n.isNotifiableStatus('running'), false);
  for (const s of ['done', 'failed', 'cancelled', 'interrupted']) assert.equal(n.isNotifiableStatus(s), true);
});

test('通道選擇：關閉通知時一律不通知', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(n.chooseChannel({ platform, enabled: false, style: 'custom', systemSupported: true }).channel, 'none');
    assert.equal(n.chooseChannel({ platform, enabled: false, style: 'system', systemSupported: true }).channel, 'none');
  }
});

test('通道選擇：自訂樣式在各平台都用自訂視窗', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(n.chooseChannel({ platform, enabled: true, style: 'custom', systemSupported: true }).channel, 'custom');
  }
});

test('通道選擇：系統樣式在 Windows 與 macOS 用系統通知；Linux 與不可用時改用自訂視窗', () => {
  assert.equal(n.chooseChannel({ platform: 'win32', enabled: true, style: 'system', systemSupported: true }).channel, 'system');
  assert.equal(n.chooseChannel({ platform: 'darwin', enabled: true, style: 'system', systemSupported: true }).channel, 'system');
  assert.equal(n.chooseChannel({ platform: 'linux', enabled: true, style: 'system', systemSupported: true }).channel, 'custom');
  assert.equal(n.chooseChannel({ platform: 'win32', enabled: true, style: 'system', systemSupported: false }).channel, 'custom');
  assert.match(n.chooseChannel({ platform: 'linux', enabled: true, style: 'system', systemSupported: true }).reason, /Linux/);
});

test('是否通知：主視窗可見時不另外通知，隱藏時才通知', () => {
  assert.equal(n.shouldNotify({ windowVisible: true }), false);
  assert.equal(n.shouldNotify({ windowVisible: false }), true);
});

test('點擊通知的頁面：既有工作種類對應到正確頁面，未知頁面一律回到首頁', () => {
  assert.equal(n.pageForJobKind('scope'), 'scope');
  assert.equal(n.pageForJobKind('search'), 'list');
  assert.equal(n.pageForJobKind('brief'), 'brief');
  assert.equal(n.pageForJobKind('install'), 'settings');
  assert.equal(n.pageForJobKind('unknown-kind'), 'home');
  assert.equal(n.safePage('files'), 'files');
  assert.equal(n.safePage('javascript:alert(1)'), 'home');
});
