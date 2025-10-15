const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req,res)=>{
  const userId = req.query.userId;
  if(!userId) return res.status(400).json({error:'no userId'});
  const { data } = await supabaseAdmin.from('user_quotas').select('remaining_messages').eq('user_id', userId).limit(1).single();
  return res.json({ remaining: data?.remaining_messages ?? 0 });
}
