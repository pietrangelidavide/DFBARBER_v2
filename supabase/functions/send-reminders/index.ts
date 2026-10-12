// Notifiche push ai clienti, da richiamare ogni 15 minuti (vedi il blocco cron in setup.sql):
//  1. promemoria circa 24 ore prima dell'appuntamento;
//  2. «Com'è andata?» circa mezz'ora dopo la fine di un appuntamento completato (apre la valutazione e poi Google).
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();

  // Invio a blocchi da 100. Se Expo segnala un dispositivo non più valido, elimino il suo token.
  const send = async (messages: any[]) => {
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
  };

  const tokensOf = async (userIds: string[]) =>
    (await db.from('push_tokens').select('user_id,token').in('user_id', userIds)).data ?? [];

  // ── 1) Promemoria ──
  // Finestra tra 23 e 24 ore da adesso: con un giro ogni 15 minuti ogni appuntamento ci passa 4 volte,
  // ma reminder_sent_at evita i doppioni.
  let reminders = 0;
  const { data: appts, error } = await db
    .from('appointments')
    .select('id,starts_at,customer_id,salons(name,timezone),services(name)')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .not('customer_id', 'is', null)
    .gte('starts_at', new Date(now + 23 * 3600e3).toISOString())
    .lt('starts_at', new Date(now + 24 * 3600e3).toISOString());

  if (error) return new Response(error.message, { status: 500 });

  if (appts?.length) {
    const tokens = await tokensOf(appts.map((a: any) => a.customer_id));
    const messages: any[] = [];
    for (const a of appts as any[]) {
      const time = new Date(a.starts_at).toLocaleTimeString('it-IT', {
        hour: '2-digit', minute: '2-digit', timeZone: a.salons.timezone,
      });
      for (const t of tokens.filter((t: any) => t.user_id === a.customer_id)) {
        messages.push({
          to: t.token,
          sound: 'default',
          title: 'Promemoria appuntamento',
          body: `Domani alle ${time} da ${a.salons.name}: ${a.services.name}.`,
          data: { type: 'reminder', appointmentId: a.id },
        });
      }
    }
    await send(messages);
    await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).in('id', appts.map((a: any) => a.id));
    reminders = messages.length;
  }

  // ── 2) «Com'è andata?» ──
  // Appuntamenti completati, finiti da almeno 30 minuti e al massimo 24 ore fa, non ancora valutati.
  // Se la migrazione delle recensioni non è stata eseguita la query dà errore: i promemoria funzionano comunque.
  let reviews = 0;
  const { data: done, error: e2 } = await db
    .from('appointments')
    .select('id,customer_id,salons(name),services(name)')
    .eq('status', 'completed')
    .is('rating', null)
    .is('review_prompt_sent_at', null)
    .not('customer_id', 'is', null)
    .lt('ends_at', new Date(now - 30 * 60e3).toISOString())
    .gte('ends_at', new Date(now - 24 * 3600e3).toISOString());

  if (!e2 && done?.length) {
    const tokens = await tokensOf(done.map((a: any) => a.customer_id));
    const messages: any[] = [];
    for (const a of done as any[]) {
      for (const t of tokens.filter((t: any) => t.user_id === a.customer_id)) {
        messages.push({
          to: t.token,
          sound: 'default',
          title: 'Com’è andata?',
          body: `Com’è andato il tuo appuntamento da ${a.salons.name}? Dai una valutazione: ci vuole un attimo.`,
          data: { type: 'review', appointmentId: a.id },
        });
      }
    }
    await send(messages);
    await db.from('appointments').update({ review_prompt_sent_at: new Date().toISOString() }).in('id', done.map((a: any) => a.id));
    reviews = messages.length;
  }

  return Response.json({ sent: reminders + reviews, reminders, reviews });
});
