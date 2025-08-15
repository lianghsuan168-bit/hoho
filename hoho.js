const CSV_PATH = './data/customers.csv';

let rows = [];               // 原始資料：[{customer, vendor}, ...]
let customerMap = new Map(); // 精準查詢：customer(lower) -> vendor

async function loadCSV() {
  const resp = await fetch(CSV_PATH, { cache: "no-store" }); // 確保更新後能抓到新檔
  const text = await resp.text();

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  rows = parsed.data
    .map(r => ({
      customer: (r.customer ?? '').trim(),
      vendor:   (r.vendor ?? '').trim()
    }))
    .filter(r => r.customer || r.vendor);

  // 建立精準查表（忽略大小寫與全形空白）
  customerMap.clear();
  for (const r of rows) {
    const key = normalize(r.customer);
    if (key) customerMap.set(key, r.vendor);
  }

  renderTable(rows);
}

function normalize(s) {
  return (s || '')
    .replace(/\s+/g, '')      // 去掉所有空白
    .toLowerCase();           // 忽略大小寫（英文情境）
}

function renderTable(data) {
  const tbody = document.querySelector('#table tbody');
  tbody.innerHTML = '';
  for (const r of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHTML(r.customer)}</td><td>${escapeHTML(r.vendor)}</td>`;
    tbody.appendChild(tr);
  }
}

function escapeHTML(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function search() {
  const q = document.getElementById('q').value.trim();
  const box = document.getElementById('result');

  if (!q) {
    box.style.display = 'none';
    box.textContent = '';
    return;
  }

  // 1) 先做精準查詢（忽略空白/大小寫）
  const exact = customerMap.get(normalize(q));
  if (exact) {
    box.style.display = 'block';
    box.innerHTML = `<strong>精準匹配</strong>：<code>${escapeHTML(q)}</code> → <b>${escapeHTML(exact)}</b>`;
    return;
  }

  // 2) 沒命中就做模糊（包含）
  const qLower = q.toLowerCase();
  const matches = rows.filter(r =>
    r.customer.toLowerCase().includes(qLower)
  );

  box.style.display = 'block';
  if (matches.length === 0) {
    box.innerHTML = `找不到 <code>${escapeHTML(q)}</code> 的對應廠商。`;
  } else {
    const lis = matches
      .map(r => `<li><code>${escapeHTML(r.customer)}</code> → <b>${escapeHTML(r.vendor)}</b></li>`)
      .join('');
    box.innerHTML = `<div>未精準命中，提供 <b>${matches.length}</b> 筆模糊結果：</div><ul>${lis}</ul>`;
  }
}

function setupFilter() {
  const filter = document.getElementById('filter');
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return renderTable(rows);
    const filtered = rows.filter(r =>
      r.customer.toLowerCase().includes(q) ||
      r.vendor.toLowerCase().includes(q)
    );
    renderTable(filtered);
  });
}

document.getElementById('searchBtn').addEventListener('click', search);
document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

setupFilter();
loadCSV();