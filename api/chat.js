const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function decrement(userId) {
  try {
    const { data } = await supabaseAdmin
      .from('user_quotas')
      .select('remaining_messages')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!data) {
      await supabaseAdmin
        .from('user_quotas')
        .insert({ user_id: userId, remaining_messages: 20 });
      return { ok: true, remaining: 20 };
    }

    if (data.remaining_messages <= 0)
      return { ok: false, remaining: 0 };

    const { data: d2 } = await supabaseAdmin
      .from('user_quotas')
      .update({ remaining_messages: data.remaining_messages - 1 })
      .eq('user_id', userId)
      .select('remaining_messages')
      .single();

    return { ok: true, remaining: d2.remaining_messages };
  } catch (e) {
    console.error('Supabase decrement error:', e);
    return { ok: false, remaining: 0 };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, userId } = req.body;

  if (!message) return res.status(400).json({ error: 'missing message' });
  if (!userId) return res.status(400).json({ error: 'missing userId' });

  const q = await decrement(userId);
  if (!q.ok) return res.status(403).json({ error: 'no quota' });

  try {
    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are DI Namams assistant.' },
        { role: 'user', content: message },
      ],
      max_tokens: 800,
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || 'Error';

    return res.status(200).json({ text, remaining: q.remaining });
  } catch (e) {
    console.error('OpenAI request failed:', e);
    return res.status(500).json({ error: 'openai fail' });
  }
};
