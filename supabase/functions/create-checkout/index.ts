// Crea l'ordine e la pagina di pagamento Stripe. I prezzi si leggono dal database, mai dall'app.
// Segreti richiesti: STRIPE_SECRET_KEY, SITE_URL (indirizzo del sito, senza "/" finale).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // chi sta comprando
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await db.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'login_required' }, 401);

  const { items, salon_id, fulfillment = 'pickup' } = await req.json().catch(() => ({}));
  const shipping = fulfillment === 'shipping';
  if (!Array.isArray(items) || items.length === 0 || (!shipping && !salon_id)) return json({ error: 'bad_request' }, 400);

  // prodotti e prezzi dal database
  const { data: products } = await db
    .from('products').select('id,name,price_cents').eq('active', true)
    .in('id', items.map((i: any) => i.product_id));
  const lines = items
    .map((i: any) => {
      const p = products?.find((x: any) => x.id === i.product_id);
      const qty = Math.min(Math.max(parseInt(i.qty, 10) || 0, 0), 20);
      return p && qty ? { ...p, qty } : null;
    })
    .filter(Boolean) as any[];
  if (lines.length === 0) return json({ error: 'empty_cart' }, 400);

  if (!shipping) {
    const { data: salon } = await db.from('salons').select('id').eq('id', salon_id).eq('active', true).maybeSingle();
    if (!salon) return json({ error: 'bad_salon' }, 400);
  }

  // ordine "in attesa": diventa "pagato" solo quando Stripe lo conferma al webhook
  const subtotal = lines.reduce((t, l) => t + l.price_cents * l.qty, 0);

  // costo di spedizione dalla tabella shop_settings (modificabile dal Table Editor)
  let shippingCents = 0;
  if (shipping) {
    const { data: st } = await db.from('shop_settings').select('shipping_cents,free_shipping_over_cents').eq('id', 1).maybeSingle();
    const gratis = st?.free_shipping_over_cents != null && subtotal >= st.free_shipping_over_cents;
    shippingCents = gratis ? 0 : (st?.shipping_cents ?? 0);
  }

  const { data: prof } = await db.from('profiles').select('full_name,phone').eq('id', user.id).maybeSingle();
  const { data: order, error } = await db
    .from('orders')
    .insert({
      user_id: user.id,
      customer_name: prof?.full_name ?? null,
      customer_phone: prof?.phone ?? null,
      salon_id: shipping ? null : salon_id,
      fulfillment: shipping ? 'shipping' : 'pickup',
      shipping_cents: shippingCents,
      total_cents: subtotal + shippingCents,
    })
    .select('id').single();
  if (error || !order) return json({ error: 'order_failed' }, 500);
  await db.from('order_items').insert(
    lines.map((l) => ({ order_id: order.id, product_id: l.id, name: l.name, price_cents: l.price_cents, qty: l.qty })),
  );

  // sessione di pagamento Stripe
  const site = Deno.env.get('SITE_URL')!;
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${site}/?paid=1`,
    cancel_url: `${site}/?paid=0`,
    client_reference_id: order.id,
    'metadata[order_id]': order.id,
  });
  if (user.email) form.set('customer_email', user.email);
  if (shipping) {
    // indirizzo e telefono li raccoglie la pagina di Stripe (solo Italia)
    form.set('shipping_address_collection[allowed_countries][0]', 'IT');
    form.set('phone_number_collection[enabled]', 'true');
    form.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    form.set('shipping_options[0][shipping_rate_data][display_name]', shippingCents ? 'Spedizione a domicilio' : 'Spedizione gratuita');
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shippingCents));
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur');
  }
  lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, 'eur');
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.price_cents));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.name);
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const session = await res.json();
  if (!res.ok || !session.url) return json({ error: 'stripe_failed' }, 502);

  await db.from('orders').update({ stripe_session_id: session.id }).eq('id', order.id);
  return json({ url: session.url });
});
