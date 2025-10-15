const Stripe = require('stripe');
const getRawBody = require('raw-body');
const { createClient } = require('@supabase/supabase-js');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req,res)=>{
  if(req.method!=='POST') return res.status(405).end();
  let event;
  try{
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(buf.toString(), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  }catch(e){ console.error('sig',e); return res.status(400).send('webhook err') }
  const type = event.type;
  const obj = event.data.object;
  if(type==='checkout.session.completed'){
    const session = obj;
    const userId = session.metadata?.userId;
    const subscriptionId = session.subscription;
    if(userId && subscriptionId){
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = sub.items.data[0].price.id;
      const plan = priceId;
      await supabaseAdmin.from('subscriptions').upsert({ user_id:userId, stripe_subscription_id: subscriptionId, stripe_price_id: priceId, plan, status: sub.status, current_period_end: new Date(sub.current_period_end*1000) }, { onConflict: 'stripe_subscription_id' });
      const quota = priceId ? 1000 : 100;
      await supabaseAdmin.from('user_quotas').upsert({ user_id:userId, remaining_messages: quota }, { onConflict: 'user_id' });
    }
  }
  res.json({received:true});
}
