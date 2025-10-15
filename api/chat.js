// api/chat.js
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // turi būti į Vercel
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'chat-bison-001'; // pakeisk, jei reikia

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function decrement(userId){
  try{
    const { data } = await supabaseAdmin
      .from('user_quotas')
      .select('remaining_messages')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if(!data){
      await supabaseAdmin.from('user_quotas').insert({ user_id: userId, remaining_messages: 20 });
      return {ok:true, remaining:20};
    }
    if(data.remaining_messages <= 0) return {ok:false, remaining:0};
    const { data: d2 } = await supabaseAdmin
      .from('user_quotas')
      .update({ remaining_messages: data.remaining_messages - 1, updated_at: new Date() })
      .eq('user_id', userId)
      .select('remaining_messages')
      .single();
    return { ok:true, remaining: d2.remaining_messages };
  }catch(e){
    console.error('quota error', e);
    return {ok:false, remaining:0};
  }
}

module.exports = async (req, res) => {
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, userId } = req.body;
  if(!message) return res.status(400).json({ error: 'Missing message' });
  if(!userId) return res.status(400).json({ error: 'Missing userId' });

  // quota
  const q = await decrement(userId);
  if(!q.ok) return res.status(402).json({ error: 'No quota remaining' });

  // Validate Gemini API key present
  if(!GEMINI_API_KEY){
    console.error('GEMINI_API_KEY missing in env');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try{
    // Build Gemini endpoint - v1beta2 generateMessage style
    const endpoint = `https://generativelanguage.googleapis.com/v1beta2/models/${encodeURIComponent(GEMINI_MODEL)}:generateMessage?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const payload = {
      prompt: {
        // messages array emuliuoja chat flow — Gemini expects messages in prompt.messages
        messages: [
          { role: 'system', content: 'You are DI Namams — a helpful Lithuanian home assistant.' },
          { role: 'user', content: message }
        ]
      },
      // optional params:
      temperature: 0.2,
      maxOutputTokens: 800
    };

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      // small timeout not included; rely on platform timeout defaults
    });

    // If non-200, capture body for logs
    if(!r.ok){
      const txt = await r.text();
      console.error('Gemini error', r.status, txt);
      return res.status(502).json({ error: 'Model provider error', detail: txt });
    }

    const j = await r.json();
    // Gemini response shape: candidates or content in reply; handle common shapes
    // Try to extract text from known fields
    let text = 'No response';
    if(j?.candidates && j.candidates[0]?.content) {
      text = j.candidates[0].content;
    } else if(j?.output && j.output[0]?.content) {
      // some shapes: output -> [{content: [{text: "..."}]}]
      const out = j.output[0];
      if(out && Array.isArray(out.content)) {
        text = out.content.map(c=>c.text || c).join('\n').trim();
      }
    } else if(j?.response) {
      text = j.response;
    } else {
      // Fallback: stringify for debugging
      text = JSON.stringify(j).slice(0, 2000);
    }

    return res.status(200).json({ text, remaining: q.remaining });
  }catch(e){
    console.error('chat handler error', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
