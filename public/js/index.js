async function loadMode() {
  const bot_id = document.getElementById('bot_id').value;
  const r = await fetch('/api/config?bot_id=' + encodeURIComponent(bot_id));
  const j = await r.json();
  if (j.ok) document.getElementById('mode').textContent = j.config.mode;
}
function append(t, cls){
  const d = document.getElementById('chat');
  const p = document.createElement('div');
  p.textContent = t;
  if(cls==='user') p.style.fontWeight='600';
  d.appendChild(p); d.scrollTop = d.scrollHeight;
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('send').addEventListener('click', async ()=>{
    const bot_id = document.getElementById('bot_id').value;
    const text = document.getElementById('msg').value.trim(); if(!text) return;
    append('Tú: ' + text, 'user'); document.getElementById('msg').value='';
    const res = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ bot_id, message: text })
    });
    const j = await res.json();
    if (j.ok) append('Bot: ' + j.reply); else append('Error: ' + (j.error||''));
  });
  document.getElementById('bot_id').addEventListener('change', loadMode);
  loadMode();
});
