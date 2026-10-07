# DF Barbershop – app di prenotazione

App per i tre saloni DF Barbershop (Roma): prenotazioni, barbieri, Shop con Stripe, promemoria push, carta fedeltà.
Expo / React Native (iPhone, Android, web) + Supabase.

```
App.tsx              l'app (unico file)
app.json, eas.json   configurazione Expo e build
lib/                 collegamento al database e notifiche
assets/              logo e icone
supabase/setup.sql   schema del database
supabase/functions/  funzioni server: pagamento, webhook Stripe, promemoria
STORE_CHECKLIST.md   pubblicazione negli store
```

I dati di collegamento a Supabase stanno in un file `.env` locale (non incluso nella repo):

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=la_chiave_anon
```

Le chiavi Stripe e la `service_role` non vanno mai in un file: stanno solo come segreti su Supabase.

La versione per vendere l'app ad altre barberie è nella repo `Barber`.
