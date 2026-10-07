// Invia il promemoria push ai clienti circa 24 ore prima dell'appuntamento.
// Va richiamata ogni 15 minuti (vedi il blocco cron in supabase_push_agenda.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Finestra tra 23 e 24 ore da adesso: con un giro ogni 15 minuti ogni appuntamento ci passa 4 volte,
  // ma reminder_sent_at evita i doppioni.
  const now = Date.now();
  const { data: appts, error } = await db
    .from('appointments')
    .select('id,starts_at,customer_id,salons(name,timezone),services(name)')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .not('customer_id', 'is', null)
    .gte('starts_at', new Date(now + 23 * 3600e3).toISOString())
    .lt('starts_at', new Date(now + 24 * 3600e3).toISOString());

  if (error) return new Response(error.message, { status: 500 });
  if (!appts?.length) return Response.json({ sent: 0 });

  const { data: tokens } = await db
    .from('push_tokens')
    .select('user_id,token')
    .in('user_id', appts.map((a: any) => a.customer_id));

  const messages: any[] = [];
  for (const a of appts as any[]) {
    const time = new Date(a.starts_at).toLocaleTimeString('it-IT', {
      hour: '2-digit', minute: '2-digit', timeZone: a.salons.timezone,
    });
    for (const t of (tokens ?? []).filter((t: any) => t.user_id === a.customer_id)) {
      messages.push({
        to: t.token,
        sound: 'default',
        title: 'Promemoria appuntamento',
        body: `Domani alle ${time} da ${a.salons.name}: ${a.services.name}.`,
        data: { appointmentId: a.id },
      });
    }
  }

  // Invio a blocchi da 100. Se Expo segnala un dispositivo non più valido, elimino il suo token.
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    const { data: tickets } = await res.json().catch(() => ({ data: [] }));
    (tickets ?? []).forEach((tk: any, k: number) => {
      if (tk?.status === 'error' && tk?.details?.error === 'DeviceNotRegistered') dead.push(chunk[k].to);
    });
  }
  if (dead.length) await db.from('push_tokens').delete().in('token', dead);

  await db
    .from('appointments')
    .update({ reminder_sent_at: new Date().toISOString() })
    .in('id', appts.map((a: any) => a.id));

  return Response.json({ sent: messages.length });
});
