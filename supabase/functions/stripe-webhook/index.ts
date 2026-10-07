// Riceve da Stripe la conferma di pagamento e segna l'ordine come pagato.
// Segreti richiesti: STRIPE_WEBHOOK_SECRET (inizia con "whsec_"). Distribuire con --no-verify-jwt.
import { createClient } from 'npm:@supabase/supabase-js@2';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

// Verifica la firma di Stripe: solo Stripe può conoscere il segreto
async function firmaValida(payload: string, header: string, secret: string) {
  const t = header.match(/t=(\d+)/)?.[1];
  const firme = [...header.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!t || firme.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const atteso = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  return firme.includes(atteso);
}

Deno.serve(async (req) => {
  const body = await req.text();
  const ok = await firmaValida(body, req.headers.get('stripe-signature') ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  if (!ok) return new Response('firma non valida', { status: 400 });

  const ev = JSON.parse(body);
  const obj = ev.data?.object;
  const pagato =
    (ev.type === 'checkout.session.completed' && obj?.payment_status === 'paid') ||
    ev.type === 'checkout.session.async_payment_succeeded';

  if (pagato && obj?.metadata?.order_id) {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // l'indirizzo sta in un campo diverso a seconda della versione dell'API Stripe
    const sd = obj.collected_information?.shipping_details ?? obj.shipping_details;
    await db
      .from('orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        shipping_name: sd?.name ?? null,
        shipping_address: sd?.address ?? null,
        ...(obj.customer_details?.phone ? { customer_phone: obj.customer_details.phone } : {}),
      })
      .eq('id', obj.metadata.order_id)
      .eq('status', 'pending');
  }
  return new Response('ok');
});
