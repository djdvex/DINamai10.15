export default function TestPage() {
  async function send() {
    const message = document.getElementById('msg').value;
    const userId = document.getElementById('uid').value;
    const out = document.getElementById('out');
    out.textContent = 'Loading...';

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ message, userId }),
    });

    const j = await r.json();
    out.textContent = JSON.stringify(j, null, 2);
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h2>Test /api/chat</h2>
      <textarea id="msg" rows="4" cols="50" defaultValue="Hello test!" /><br />
      <input id="uid" placeholder="userId" defaultValue="demo123" />
      <button onClick={send}>Send</button>
      <pre id="out" style={{ marginTop: '1rem', background: '#f5f5f5', padding: '1rem' }}></pre>
    </div>
  );
}
