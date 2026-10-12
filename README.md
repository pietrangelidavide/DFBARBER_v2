# DF Barbershop – app di prenotazione

App per i tre saloni DF Barbershop (Roma): prenotazioni, barbieri, Shop con Stripe, promemoria push, carta fedeltà, valutazioni e recensioni su Google.
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

## Recensioni su Google e valutazione a fine servizio

Quando un appuntamento è **Completato**, il cliente può dire com'è andata e lasciare una recensione su Google:

1. **Notifica «Com'è andata?»:** circa mezz'ora dopo la fine dell'appuntamento parte una notifica push (la manda la funzione `send-reminders`, già in cron ogni 15 minuti: niente di nuovo da attivare). Toccandola l'app si apre sull'Agenda con il pannello di valutazione.
2. **Scheda in Agenda:** per 14 giorni, anche senza notifiche, gli appuntamenti completati e non ancora valutati compaiono in cima all'Agenda con cinque stelle.
3. **Valutazione:** il cliente tocca le stelle (da 1 a 5); il voto si salva in `appointments.rating`.
4. **Google:** subito dopo compare «Scrivi la recensione su Google», che apre la pagina di recensione della sede. Il pulsante compare **a tutti, qualunque sia il voto**: le regole di Google vietano di mandare alle recensioni solo i clienti contenti. Con 3 stelle o meno c'è in più, in secondo piano, «Preferisci scrivere al salone? WhatsApp». Google non permette di precompilare le stelle: sulla sua pagina il cliente le sceglie di nuovo.
5. **Contatti:** in *Contatti* ogni sede con il collegamento ha anche la riga «Scrivi una recensione su Google», sempre disponibile.

Da fare una volta:

- Esegui nel SQL Editor di Supabase l'ultimo blocco di `supabase/setup.sql` («Recensioni su Google…»). Si può rilanciare senza danni.
- Ridistribuisci la funzione: `supabase functions deploy send-reminders`.
- Come titolare apri *Contatti*, scegli la sede e in «Modifica contatti» incolla in **Recensioni Google** il *Place ID* della sede (inizia per `ChIJ…`) oppure il link per le recensioni del profilo attività (`https://g.page/r/…/review`). Senza collegamento la notifica e le stelle funzionano lo stesso, ma non c'è il passaggio su Google.
- Le valutazioni si leggono dal Table Editor di Supabase (tabella `appointments`, colonne `rating` e `rated_at`).
- Le notifiche push arrivano solo sui telefoni con l'app installata e il permesso concesso (su Android serve anche Firebase, vedi sotto).

## Tema chiaro e scuro

- **Telefono (iPhone e Android):** l'app segue il tema del sistema, in automatico.
- **Web:** parte in automatico (segue il browser); dalla pagina iniziale (pulsante in alto a destra), da *Profilo* (clienti) e da *Altro* (titolare e barbieri) si può scegliere Automatico, Chiaro o Scuro. La scelta resta salvata nel browser.
- Per far funzionare il tema chiaro anche su Android installa una volta `npx expo install expo-system-ui`; poi rifai la build dell'app (la modifica di `app.json` vale solo con una nuova build).
- I colori dei due temi stanno in cima a `App.tsx` (`DARK` e `LIGHT`).

## Aspetto (versione 2)

Lo stile è quello di iOS: nero (o grigio chiaro) a livelli piatti, celle arrotondate, titoli grandi in grassetto, carattere di sistema, liste raggruppate, barra delle schede con icone piene sulla voce attiva, pannelli con la maniglia. L'unico colore d'accento è l'oro del marchio (`#C4A868`).

- **Caratteri:** nessun pacchetto da installare, l'app usa il carattere di sistema (San Francisco su iPhone).
- **Benvenuto e accesso:** sempre su foto scura. Un tocco (o un clic) in un punto qualsiasi porta all'accesso con i due campi; sotto c'è «Non hai un profilo? Registrati».
- **Foto della pagina iniziale:** `assets/hero.jpg` è un'immagine segnaposto. Sostituiscila con una foto vera del salone (verticale, almeno 1170×2532 px, scura: sopra c'è già una sfumatura nera per leggere il testo).
- **Icona e schermata di avvio:** `assets/icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png` portano il monogramma «DF» (oro con lettere scure). Per usare il logo ufficiale (stemma) servono i file originali ad alta risoluzione: basta sostituire questi cinque file.
- **Colori:** `DARK` e `LIGHT` in cima a `App.tsx`. Nel tema chiaro i testi piccoli in oro usano una tonalità più scura (`#7F6325`) per restare leggibili.

La versione per vendere l'app ad altre barberie è nella repo `Barber` (non cambia con la versione 2).

## App Android (APK, gratis)

Il workflow `.github/workflows/android-apk.yml` costruisce l'app Android su GitHub Actions e la pubblica come file `DFBarbershop.apk` nella release **beta** del repository. Non tocca i file del progetto: crea una copia di lavoro in una cartella temporanea.

Prima volta, una sola volta: su GitHub apri **Settings** > **Secrets and variables** > **Actions** > **New repository secret** e crea due segreti con gli stessi valori del file `.env`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Poi, a ogni versione:

1. **Actions** > **Android APK** > **Run workflow** (circa 15–25 minuti).
2. **Releases** > **DF Barbershop beta** e scarica `DFBarbershop.apk` dal telefono.
3. Aprilo e consenti l'installazione da questa fonte (serve Android 7 o successivo).

La chiave di firma viene creata alla prima build e conservata nella release privata **chiave-firma**: non cancellarla, altrimenti per aggiornare l'app dovrai prima disinstallarla. L'APK contiene solo la versione per telefoni a 64 bit (la quasi totalità).

Le notifiche push su Android richiedono in più la configurazione di Firebase (file `google-services.json`): finché non c'è, l'app funziona ma non registra il telefono per le notifiche.
