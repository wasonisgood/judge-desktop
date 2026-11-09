// 地圖內附資料與授權聲明的測試：界線檔形狀、涵蓋的縣市與對照表一致、授權標示存在、讀取器拒絕錯誤格式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
const require = createRequire(import.meta.url);
const core = require('@judge/core');
const { loadGeoData } = require('../dist/main/services/chartData.js');

const MODULE_DIR = path.resolve(import.meta.dirname, '../modules/chart');
const GEO_FILE = path.join(MODULE_DIR, 'tw-counties.json');

test('內附授權聲明檔存在，且含 OpenStreetMap 標示與 ODbL 授權', async () => {
  const txt = await fs.readFile(path.join(MODULE_DIR, 'LICENSE-OSM.txt'), 'utf8');
  assert.ok(txt.includes('© OpenStreetMap contributors'));
  assert.ok(txt.includes('ODbL'));
  assert.ok(txt.includes('opendatacommons.org/licenses/odbl/1-0'));
  assert.ok(txt.includes('法院組織法'), '對照來源需寫明');
});

test('界線檔讀取：形狀正確、22 個縣市、附 OSM 標示', async () => {
  const geo = await loadGeoData(GEO_FILE);
  assert.equal(geo.counties.length, 22);
  assert.equal(geo.viewBox.length, 4);
  assert.ok(geo.attribution.includes('OpenStreetMap'));
  for (const c of geo.counties) {
    assert.ok(c.d.startsWith('M'), c.name);
    assert.ok(c.d.endsWith('Z'), c.name);
    assert.ok(c.cx >= geo.viewBox[0] && c.cx <= geo.viewBox[0] + geo.viewBox[2], c.name);
    assert.ok(c.cy >= geo.viewBox[1] && c.cy <= geo.viewBox[1] + geo.viewBox[3], c.name);
  }
});

test('界線檔的縣市與對照表的縣市完全一致（不多、不少）', async () => {
  const geo = await loadGeoData(GEO_FILE);
  const fromFile = geo.counties.map((c) => c.name).sort();
  const fromMap = core.allCountiesInMap().slice().sort();
  assert.deepEqual(fromFile, fromMap);
});

test('界線檔讀取：缺少 OpenStreetMap 標示或縣市為空 → 拒絕', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geo-test-'));
  try {
    const good = JSON.parse(await fs.readFile(GEO_FILE, 'utf8'));
    const noAttr = path.join(dir, 'noattr.json');
    await fs.writeFile(noAttr, JSON.stringify({ ...good, attribution: 'anonymous' }));
    await assert.rejects(loadGeoData(noAttr), /OpenStreetMap/);
    const empty = path.join(dir, 'empty.json');
    await fs.writeFile(empty, JSON.stringify({ ...good, counties: [] }));
    await assert.rejects(loadGeoData(empty), /沒有縣市/);
    const badPath = path.join(dir, 'badpath.json');
    await fs.writeFile(badPath, JSON.stringify({ ...good, counties: [{ name: 'x', d: 'L1 1', cx: 0, cy: 0 }] }));
    await assert.rejects(loadGeoData(badPath), /格式錯誤/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('界線檔大小合理（模組內附，單檔不超過 1 MB）', async () => {
  const st = await fs.stat(GEO_FILE);
  assert.ok(st.size < 1024 * 1024, `size ${st.size}`);
});
