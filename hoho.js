// === 設定 ===
const CSV_PATH = './data/customers.csv';   // 依你的實際路徑
const REFRESH_MS = 30_000;                  // 每 30 秒檢查一次（可改）

// === 小工具 ===
const enc = new TextEncoder();
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function nfkc(s){ return s.normalize ? s.normalize('NFKC') : s; }
function normalizeStrict(s){ return nfkc(String(s||'')).replace(/\s+/g,'').toLowerCase(); }
function normalizeCanon(s){
  return nfkc(String(s||'')).toLowerCase().replace(/\s+/g,'').replace(/[^0-9a-z\u4e00-\u9fff]/g,'');
}

function buildIndexes(rows){
  const exactIndex = new Map();
  const canonIndex = new Map();
  for (const r of rows){
    const k1 = normalizeStrict(r.customer);
    const k2 = normalizeCanon(r.customer);
    if (k1) exactIndex.set(k1, r.vendor);
    if (k2 && !canonIndex.has(k2)) canonIndex.set(k2, r.vendor);
  }
  return { exactIndex, canonIndex };
}

// === 全域資料 ===
let DB = { rows: [], index: new Map() };
let INDEX = { exactIndex: new Map(), canonIndex: new Map() };
let lastHash = null;
let timer = null;

// === 解析 CSV（無表頭或有表頭都支援）===
function parseCsvToRows(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  let rows;

  if (parsed.meta.fields && parsed.meta.fields.length >= 2) {
    // 有表頭
    const nameKeys = ['customer','客戶','客戶名稱','名稱'];
    const vendorKeys = ['vendor','廠商','廠商名稱','供應商'];
    const pick = (obj, keys)=>{ for (const k of keys) if (obj[k]!=null && obj[k] !== '') return obj[k]; return ''; };
    rows = parsed.data.map(r => ({
      customer: String(pick(r, nameKeys)).trim(),
      vendor:   String(pick(r, vendorKeys)).trim()
    }));
  } else {
    // 無表頭 → 重新用 header:false 解析
    const parsed2 = Papa.parse(text, { header: false, skipEmptyLines: true });
    rows = parsed2.data.map(arr => ({
      customer: String(arr[0] ?? '').trim(),
      vendor:   String(arr[1] ?? '').trim()
    }));
    // 丟掉可能的表頭列
    const h0 = rows[0]?.customer?.toLowerCase?.() || '';
    const h1 = rows[0]?.vendor?.toLowerCase?.() || '';
    const isHeader = (['customer','客戶','客戶名稱'].includes(h0)) &&
                     (['vendor','廠商','廠商名稱','供應商'].includes(h1));
    if (isHeader) rows = rows.slice(1);
  }

  return rows.filter(r => r.customer || r.vendor);
}

// === 抓取 & 若變更則更新 ===
async function refreshDataIfChanged() {
  const url = `${CSV_PATH}?v=${Date.now()}`; // 版本參數避免快取
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`載入失敗：${res.status} ${res.statusText}`);
  const text = await res.text();

  // 若仍有亂碼疑慮，可加上 Big5 fallback（前面教過），此處略

  const hash = await sha256(text);
  if (hash === lastHash) return false;  // 沒改變

  // 有改變 → 解析、重建索引
  const rows = parseCsvToRows(text);
  DB.rows = rows;
  INDEX = buildIndexes(rows);
  lastHash = hash;

  // 若你有「全部資料列表」或「即時篩選」要更新，這裡呼叫重繪
  if (typeof renderTable === 'function') renderTable(rows);

  // 若搜尋框有值，更新查詢結果
  const inp = document.getElementById('q');
  if (inp && inp.value.trim() && typeof runSearch === 'function') runSearch();

  // 顯示最後更新時間（可選）
  const stamp = document.getElementById('lastUpdate');
  if (stamp) stamp.textContent = new Date().toLocaleString();

  return true;
}

// === 啟動輪詢 ===
function startPolling() {
  stopPolling();
  timer = setInterval(async () => {
    try { await refreshDataIfChanged(); }
    catch (e) { console.warn('更新失敗：', e.message); }
  }, REFRESH_MS);
}
function stopPolling() { if (timer) clearInterval(timer); timer = null; }

// 頁面可見性：離開分頁就暫停，回來就立刻同步一次
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { stopPolling(); }
  else {
    try { await refreshDataIfChanged(); } catch(e){ console.warn(e); }
    startPolling();
  }
});

// === 初始啟動 ===
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await refreshDataIfChanged(); // 先抓一次
    startPolling();               // 開始輪詢
  } catch (e) {
    alert('首次載入失敗：' + e.message);
  }
});

// === 你的搜尋（示例） ===
function findVendor(q){
  const input = String(q||'').trim();
  if (!input) return [];
  const exact = INDEX.exactIndex.get(normalizeStrict(input)) ||
                INDEX.canonIndex.get(normalizeCanon(input));
  if (exact) return [{ customer: input, vendor: exact, exact: true }];

  const q1 = input.toLowerCase();
  const q2 = normalizeCanon(input);
  return DB.rows.filter(r =>
    r.customer.toLowerCase().includes(q1) ||
    normalizeCanon(r.customer).includes(q2)
  ).map(r => ({ ...r, exact:false }));
}

function runSearch(){
  const q = document.getElementById('q')?.value || '';
  const box = document.getElementById('result');
  const res = findVendor(q);
  if (!box) return;
  if (!q.trim()) { box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='block';
  if (res.length===0) { box.innerHTML = `找不到 <code>${q}</code> 的對應廠商`; return; }
  if (res[0].exact) { box.innerHTML = `<strong>精準</strong>：<code>${q}</code> → <b>${res[0].vendor}</b>`; }
  else {
    box.innerHTML = `提供 ${res.length} 筆模糊結果：<ul>` +
      res.map(r => `<li><code>${r.customer}</code> → <b>${r.vendor}</b></li>`).join('') +
      `</ul>`;
  }
}
