# Checklist di pubblicazione

## Prima della build
- In `app.json` conferma `name`, `ios.bundleIdentifier` e `android.package`. L'identificativo non si può cambiare dopo la pubblicazione.
- Il file `.env` non viene caricato nelle build EAS: crea le due variabili `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` su EAS (dashboard expo.dev, sezione Environment variables, oppure `eas env:create`).
- Comandi: `eas login`, `eas init`, `eas build --profile production --platform all`.

## Account
- Apple Developer Program (quota annuale; per l'account a nome azienda servono i dati dell'impresa).
- Google Play Console (quota una tantum). Per i nuovi account personali Google può richiedere un periodo di test chiuso: verifica i requisiti correnti.
- Notifiche push: Apple (chiavi APNs, le gestisce EAS con l'account Apple) e Firebase per Android (`google-services.json`, caricato su EAS).

## Schede degli store
- Privacy policy online con indirizzo pubblico. Dati raccolti: nome, email, telefono, appuntamenti, token per le notifiche. Dati su Supabase, regione UE. L'account si elimina dall'app (richiesto da Apple).
- Descrizione, parole chiave, categoria, classificazione per età.
- Screenshot da iPhone e da Android (prenotazione, appuntamenti).
- Apple: nelle note per il revisore inserisci email e password di un account cliente di prova, poi compila la sezione "App Privacy".
- Google: compila il modulo "Sicurezza dei dati".

## Registrazione ed e-mail di conferma
- In Supabase, Authentication > URL Configuration: imposta "Site URL" sull'indirizzo del sito web dell'app (Cloudflare Pages). Senza, il link nell'e-mail di conferma apre un indirizzo locale e il cliente vede una pagina vuota.
- Authentication > Sign In / Providers > Email: "Confirm email" acceso significa che il cliente deve confermare l'e-mail prima di accedere (il popup lo spiega); spento significa che entra subito.
- Per l'invio affidabile delle e-mail configura il tuo SMTP (Authentication > SMTP Settings): il servizio predefinito di Supabase ha un limite molto basso di invii all'ora.
- Inserisci telefono e WhatsApp di ogni sede (scheda Altro > Contatti delle sedi, come titolare): servono ai pulsanti Chiama e WhatsApp.
- La mappa nella scheda Contatti usa le tessere gratuite di OpenStreetMap (con la dicitura obbligatoria in basso a sinistra). Va bene per un uso leggero come questo; se l'app crescesse molto, passa a un fornitore con chiave (Mapbox, MapTiler) cambiando solo l'indirizzo delle tessere in `MapCard`.
