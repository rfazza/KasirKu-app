/* app.js
   - Offline-first POS (localStorage)
   - Optional Supabase sync (fill SUPABASE_URL & SUPABASE_ANON_KEY)
   - Simple auth (email/password) via Supabase
*/

// ====== CONFIG: fill when ready (or leave empty to run local-only) ======
const CFG = {
  SUPABASE_URL: '',               // e.g. https://xyzcompany.supabase.co
  SUPABASE_ANON_KEY: ''           // anon/public key
}
// ======================================================================

// localStorage keys
const LS_PRODUCTS = 'pos_products_v1'
const LS_TXNS = 'pos_transactions_v1'
const LS_CART = 'pos_cart_v1'
const LS_USER = 'pos_user_v1'

// helpers
const money = n => 'Rp ' + Number(n||0).toLocaleString('id-ID')
const uid = ()=> Date.now().toString(36) + Math.random().toString(36).slice(2,7)
function load(key, fallback){
  try{ const raw = localStorage.getItem(key); if(!raw) return fallback; return JSON.parse(raw) }catch(e){ console.error('ls parse',e); return fallback }
}
function save(key, data){ try{ localStorage.setItem(key, JSON.stringify(data)) }catch(e){ console.error('ls save',e)}}
function escapeHtml(s){ return String(s||'').replace(/[&<>"'`]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[ch])) }

// state
let products = []
let txns = []
let cart = {}
let supabase = null
let user = load(LS_USER, null)

// init supabase if keys present
if(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase){
  try{
    supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
    console.log('Supabase client initialized')
  }catch(e){ console.warn('Failed init supabase', e); supabase = null }
}

// seed local products if empty
function seedIfEmpty(){
  let p = load(LS_PRODUCTS, [])
  if(!p || p.length===0){
    p = [
      {id:uid(), name:'Nasi Goreng', price:25000, sku:'NG-001', stock:20},
      {id:uid(), name:'Es Teh', price:5000, sku:'ET-001', stock:50},
      {id:uid(), name:'Kopi Hitam', price:12000, sku:'KH-001', stock:30}
    ]
    save(LS_PRODUCTS,p)
  }
}

function loadState(){
  products = load(LS_PRODUCTS, []) || []
  txns = load(LS_TXNS, []) || []
  cart = load(LS_CART, {}) || {}
  user = load(LS_USER, null)
}

// renderers
function renderProducts(q=''){
  const list = document.getElementById('product-list'); if(!list) return; list.innerHTML=''
  const term = (q||'').trim().toLowerCase()
  const filtered = (products||[]).filter(p => (p.name||'').toLowerCase().includes(term) || (p.sku||'').toLowerCase().includes(term))
  if(filtered.length===0){ list.innerHTML = '<div class="muted">Tidak ada produk</div>'; return }
  filtered.forEach(p=>{
    const el = document.createElement('div'); el.className='product'
    el.innerHTML = `<div><div class="name">${escapeHtml(p.name)}</div><div class="price">${money(p.price)}</div></div>`
    const meta = document.createElement('div'); meta.className='meta'
    const sku = document.createElement('div'); sku.className='muted'; sku.textContent = 'SKU: ' + (p.sku||'-')
    const stok = document.createElement('div'); stok.className='muted'; stok.textContent = 'Stok: ' + (p.stock!=null?String(p.stock):'-')
    const actions = document.createElement('div'); actions.style.marginLeft='auto'; actions.style.display='flex'; actions.style.gap='6px'
    const btnAdd = document.createElement('button'); btnAdd.className='btn small'; btnAdd.textContent='Tambah'; btnAdd.onclick = ()=> addToCart(p.id)
    const btnEdit = document.createElement('button'); btnEdit.className='btn small secondary'; btnEdit.textContent='Edit'; btnEdit.onclick = ()=> openEditProduct(p.id)
    const btnDel = document.createElement('button'); btnDel.className='btn small'; btnDel.style.background='rgba(255,255,255,0.03)'; btnDel.style.color='var(--muted)'; btnDel.textContent='Hapus'; btnDel.onclick = ()=>{ if(confirm('Hapus produk?')) deleteProduct(p.id) }
    actions.appendChild(btnAdd); actions.appendChild(btnEdit); actions.appendChild(btnDel)
    meta.appendChild(sku); meta.appendChild(stok); meta.appendChild(actions)
    el.appendChild(meta)
    list.appendChild(el)
  })
}

function renderCart(){
  const el = document.getElementById('cart-items'); if(!el) return; el.innerHTML=''
  const items = Object.values(cart||{})
  if(items.length===0){ el.innerHTML = '<div class="muted">Keranjang kosong</div>' }
  let subtotal = 0, count = 0
  items.forEach(item=>{
    subtotal += (item.qty||0)*(item.price||0)
    count += (item.qty||0)
    const row = document.createElement('div'); row.className='cart-item'
    row.innerHTML = `<div>
      <div style="font-weight:600">${escapeHtml(item.name)}</div>
      <div class="muted">${money(item.price)} x ${item.qty} = ${money((item.price||0)*(item.qty||0))}</div>
    </div>`
    const qtyWrap = document.createElement('div'); qtyWrap.className='qty'
    const bDec = document.createElement('button'); bDec.className='btn small'; bDec.textContent='-'; bDec.onclick = ()=> decCart(item.id)
    const bNum = document.createElement('div'); bNum.textContent = item.qty
    const bInc = document.createElement('button'); bInc.className='btn small'; bInc.textContent='+'; bInc.onclick = ()=> incCart(item.id)
    qtyWrap.appendChild(bDec); qtyWrap.appendChild(bNum); qtyWrap.appendChild(bInc)
    row.appendChild(qtyWrap)
    el.appendChild(row)
  })
  document.getElementById('cart-subtotal').innerText = money(subtotal)
  document.getElementById('cart-count').innerText = count
  save(LS_CART, cart)
}

function renderTxns(start, end){
  const list = document.getElementById('txn-list'); if(!list) return; list.innerHTML=''
  let shown = (txns||[]).slice().reverse()
  if(start || end){
    const s = start? new Date(start+'T00:00:00'): null
    const e = end? new Date(end+'T23:59:59'): null
    shown = shown.filter(t => {
      const d = new Date(t.date)
      if(s && d < s) return false
      if(e && d > e) return false
      return true
    })
  }
  if(shown.length===0){ list.innerHTML = '<div class="muted">Belum ada transaksi</div>'; return }
  shown.forEach(t=>{
    const div = document.createElement('div'); div.className='txn'
    div.innerHTML = `<div style="display:flex;justify-content:space-between"><div><strong>${escapeHtml(t.id)}</strong><div class="muted">${new Date(t.date).toLocaleString()}</div></div><div>${money(t.total)}</div></div>`
    list.appendChild(div)
  })
}

// CRUD
function addProduct(p){ products.push(p); save(LS_PRODUCTS, products); renderProducts(document.getElementById('search')?.value||'') }
function updateProduct(id, patch){ const i = products.findIndex(x=>x.id===id); if(i>-1){ products[i] = {...products[i], ...patch}; save(LS_PRODUCTS, products); renderProducts(document.getElementById('search')?.value||'') } }
function deleteProduct(id){ products = products.filter(x=>x.id!==id); save(LS_PRODUCTS, products); renderProducts(document.getElementById('search')?.value||'') }
function openEditProduct(id){ const p = products.find(x=>x.id===id); if(!p) return; document.getElementById('prod-id').value = p.id; document.getElementById('prod-name').value = p.name; document.getElementById('prod-price').value = p.price; document.getElementById('prod-sku').value = p.sku || ''; document.getElementById('prod-stock').value = p.stock || '' }

// Cart actions
function addToCart(pid, qty=1){ const p = products.find(x=>x.id===pid); if(!p) return; const id = p.id; if(cart[id]) cart[id].qty += qty; else cart[id] = {...p, qty}; save(LS_CART, cart); renderCart(); }
function incCart(id){ if(cart[id]){ cart[id].qty+=1; save(LS_CART,cart); renderCart(); }}
function decCart(id){ if(cart[id]){ cart[id].qty-=1; if(cart[id].qty<=0) delete cart[id]; save(LS_CART,cart); renderCart(); }}
function clearCart(){ cart = {}; save(LS_CART, cart); renderCart(); }

// Checkout
function checkout(){
  const items = Object.values(cart)
  if(items.length===0){ alert('Keranjang kosong'); return }
  const total = items.reduce((s,i)=> s + (i.qty||0)*(i.price||0), 0)
  const txn = { id: 'TXN-' + new Date().toISOString().replace(/[:.]/g,''), date: new Date().toISOString(), items: items.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty})), total}
  txns.push(txn); save(LS_TXNS, txns); clearCart(); renderTxns(); openReceipt(txn)
  // if supabase client available, push txn async
  if(supabase && user){ pushTxnToSupabase(txn).catch(e=>console.warn('push txn failed',e)) }
}

// Receipt: open via blob URL (no document.write)
function openReceipt(txn){
  const itemsHtml = (txn.items||[]).map(it => `<tr><td>${escapeHtml(it.name)} x ${it.qty}</td><td style="text-align:right">${money((it.price||0)*it.qty)}</td></tr>`).join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Struk ${escapeHtml(txn.id)}</title>
    <style>body{font-family:Arial;color:#000;padding:18px}h2{margin:0 0 6px}table{width:100%;border-collapse:collapse}td{padding:6px;border-bottom:1px dashed #ddd}</style></head><body>
    <h2>Demo Store</h2>
    <div>${new Date(txn.date).toLocaleString()}</div>
    <hr>
    <table>
      ${itemsHtml}
      <tr><td style="font-weight:700">Total</td><td style="text-align:right;font-weight:700">${money(txn.total)}</td></tr>
    </table>
    <hr>
    <div style="text-align:center">Terima kasih - Demo POS</div>
    <script>window.print();</script>
    </body></html>`
  try{
    const blob = new Blob([html], {type:'text/html'})
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if(!w){
      const same = confirm('Popup diblokir. Buka struk di tab yang sama? (Iya = buka, Tidak = batalkan)')
      if(same) location.href = url
      else alert('Gagal membuka struk. Cek setting popup.')
    }
    setTimeout(()=> URL.revokeObjectURL(url), 15000)
  }catch(err){ console.error('receipt err', err); alert('Gagal membuat struk: ' + err.message) }
}

// =================== Supabase helpers (lightweight) ===================
async function pushAllToSupabase(){
  if(!supabase || !user) return
  // naive sync: push products and txns from local to supabase (insert if not exists)
  try{
    // push products
    for(const p of products){
      const {data, error} = await supabase.from('products').upsert({...p}, {onConflict: 'id'})
      if(error) console.warn('upsert product', error)
    }
    // push txns
    for(const t of txns){
      const {data, error} = await supabase.from('transactions').upsert({...t}, {onConflict: 'id'})
      if(error) console.warn('upsert txn', error)
    }
    alert('Sync selesai')
  }catch(e){ console.error('pushAll', e); alert('Sync error: '+e.message) }
}

async function pullAllFromSupabase(){
  if(!supabase || !user) return
  try{
    const {data: pdata, error: perror} = await supabase.from('products').select('*')
    if(perror) console.warn('pull products', perror)
    if(Array.isArray(pdata)) products = mergeUniqueById(products, pdata)
    const {data: tdata, error: terror} = await supabase.from('transactions').select('*')
    if(terror) console.warn('pull txns', terror)
    if(Array.isArray(tdata)) txns = mergeUniqueById(txns, tdata)
    save(LS_PRODUCTS, products); save(LS_TXNS, txns); renderProducts(); renderTxns()
  }catch(e){ console.error('pullAll', e) }
}

async function pushTxnToSupabase(txn){
  if(!supabase || !user) return
  try{
    const {error} = await supabase.from('transactions').insert([txn])
    if(error) console.warn('push txn', error)
  }catch(e){ console.error('pushTxn', e) }
}

function mergeUniqueById(localArr, remoteArr){
  // ensure no duplicate ids, prefer remote when id matches
  const map = {}
  localArr.forEach(x=> map[x.id] = x)
  remoteArr.forEach(x=> map[x.id] = x)
  return Object.values(map)
}

// =================== Auth (Supabase) UI ===================
async function showLoginDialog(){
  const email = prompt('Email (untuk demo: gunakan email valid):')
  if(!email) return
  const pass = prompt('Password (min 6 untuk signup):')
  if(!pass) return
  if(!supabase){
    alert('Supabase belum di-config. Masih bisa pakai offline.')
    return
  }
  // try sign in, if fails try sign up
  try{
    const {data: sdata, error: sinErr} = await supabase.auth.signInWithPassword({email, password: pass})
    if(sinErr){
      // try signup
      const {data: rdata, error: rerr} = await supabase.auth.signUp({email, password: pass})
      if(rerr){ alert('Auth error: ' + rerr.message); return }
      alert('Akun dibuat. Cek email jika perlu konfirmasi. Silakan login lagi.')
      return
    }
    user = sdata.user
    save(LS_USER, user)
    updateAuthUI()
    alert('Login sukses: ' + (user.email||''))
    // pull/push basic sync after login
    await pullAllFromSupabase()
    await pushAllToSupabase()
  }catch(e){ console.error('auth err',e); alert('Auth failed: '+e.message) }
}

function signOut(){
  if(supabase){
    supabase.auth.signOut().catch(()=>{})
  }
  user = null; localStorage.removeItem(LS_USER); updateAuthUI()
}

function updateAuthUI(){
  const userMeta = document.getElementById('user-meta'); const modePill = document.getElementById('mode-pill')
  if(user){
    userMeta.innerText = 'Login: ' + (user.email||'(user)')
    document.getElementById('btn-login').style.display = 'none'
    document.getElementById('btn-logout').style.display = 'inline-block'
    modePill.innerText = supabase? 'Online (Supabase connected)': 'Local (no supabase)'
  }else{
    userMeta.innerText = 'Mode: Offline'
    document.getElementById('btn-login').style.display = 'inline-block'
    document.getElementById('btn-logout').style.display = 'none'
    modePill.innerText = 'Offline'
  }
}

// =================== Import / Export ===================
function exportData(){
  const payload = {products, txns}
  try{
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'pos-data.json'; a.click(); URL.revokeObjectURL(url)
  }catch(e){ alert('Export failed: '+e.message) }
}
function importDataFile(file){
  const r = new FileReader(); r.onload = ()=>{
    try{ const data = JSON.parse(r.result); if(Array.isArray(data.products)) products = data.products; if(Array.isArray(data.txns)) txns = data.txns; save(LS_PRODUCTS, products); save(LS_TXNS, txns); renderProducts(); renderTxns(); alert('Import sukses') }catch(e){ alert('Import error: '+e.message) }
  }; r.readAsText(file)
}

// =================== Init + Events ===================
document.addEventListener('DOMContentLoaded', ()=>{
  seedIfEmpty(); loadState(); renderProducts(); renderCart(); renderTxns(); updateAuthUI()

  document.getElementById('open-add')?.addEventListener('click', ()=>{
    document.getElementById('prod-id').value=''; document.getElementById('prod-name').value=''; document.getElementById('prod-price').value=''; document.getElementById('prod-sku').value=''; document.getElementById('prod-stock').value=''
  })

  document.getElementById('product-form')?.addEventListener('submit', e=>{
    e.preventDefault()
    const id = document.getElementById('prod-id').value || uid()
    const name = document.getElementById('prod-name').value.trim()
    const price = Number(document.getElementById('prod-price').value) || 0
    const sku = document.getElementById('prod-sku').value.trim()
    const stock = document.getElementById('prod-stock').value ? Number(document.getElementById('prod-stock').value) : null
    if(!name || !price){ alert('Nama & harga wajib'); return }
    const obj = {id, name, price, sku, stock}
    if(products.find(p=>p.id===id)) updateProduct(id, obj); else addProduct(obj)
    document.getElementById('product-form').reset()
  })

  document.getElementById('cancel-edit')?.addEventListener('click', ()=> document.getElementById('product-form').reset())
  document.getElementById('checkout')?.addEventListener('click', ()=> { if(confirm('Proses pembayaran?')) checkout() })
  document.getElementById('clear-cart')?.addEventListener('click', ()=> { if(confirm('Kosongkan keranjang?')) clearCart() })
  document.getElementById('add-sample')?.addEventListener('click', ()=>{
    const p = {id:uid(), name:'Menu Baru '+Math.floor(Math.random()*90+10), price:Math.floor(Math.random()*30000)+2000, sku:'SMP-'+Math.floor(Math.random()*999), stock:10}
    addProduct(p)
  })
  document.getElementById('search')?.addEventListener('input', e=> renderProducts(e.target.value))
  document.getElementById('filter-now')?.addEventListener('click', ()=> renderTxns(document.getElementById('filter-start')?.value, document.getElementById('filter-end')?.value))
  document.getElementById('clear-filter')?.addEventListener('click', ()=> { if(document.getElementById('filter-start')) document.getElementById('filter-start').value=''; if(document.getElementById('filter-end')) document.getElementById('filter-end').value=''; renderTxns() })

  document.getElementById('btn-login')?.addEventListener('click', showLoginDialog)
  document.getElementById('btn-logout')?.addEventListener('click', ()=> { if(confirm('Logout?')) signOut() })
  document.getElementById('btn-export')?.addEventListener('click', exportData)
  document.getElementById('btn-import')?.addEventListener('click', ()=> document.getElementById('f-import').click())
  document.getElementById('f-import')?.addEventListener('change', e=> { const f = e.target.files[0]; if(f) importDataFile(f) })

  document.getElementById('btn-sync')?.addEventListener('click', async ()=>{
    if(!supabase){ alert('Supabase tidak dikonfigurasi. Untuk sync, isi SUPABASE_URL & SUPABASE_ANON_KEY di app.js'); return }
    if(!user){ if(confirm('Belum login. Login dulu?')) showLoginDialog(); return }
    document.getElementById('mode-pill').innerText = 'Syncing...'
    await pullAllFromSupabase()
    await pushAllToSupabase()
    document.getElementById('mode-pill').innerText = 'Synced'
    setTimeout(()=> { if(!user) document.getElementById('mode-pill').innerText='Offline'; else document.getElementById('mode-pill').innerText='Online' }, 1200)
  })

})
