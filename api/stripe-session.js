const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req,res)=>{
  if(req.method!=='POST') return res.status(405).end();
  const { priceId, userId } = req.body;
  if(!priceId||!userId) return res.status(400).json({error:'missing'});
  const { data: profile } = await supabaseAdmin.from('profiles').select('stripe_customer_id,email').eq('id', userId).limit(1).single();
  let customerId = profile?.stripe_customer_id;
  if(!customerId){
    const customer = await stripe.customers.create({ email: profile?.email || undefined, metadata:{ userId } });
    customerId = customer.id;
    await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    success_url: `${process.env.SUCCESS_URL}?success=true`,
    cancel_url: `${process.env.CANCEL_URL}?canceled=true`,
    metadata: { userId }
  });
  res.json({ url: session.url });
}
