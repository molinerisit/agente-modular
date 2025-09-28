async function loadAll(){
  const bot_id = document.getElementById('bot_id').value;
  const r = await fetch('/api/config?bot_id='+encodeURIComponent(bot_id)); const j = await r.json();
  if(j.ok) document.getElementById('botcfg').textContent = JSON.stringify(j.config, null, 2);
  const rr = await fetch('/api/rules?bot_id='+encodeURIComponent(bot_id)); document.getElementById('brules').textContent = JSON.stringify(await rr.json(), null, 2);
  const p = await fetch('/api/products?bot_id='+encodeURIComponent(bot_id)); document.getElementById('prods').textContent = JSON.stringify(await p.json(), null, 2);
  const a = await fetch('/api/appointments?bot_id='+encodeURIComponent(bot_id)); document.getElementById('appts').textContent = JSON.stringify(await a.json(), null, 2);
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('load').addEventListener('click', loadAll);
});
