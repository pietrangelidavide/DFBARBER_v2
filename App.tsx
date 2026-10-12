import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { ActivityIndicator, Alert as RNAlert, Animated, Easing, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { registerForPush } from './lib/push';

// Su web Alert.alert non mostra nulla: uso i dialoghi del browser
const Alert: typeof RNAlert =
  Platform.OS === 'web'
    ? ({
        alert: (title: string, message?: string, buttons?: any[]) => {
          const w: any = globalThis;
          const text = [title, message].filter(Boolean).join('\n\n');
          const action = buttons?.find((b) => b.style !== 'cancel');
          if (buttons && buttons.length > 1) {
            if (w.confirm(text) && action?.onPress) action.onPress();
          } else {
            w.alert(text);
            buttons?.[0]?.onPress?.();
          }
        },
      } as any)
    : RNAlert;

// ───────── Tema chiaro e scuro ─────────
// Stile Apple (iOS): livelli di grigio piatti, niente bordi né sfumature, carattere di sistema e un solo oro (#C4A868) come colore d'accento.
// Scuro: nero con celle #1C1C1E, come le Impostazioni dell'iPhone. Chiaro: sfondo #F2F2F7 con celle bianche.
// Il tema chiaro usa un oro più scuro per i testi piccoli (leggibilità).
// Sul telefono l'app segue il tema del sistema; sul web si sceglie fra Automatico, Chiaro e Scuro (la scelta resta nel browser).
const DARK = {
  bg: '#000000', card: '#1C1C1E', card2: '#2C2C2E', line: '#38383A',
  text: '#FFFFFF', muted: '#98989F',
  accent: '#C4A868', accentSoft: 'rgba(196,168,104,0.16)',
  accentText: '#C4A868',            // oro per testi e icone
  onAccent: '#14110D',              // testo sopra l'oro
  danger: '#FF453A', dangerSoft: 'rgba(255,69,58,0.16)', ok: '#30D158', series2: '#8E8E93',
  bar: 'rgba(22,22,24,0.94)',       // barre in alto e in basso
  seg: 'rgba(255,255,255,0.16)',    // voce scelta nei selettori a segmenti
  slot: '#2C2C2E',                  // orario libero nell'agenda
  tileA: '#F5F5F7', loyA: '#1C1C1E', mapA: '#1C1C1E',
  scrim: 'rgba(0,0,0,0.6)', shadow: '#000000', shadowO: 0.45,
  calCard: '#1C1C1E', calBar: 'rgba(0,0,0,0.92)', calOff: 'rgba(152,152,159,0.4)',
};
const LIGHT: typeof DARK = {
  bg: '#F2F2F7', card: '#FFFFFF', card2: '#E5E5EA', line: '#D1D1D6',
  text: '#000000', muted: '#6C6C70',
  accent: '#C4A868', accentSoft: 'rgba(196,168,104,0.2)',
  accentText: '#7F6325',
  onAccent: '#14110D',
  danger: '#D70015', dangerSoft: 'rgba(215,0,21,0.1)', ok: '#248A3D', series2: '#8E8E93',
  bar: 'rgba(249,249,249,0.94)',
  seg: '#FFFFFF',
  slot: '#F2F2F7',
  tileA: '#F5F5F7', loyA: '#FFFFFF', mapA: '#E5E5EA',
  scrim: 'rgba(0,0,0,0.4)', shadow: '#000000', shadowO: 0.12,
  calCard: '#FFFFFF', calBar: 'rgba(242,242,247,0.94)', calOff: 'rgba(60,60,67,0.3)',
};
type Mode = 'dark' | 'light';
type ThemePref = 'auto' | 'light' | 'dark';
let MODE: Mode = 'dark';
const C: typeof DARK = { ...DARK };

// Cambia tema: la palette si aggiorna sul posto e gli stili vengono ricreati
function applyMode(m: Mode) {
  if (m === MODE) return;
  MODE = m;
  Object.assign(C, m === 'light' ? LIGHT : DARK);
  s = makeStyles();
}

// Scelta del tema sul web (sul telefono resta sempre "Automatico": segue il sistema)
const THEME_KEY = 'df-tema';
const webStore = (): any => { try { return Platform.OS === 'web' ? (globalThis as any).localStorage : null; } catch { return null; } };
let THEME_PREF: ThemePref = (() => {
  try { const v = webStore()?.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
})();
const themeListeners = new Set<() => void>();
function setThemePref(p: ThemePref) {
  THEME_PREF = p;
  try { const st = webStore(); if (p === 'auto') st?.removeItem(THEME_KEY); else st?.setItem(THEME_KEY, p); } catch { /* senza archivio la scelta vale finché la pagina è aperta */ }
  themeListeners.forEach((f) => f());
}
function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    themeListeners.add(f);
    return () => { themeListeners.delete(f); };
  }, []);
  return [THEME_PREF, setThemePref];
}

const ERR: Record<string, string> = {
  slot_not_available: 'Questo orario è appena stato preso. Scegline un altro.',
  too_late_to_cancel: 'Troppo tardi per disdire dall’app: chiama il salone.',
  login_required: 'Accedi per prenotare.',
  'exclusion constraint': 'Questo orario è già occupato. Scegline un altro.',
};
const errText = (e: any) => {
  const k = Object.keys(ERR).find((key) => e?.message?.includes(key));
  return k ? ERR[k] : 'Qualcosa è andato storto. Riprova tra poco.';
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: tz });
const dayLabel = (d: Date) => d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const eur = (cents: number) => `€${(cents / 100).toFixed(2).replace('.', ',')}`;

const durLabel = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
const groupBy = (arr: any[], key: string) =>
  arr.reduce((acc: Record<string, any[]>, x) => { (acc[x[key]] ||= []).push(x); return acc; }, {});

const HORIZON_DAYS = 60; // quanto in avanti si può prenotare
const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const digits = (v: string) => v.replace(/\D/g, '');
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const phoneOk = (v: string) => /^\+?[0-9 ()./-]+$/.test(v.trim()) && digits(v).length >= 6 && digits(v).length <= 15;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fromYmd = (t: string) => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d); };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Collegamenti verso altre app (telefono, WhatsApp, Google Maps)
const telUrl = (v: string) => `tel:${v.replace(/[^\d+]/g, '')}`;
const waUrl = (v?: string | null, text?: string) => {
  let n = digits(v ?? '').replace(/^00/, '');
  if (n.length === 10 && n.startsWith('3')) n = `39${n}`; // cellulare italiano scritto senza prefisso
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
const mapsSearch = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
const mapsRoute = (addr: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
// Dopo il clic sul link dell'e-mail, su web si torna al sito stesso (sull'app resta l'indirizzo impostato in Supabase)
const redirectTo: string | undefined = Platform.OS === 'web' ? (globalThis as any).location?.origin : undefined;
const openUrl = (url: string) => { Linking.openURL(url).catch(() => Alert.alert('Non riesco ad aprire il collegamento')); };

// ───────── Caratteri ─────────
// Come su iPhone: carattere di sistema ovunque (San Francisco su iOS, Roboto su Android, quello del dispositivo sul web). Nessun pacchetto da installare.

type Cart = Record<string, { p: any; qty: number }>;
type StaffScope = { salonIds: string[] | null }; // null = tutte le sedi (titolare)
type Tab = 'book' | 'shop' | 'team' | 'contacts' | 'profile' | 'mine' | 'myday' | 'agenda' | 'new' | 'off' | 'orders' | 'control' | 'more';

// ───────── Elementi comuni (stile Apple) ─────────
// Pannello piatto, come una cella delle Impostazioni
function Panel({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; tint?: string }) {
  return <View style={[{ backgroundColor: C.card, borderRadius: 14 }, style]}>{children}</View>;
}

// Marchio "DF": tessera dorata con angoli arrotondati, come l'icona di un'app
function DFMark({ size = 40 }: { size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24), backgroundColor: '#C4A868', alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel="DF Barbershop"
    >
      <Text allowFontScaling={false} style={{ color: '#14110D', fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.52), fontWeight: '800', letterSpacing: -size * 0.02 }}>DF</Text>
    </View>
  );
}

// Titolo di pagina: grande, in grassetto, con una frase sotto
function PageTitle({ t, sub }: { t: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={s.h1} accessibilityRole="header">{t}</Text>
      {sub ? <Text style={s.lead}>{sub}</Text> : null}
    </View>
  );
}

function Chip({ label, sub, on, onPress }: { label: string; sub?: string | null; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipT, on && s.onT]}>{label}</Text>
      {sub ? <Text style={[s.chipSub, on && s.onT]}>{sub}</Text> : null}
    </Pressable>
  );
}
const Title = ({ t }: { t: string }) => <Text style={[s.h2, { marginTop: 26, marginBottom: 10 }]} accessibilityRole="header">{t}</Text>;

// Pulsante rotondo (indietro, menu, frecce del calendario…)
const IconBtn = ({ name, onPress, label, onDark }: { name: string; onPress: () => void; label: string; onDark?: boolean }) => (
  <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={[s.logoutBtn, onDark && { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
    <Ionicons name={name as any} size={20} color={onDark ? '#FFFFFF' : C.accentText} />
  </Pressable>
);

// Scelta del tema (solo web: sul telefono si segue il sistema), come un selettore a segmenti di iOS
const THEME_LABEL: Record<ThemePref, string> = { auto: 'Automatico', light: 'Chiaro', dark: 'Scuro' };
function ThemePicker() {
  const [pref, setPref] = useThemePref();
  return (
    <>
      <Title t="Aspetto" />
      <View style={s.seg}>
        {(['auto', 'light', 'dark'] as ThemePref[]).map((id) => (
          <Pressable key={id} onPress={() => setPref(id)} style={[s.segItem, pref === id && s.segItemOn]} accessibilityRole="button" accessibilityState={{ selected: pref === id }}>
            <Text style={[s.segT, pref === id && s.segTOn]}>{THEME_LABEL[id]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.rowSub, { marginTop: 10, marginLeft: 4 }]}>Automatico segue il tema del tuo dispositivo. La scelta resta salvata su questo browser.</Text>
    </>
  );
}
// Pulsante rapido per la pagina iniziale (web): Automatico → Chiaro → Scuro
function ThemeToggle({ top, onDark }: { top: number; onDark?: boolean }) {
  const [pref, setPref] = useThemePref();
  const next: ThemePref = pref === 'auto' ? 'light' : pref === 'light' ? 'dark' : 'auto';
  const icon = pref === 'auto' ? 'contrast-outline' : pref === 'light' ? 'sunny-outline' : 'moon-outline';
  return (
    <View style={{ position: 'absolute', top, right: 16, zIndex: 5 }}>
      <IconBtn name={icon} onPress={() => setPref(next)} label={`Tema: ${THEME_LABEL[pref]}. Tocca per cambiarlo`} onDark={onDark} />
    </View>
  );
}

const Step = ({ n, t, done }: { n: number; t: string; done?: boolean }) => (
  <View style={s.stepRow}>
    <View style={[s.stepNum, done && s.stepNumOn]}>
      {done ? <Ionicons name="checkmark" size={16} color={C.onAccent} /> : <Text style={s.stepNumT}>{n}</Text>}
    </View>
    <Text style={s.h2} accessibilityRole="header">{t}</Text>
  </View>
);

// Icone delle schede: piene quando la scheda è attiva (come su iPhone)
const tabIcon = (icon: string, on: boolean) => (on ? icon.replace('-outline', '') : icon) as any;

// Web su schermo largo (computer): menu in alto al posto della barra in basso e contenuto centrato.
// Sul telefono e sul tablet (anche in orizzontale) resta la barra in basso.
const DESK_MIN = 1100;
const useDesk = () => { const { width } = useWindowDimensions(); return Platform.OS === 'web' && width >= DESK_MIN; };

function Header({ onLogout, onMenu }: { onLogout: () => void; onMenu?: () => void }) {
  return (
    <View style={s.headerWrap}>
      <View style={s.header}>
        <DFMark size={32} />
        <View style={{ flex: 1 }}>
          <Text style={s.headT} numberOfLines={1}>Daniele Fichera</Text>
          <Text style={s.headSub} numberOfLines={1}>Barber Shop · Roma</Text>
        </View>
        <IconBtn name={onMenu ? 'ellipsis-horizontal' : 'log-out-outline'} onPress={onMenu ?? onLogout} label={onMenu ? 'Account' : 'Esci'} />
      </View>
    </View>
  );
}

// Entrata morbida a ogni cambio di scheda
function Appear({ children }: { children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 240, useNativeDriver: true }).start(); }, [v]);
  return (
    <Animated.View style={{ flex: 1, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function DayTile({ d, on, onPress }: { d: Date; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.dayTile, on && s.chipOn]}>
      <Text style={[s.dayW, on && s.onT]}>{d.toLocaleDateString('it-IT', { weekday: 'short' })}</Text>
      <Text style={[s.dayN, on && s.onT]}>{d.getDate()}</Text>
      <Text style={[s.dayW, on && s.onT]}>{d.toLocaleDateString('it-IT', { month: 'short' })}</Text>
    </Pressable>
  );
}

// Orari divisi in mattina e pomeriggio
function Slots({ slots, tz, selected, onPick }: { slots: any[]; tz: string; selected: string | null; onPick: (r: any) => void }) {
  const hour = (r: any) => parseInt(hhmm(r.slot_start, tz), 10);
  const groups: [string, any[]][] = [
    ['Mattina', slots.filter((r) => hour(r) < 14)],
    ['Pomeriggio', slots.filter((r) => hour(r) >= 14)],
  ];
  return (
    <>
      {groups.map(([label, list]) =>
        list.length === 0 ? null : (
          <View key={label} style={{ marginBottom: 14 }}>
            <Text style={s.cat}>{label}</Text>
            <View style={s.wrap}>
              {list.map((r) => {
                const on = selected === r.slot_start;
                return (
                  <Pressable key={r.slot_start} style={[s.slot, on && s.chipOn]} onPress={() => onPick(r)}>
                    <Text style={[s.slotT, on && s.onT]}>{hhmm(r.slot_start, tz)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )
      )}
    </>
  );
}

// ───────── Shop ─────────
function Shop({ cart, setCart, canEdit }: { cart: Cart; setCart: (c: Cart) => void; canEdit?: boolean }) {
  const desk = useDesk();
  const [items, setItems] = useState<any[]>([]);
  const [salons, setSalons] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [salonId, setSalonId] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<'pickup' | 'shipping'>('pickup');
  const [settings, setSettings] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    supabase.from('products').select('id,name,price_cents,description,image_url').eq('active', true).order('name').then(({ data }) => setItems(data ?? []));
    supabase.from('salons').select('id,name').eq('active', true).order('name').then(({ data }) => setSalons(data ?? []));
    supabase.from('shop_settings').select('shipping_cents,free_shipping_over_cents').eq('id', 1).maybeSingle().then(({ data }) => setSettings(data));
  }, []);

  const lines = Object.values(cart);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((t, l) => t + l.qty * l.p.price_cents, 0);
  const freeShip = settings?.free_shipping_over_cents != null && total >= settings.free_shipping_over_cents;
  const shipCents = fulfillment === 'shipping' ? (freeShip ? 0 : settings?.shipping_cents ?? 0) : 0;
  const grand = total + shipCents;
  const setQty = (p: any, q: number) => {
    const next = { ...cart };
    if (q <= 0) delete next[p.id]; else next[p.id] = { p, qty: Math.min(q, 20) };
    setCart(next);
  };

  const openProduct = (p: any) => { setOpen(p); setEditing(false); setDraft(p.description ?? ''); };

  // Solo il titolare: scrive la descrizione del prodotto
  const saveDescription = async () => {
    const text = draft.trim();
    const { error } = await supabase.from('products').update({ description: text || null }).eq('id', open.id);
    if (error) return Alert.alert('Errore', 'Non riesco a salvare la descrizione.');
    const next = { ...open, description: text || null };
    setItems(items.map((x) => (x.id === open.id ? next : x)));
    setOpen(next);
    setEditing(false);
  };

  // Solo il titolare: sceglie la foto dalla galleria, la carica e la collega al prodotto
  const pickImage = async () => {
    if (!open) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const buf = await (await fetch(a.uri)).arrayBuffer();
      const type = a.mimeType ?? 'image/jpeg';
      const path = `${open.id}-${Date.now()}.${type.includes('png') ? 'png' : 'jpg'}`;
      const up = await supabase.storage.from('products').upload(path, buf, { contentType: type, upsert: true });
      if (up.error) throw up.error;
      const url = supabase.storage.from('products').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('products').update({ image_url: url }).eq('id', open.id);
      if (error) throw error;
      const next = { ...open, image_url: url };
      setItems(items.map((x) => (x.id === open.id ? next : x)));
      setOpen(next);
    } catch {
      Alert.alert('Foto non caricata', 'Controlla di aver eseguito la migrazione delle foto prodotto e di essere entrato come titolare.');
    }
    setUploading(false);
  };

  // Il pagamento avviene sulla pagina sicura di Stripe; i prezzi li ricalcola il server
  const pay = async () => {
    if (fulfillment === 'pickup' && !salonId) return Alert.alert('Scegli la sede', 'Indica in quale sede ritirerai i prodotti.');
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })), fulfillment, salon_id: fulfillment === 'pickup' ? salonId : null },
    });
    setBusy(false);
    if (error || !data?.url) return Alert.alert('Pagamento non disponibile', 'Riprova tra poco.');
    setCart({});
    setCheckout(false);
    if (Platform.OS === 'web') (globalThis as any).location.href = data.url;
    else Linking.openURL(data.url);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: count ? 110 : 40 }]}>
        <PageTitle t="Il nostro Shop" sub={`${items.length} prodotti scelti dai nostri barbieri`} />
        <View style={[s.grid, desk && s.grid3]}>
          {items.map((p) => (
            <Pressable key={p.id} style={[s.product, desk && s.col3]} onPress={() => openProduct(p)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${eur(p.price_cents)}`}>
              <View style={[s.productTile, !p.image_url && { backgroundColor: C.card2 }]}>
                {p.image_url ? (
                  <Image source={{ uri: p.image_url }} style={s.productImg} resizeMode="contain" />
                ) : (
                  <Ionicons name="water-outline" size={34} color={C.accentText} />
                )}
              </View>
              <Text style={s.prodName} numberOfLines={2}>{p.name}</Text>
              <Text style={[s.prodDesc, { minHeight: 18 }]} numberOfLines={1}>{p.description ?? ''}</Text>
              <View style={s.productFoot}>
                <Text style={s.price}>{eur(p.price_cents)}</Text>
                <Pressable onPress={() => setQty(p, (cart[p.id]?.qty ?? 0) + 1)} hitSlop={8} style={s.plus} accessibilityRole="button" accessibilityLabel={`Aggiungi ${p.name} al carrello`}>
                  <Ionicons name="add" size={18} color={C.onAccent} />
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {count > 0 && (
        <Pressable style={s.cartBar} onPress={() => setCheckout(true)} accessibilityRole="button" accessibilityLabel={`Apri il carrello, ${count} articoli, ${eur(total)}`}>
          <Ionicons name="bag-handle-outline" size={20} color={C.onAccent} />
          <Text style={[s.cartT, { flex: 1 }]}>Carrello ({count})</Text>
          <Text style={s.cartT}>{eur(total)}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.onAccent} />
        </Pressable>
      )}

      {/* dettaglio prodotto */}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(null)} />
        <View style={s.sheet}>
<View style={s.grab} />
          {open && (
            <>
              <View style={[s.productTileBig, !open.image_url && { backgroundColor: C.card2 }]}>
                {open.image_url ? (
                  <Image source={{ uri: open.image_url }} style={s.productImgBig} resizeMode="contain" />
                ) : (
                  <Ionicons name="water-outline" size={56} color={C.accentText} />
                )}
              </View>
              <Text style={s.h1}>{open.name}</Text>
              <Text style={[s.price, { fontSize: 32 }]}>{eur(open.price_cents)}</Text>
              {editing ? (
                <>
                  <TextInput
                    style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]}
                    multiline
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Scrivi la descrizione del prodotto"
                    placeholderTextColor={C.muted}
                  />
                  <Pressable style={s.btn} onPress={saveDescription}><Text style={s.btnT}>Salva descrizione</Text></Pressable>
                </>
              ) : (
                <>
                  <Text style={[s.muted, { marginTop: 14 }]}>{open.description || 'Descrizione in arrivo.'}</Text>
                  {canEdit && (
                    <View style={[s.wrap, { marginTop: 12, gap: 18 }]}>
                      <Pressable onPress={() => setEditing(true)}>
                        <Text style={s.link}>{open.description ? 'Modifica descrizione' : 'Aggiungi descrizione'}</Text>
                      </Pressable>
                      <Pressable onPress={pickImage} disabled={uploading}>
                        <Text style={s.link}>{uploading ? 'Carico la foto…' : open.image_url ? 'Cambia foto' : 'Aggiungi foto'}</Text>
                      </Pressable>
                    </View>
                  )}
                  <Pressable style={s.btn} onPress={() => { setQty(open, (cart[open.id]?.qty ?? 0) + 1); setOpen(null); }}>
                    <Text style={s.btnT}>Aggiungi al carrello</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* carrello e pagamento */}
      <Modal visible={checkout && count > 0} transparent animationType="slide" onRequestClose={() => setCheckout(false)}>
        <Pressable style={s.backdrop} onPress={() => setCheckout(false)} />
        <View style={s.sheet}>
<View style={s.grab} />
          <Text style={s.h1}>Il tuo carrello</Text>
          <ScrollView style={{ maxHeight: 260, marginTop: 10 }}>
            {lines.map((l) => (
              <View key={l.p.id} style={[s.row, { marginBottom: 6 }]}>
                {l.p.image_url ? <Image source={{ uri: l.p.image_url }} style={s.cartImg} resizeMode="contain" /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={s.rowT}>{l.p.name}</Text>
                  <Text style={s.rowSub}>{eur(l.p.price_cents)}</Text>
                </View>
                <Pressable onPress={() => setQty(l.p, l.qty - 1)} style={s.qtyBtn}><Ionicons name="remove" size={18} color={C.text} /></Pressable>
                <Text style={s.qtyT}>{l.qty}</Text>
                <Pressable onPress={() => setQty(l.p, l.qty + 1)} style={s.qtyBtn}><Ionicons name="add" size={18} color={C.text} /></Pressable>
              </View>
            ))}
          </ScrollView>
          <Text style={[s.cat, { marginTop: 16 }]}>Come lo ricevi</Text>
          <View style={s.wrap}>
            <Chip label="Ritiro in sede" on={fulfillment === 'pickup'} onPress={() => setFulfillment('pickup')} />
            <Chip label="Spedizione a casa" on={fulfillment === 'shipping'} onPress={() => setFulfillment('shipping')} />
          </View>
          {fulfillment === 'pickup' ? (
            <View style={[s.wrap, { marginTop: 10 }]}>
              {salons.map((x) => <Chip key={x.id} label={x.name} on={salonId === x.id} onPress={() => setSalonId(x.id)} />)}
            </View>
          ) : (
            <Text style={[s.rowSub, { marginTop: 10 }]}>
              {settings?.free_shipping_over_cents != null
                ? `Spedizione ${eur(settings.shipping_cents)}, gratis sopra ${eur(settings.free_shipping_over_cents)}. `
                : `Spedizione ${eur(settings?.shipping_cents ?? 0)}. `}
              L’indirizzo lo inserisci nella pagina di pagamento.
            </Text>
          )}
          <View style={{ marginTop: 14 }}>
            <Text style={s.rowSub}>Prodotti {eur(total)}</Text>
            {fulfillment === 'shipping' && <Text style={s.rowSub}>Spedizione {shipCents ? eur(shipCents) : 'gratuita'}</Text>}
          </View>
          <Pressable style={s.btn} onPress={pay} disabled={busy}>
            <Text style={s.btnT}>{busy ? 'Un attimo…' : `Paga online ${eur(grand)}`}</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ───────── Accesso e registrazione ─────────
type Done = { email: string; first: string; last: string; phone: string; active: boolean };

// Campo con etichetta, errore e (facoltativo) elemento a destra: lo usano Profilo e Contatti
function Field({ label, error, right, onFocus, onBlur, ...p }: TextInputProps & { label: string; error?: string | null; right?: ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldBox, focus && s.fieldFocus, !!error && { borderColor: C.danger }]}>
        <TextInput
          style={[s.fieldInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
          placeholderTextColor={C.muted}
          {...p}
          onFocus={(e) => { setFocus(true); onFocus?.(e); }}
          onBlur={(e) => { setFocus(false); onBlur?.(e); }}
        />
        {right}
      </View>
      {error ? <Text style={s.fieldErr}>{error}</Text> : null}
    </View>
  );
}

// ───────── Pagina iniziale ─────────
const clampN = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Sfondo di Benvenuto e accesso: la foto del salone, scurita. È sempre scura, anche con il tema chiaro.
function Backdrop() {
  return (
    <>
      <Image source={require('./assets/hero.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.86)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
    </>
  );
}

// Benvenuto, uguale su telefono, tablet e web: la foto scurita, il marchio, il titolo e una frase.
// Niente animazioni e niente pulsanti: si tocca (o si clicca) in un punto qualsiasi e si passa all'accesso,
// dove sotto i due campi c'è il link a Registrati.
function Hello({ onNext }: { onNext: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const desk = useDesk();
  const base = Math.min(width, height);
  const big = Platform.OS !== 'web' && base >= 600; // tablet
  const fs = big ? clampN(56, base * 0.08, 80) : width < 600 ? 38 : 54;
  const mark = big ? 112 : 84;
  const sub = big ? 22 : 18;
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <Backdrop />
      <StatusBar style="light" />
      <Pressable style={{ flex: 1 }} onPress={onNext} accessibilityRole="button" accessibilityLabel="Continua">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 36 }}>
          <View style={{ width: '100%', maxWidth: big ? 640 : 420, alignItems: 'center' }}>
            <DFMark size={mark} />
            <Text style={[A.heTitle, { fontSize: fs, lineHeight: Math.round(fs * 1.1), letterSpacing: -fs * 0.03 }]} accessibilityRole="header">
              Benvenuto in{'\n'}DF Barbershop
            </Text>
            <Text style={[A.heSub, { fontSize: sub, lineHeight: Math.round(sub * 1.4), maxWidth: big ? 560 : 400 }]}>
              Eleganza, stile e professionalità.{'\n'}Prenota il tuo posto e vivi l’esperienza firmata DF.
            </Text>
          </View>
          <Text style={[A.heTap, { bottom: insets.bottom + 40 }]}>{desk ? 'Clicca per continuare' : 'Tocca per continuare'}</Text>
        </View>
      </Pressable>
      {Platform.OS === 'web' && <ThemeToggle top={insets.top + 12} onDark />}
    </View>
  );
}

// Accesso e registrazione, in stile Apple: colonna centrata, titolo grande, campi raggruppati in un pannello
// con l'etichetta che sale quando si scrive, un solo pulsante a pillola. Sullo sfondo la foto del salone.
function AuthShell({ title, sub, onBack, children }: { title: string; sub: string; onBack: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <Backdrop />
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 64, paddingBottom: insets.bottom + 36 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={A.col}>
            <View style={A.logo}><DFMark size={64} /></View>
            <Text style={A.title} accessibilityRole="header">{title}</Text>
            <Text style={A.sub}>{sub}</Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Pressable style={[A.back, { top: insets.top + 14 }]} onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Indietro">
        <Ionicons name="chevron-back" size={22} color={A_GOLD} />
        <Text style={A.backT}>Indietro</Text>
      </Pressable>
    </View>
  );
}

// Pannello che raccoglie più campi: angoli ampi, righe separate da un filo
function AuthPanel({ children }: { children: ReactNode }) {
  return <View style={A.panel}>{children}</View>;
}

// Campo con l'etichetta che passa da segnaposto a titoletto quando si tocca o si scrive (come nei moduli di Apple)
function AuthInput({ label, value, error, right, hint, style, ...p }: TextInputProps & { label: string; value: string; error?: string | null; right?: ReactNode; hint?: string }) {
  const [focus, setFocus] = useState(false);
  const up = focus || value.length > 0;
  const a = useRef(new Animated.Value(up ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: up ? 1 : 0, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [up]);
  const col = error ? A_RED : focus ? A_GOLD : 'rgba(255,255,255,0.6)';
  return (
    <View style={[A.row, focus && { backgroundColor: 'rgba(255,255,255,0.06)' }, style]}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, top: a.interpolate({ inputRange: [0, 1], outputRange: [19, 8] }) }}>
        <Animated.Text numberOfLines={1} allowFontScaling={false} style={{ color: col, fontWeight: '500', fontSize: a.interpolate({ inputRange: [0, 1], outputRange: [17, 12] }) }}>{label}</Animated.Text>
      </Animated.View>
      <TextInput
        {...p}
        value={value}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={up ? hint : undefined}
        placeholderTextColor="rgba(255,255,255,0.3)"
        accessibilityLabel={label}
        selectionColor={A_GOLD}
        style={[A.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
      />
      {right}
    </View>
  );
}

function LoginForm({ email0, onBack, onSwitch }: { email0: string; onBack: () => void; onSwitch: () => void }) {
  const [email, setEmail] = useState(email0);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!emailOk(email) || !pw) { setErr('Inserisci la tua e-mail e la password.'); return; }
    setBusy(true);
    setErr(null);
    setUnconfirmed(false);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (!error) return; // la sessione parte da sola
    const m = error.message.toLowerCase();
    if (m.includes('not confirmed')) { setUnconfirmed(true); setErr('Devi prima confermare la tua e-mail: controlla la posta (anche lo spam).'); }
    else if (m.includes('invalid')) setErr('E-mail o password non corrette.');
    else setErr('Non riesco ad accedere. Riprova tra poco.');
  };
  const resend = async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo } });
    if (error) Alert.alert('Non riesco a inviare', 'Aspetta un minuto e riprova.');
    else Alert.alert('E-mail inviata', 'Controlla la tua posta e apri il link di conferma.');
  };

  return (
    <AuthShell title="Bentornato" sub="Accedi per prenotare, vedere i tuoi appuntamenti e la tua carta fedeltà." onBack={onBack}>
      <AuthPanel>
        <AuthInput label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" hint="nome@esempio.it" />
        <View style={A.sep} />
        <AuthInput
          label="Password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          onSubmitEditing={submit}
          right={
            <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityRole="button" accessibilityLabel={show ? 'Nascondi la password' : 'Mostra la password'}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={21} color="rgba(255,255,255,0.6)" />
            </Pressable>
          }
        />
      </AuthPanel>
      {err ? <Text style={A.err}>{err}</Text> : null}
      {unconfirmed ? (
        <Pressable onPress={resend} style={{ marginTop: 10, alignSelf: 'center' }}>
          <Text style={A.link}>Rinvia l’e-mail di conferma</Text>
        </Pressable>
      ) : null}
      <Pressable style={({ pressed }) => [A.btn, (busy || pressed) && { opacity: busy ? 0.6 : 0.88 }]} onPress={submit} disabled={busy} accessibilityRole="button">
        <Text style={A.btnT}>{busy ? 'Un attimo…' : 'Accedi'}</Text>
      </Pressable>
      <Pressable onPress={onSwitch} style={A.switch} accessibilityRole="button">
        <Text style={A.muted}>Non hai un profilo? <Text style={{ color: A_GOLD, fontWeight: '700' }}>Registrati</Text></Text>
      </Pressable>
    </AuthShell>
  );
}

function RegisterForm({ onBack, onSwitch, onHold, onDone }: { onBack: () => void; onSwitch: () => void; onHold: (v: boolean) => void; onDone: (d: Done) => void }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const sending = useRef(false);

  const errs = {
    first: first.trim() ? null : 'Inserisci il tuo nome',
    last: last.trim() ? null : 'Inserisci il tuo cognome',
    phone: phoneOk(phone) ? null : 'Inserisci un numero di telefono valido',
    email: emailOk(email) ? null : 'Inserisci un’e-mail valida',
    pw: pw.length >= 8 ? null : 'Almeno 8 caratteri',
    pw2: !pw2 ? 'Ripeti la password' : pw2 !== pw ? 'Le due password non coincidono' : null,
  };
  const shown = (k: keyof typeof errs) => (tried || (k === 'pw2' && pw2.length > 0) ? errs[k] : null);

  const submit = async () => {
    if (sending.current) return; // niente doppio invio (Invio + clic)
    setTried(true);
    setFail(null);
    if (Object.values(errs).some(Boolean)) return;
    sending.current = true;
    setBusy(true);
    onHold(true); // senza conferma e-mail la sessione parte subito: tengo qui la schermata per mostrare la conferma
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pw,
      options: {
        emailRedirectTo: redirectTo,
        data: { first_name: first.trim(), last_name: last.trim(), full_name: `${first.trim()} ${last.trim()}`, phone: phone.trim() },
      },
    });
    sending.current = false;
    setBusy(false);
    const dup = !error && !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
    if (error || dup) {
      onHold(false);
      const m = (error?.message ?? '').toLowerCase();
      setFail(
        dup || m.includes('already')
          ? 'Questa e-mail è già registrata: accedi, oppure usa un’altra e-mail.'
          : m.includes('password')
            ? 'La password non è abbastanza sicura: usa almeno 8 caratteri tra lettere e numeri.'
            : m.includes('rate') || m.includes('security')
              ? 'Troppi tentativi: aspetta un minuto e riprova.'
              : 'Non riesco a creare l’account. Riprova tra poco.'
      );
      return;
    }
    onDone({ email: email.trim(), first: first.trim(), last: last.trim(), phone: phone.trim(), active: !!data.session });
  };

  return (
    <AuthShell title="Crea il tuo account" sub="Ti servono pochi secondi." onBack={onBack}>
      <AuthPanel>
        <View style={{ flexDirection: 'row' }}>
          <AuthInput style={{ flex: 1 }} label="Nome" value={first} onChangeText={setFirst} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" error={shown('first')} />
          <View style={A.vsep} />
          <AuthInput style={{ flex: 1 }} label="Cognome" value={last} onChangeText={setLast} autoCapitalize="words" autoComplete="family-name" textContentType="familyName" error={shown('last')} />
        </View>
        <View style={A.sep} />
        <AuthInput label="Numero di telefono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" hint="+39 333 1234567" error={shown('phone')} />
      </AuthPanel>
      {(['first', 'last', 'phone'] as const).map((k) => (shown(k) ? <Text key={k} style={A.err}>{shown(k)}</Text> : null))}
      <View style={{ height: 14 }} />
      <AuthPanel>
        <AuthInput label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" hint="nome@esempio.it" error={shown('email')} />
        <View style={A.sep} />
        <AuthInput
          label="Password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry={!show}
          autoCapitalize="none"
          textContentType="newPassword"
          hint="Almeno 8 caratteri"
          error={shown('pw')}
          right={
            <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityRole="button" accessibilityLabel={show ? 'Nascondi la password' : 'Mostra la password'}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={21} color="rgba(255,255,255,0.6)" />
            </Pressable>
          }
        />
        <View style={A.sep} />
        <AuthInput label="Ripeti la password" value={pw2} onChangeText={setPw2} secureTextEntry={!show} autoCapitalize="none" textContentType="newPassword" error={shown('pw2')} onSubmitEditing={submit} />
      </AuthPanel>
      {(['email', 'pw', 'pw2'] as const).map((k) => (shown(k) ? <Text key={k} style={A.err}>{shown(k)}</Text> : null))}
      {fail ? <Text style={A.err}>{fail}</Text> : null}
      <Text style={A.note}>Tutti i campi sono obbligatori.</Text>
      <Pressable style={({ pressed }) => [A.btn, (busy || pressed) && { opacity: busy ? 0.6 : 0.88 }]} onPress={submit} disabled={busy} accessibilityRole="button">
        <Text style={A.btnT}>{busy ? 'Un attimo…' : 'Crea account'}</Text>
      </Pressable>
      <Pressable onPress={onSwitch} style={A.switch} accessibilityRole="button">
        <Text style={A.muted}>Hai già un profilo? <Text style={{ color: A_GOLD, fontWeight: '700' }}>Accedi</Text></Text>
      </Pressable>
    </AuthShell>
  );
}

// Colori e stili fissi di Benvenuto e accesso (sempre su foto scura, qualunque sia il tema)
const A_GOLD = '#C4A868';
const A_RED = '#FF6B61';
const A = StyleSheet.create({
  heTitle: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center', marginTop: 24 },
  heSub: { color: 'rgba(255,255,255,0.74)', textAlign: 'center', marginTop: 12 },
  heTap: { position: 'absolute', alignSelf: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '500', textAlign: 'center' },
  col: { width: '100%', maxWidth: 400, alignSelf: 'center' },
  logo: { alignSelf: 'center', marginBottom: 18 },
  title: { color: '#FFFFFF', fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.9, textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.68)', fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 8, marginBottom: 26, alignSelf: 'center', maxWidth: 320 },
  panel: { borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(28,28,30,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  row: { minHeight: 60, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, color: '#FFFFFF', fontSize: 17, paddingTop: 24, paddingBottom: 8, paddingHorizontal: 0 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginLeft: 16 },
  vsep: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)' },
  err: { color: A_RED, fontSize: 13.5, lineHeight: 18, marginTop: 8, paddingHorizontal: 6 },
  note: { color: 'rgba(255,255,255,0.55)', fontSize: 13, textAlign: 'center', marginTop: 16 },
  btn: { height: 52, borderRadius: 26, backgroundColor: A_GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  btnT: { color: '#14110D', fontSize: 17, fontWeight: '700', letterSpacing: 0.1 },
  link: { color: A_GOLD, fontSize: 16, fontWeight: '500' },
  switch: { marginTop: 20, alignItems: 'center', paddingVertical: 4 },
  muted: { color: 'rgba(255,255,255,0.66)', fontSize: 15, lineHeight: 22 },
  back: { position: 'absolute', left: 14, flexDirection: 'row', alignItems: 'center', height: 36, paddingLeft: 6, paddingRight: 14, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 5 },
  backT: { color: A_GOLD, fontSize: 17, fontWeight: '500' },
});

// Conferma a tutta pagina dopo la registrazione: rinvia e-mail, invia WhatsApp, accedi
function Registered({ info, onLogin }: { info: Done; onLogin: () => void }) {
  const insets = useSafeAreaInsets();
  const [wait, setWait] = useState(0);
  const [salonWa, setSalonWa] = useState<string | null>(null);
  // Il numero WhatsApp del salone si legge subito: il tocco sul pulsante apre WhatsApp senza attese (Safari blocca le aperture ritardate)
  useEffect(() => {
    supabase.from('salons').select('whatsapp').not('whatsapp', 'is', null).neq('whatsapp', '').limit(1)
      .then(({ data }) => setSalonWa((data as any)?.[0]?.whatsapp ?? null));
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const resend = async () => {
    if (info.active) return Alert.alert('Account già attivo', 'Non serve confermare l’e-mail: puoi accedere subito.');
    const { error } = await supabase.auth.resend({ type: 'signup', email: info.email, options: { emailRedirectTo: redirectTo } });
    if (error) return Alert.alert('Non riesco a inviare', 'Aspetta un minuto e riprova.');
    setWait(60);
    Alert.alert('E-mail inviata', `Ti abbiamo scritto di nuovo a ${info.email}.`);
  };
  // Apre WhatsApp con un messaggio già scritto per il salone (se il numero non è ancora impostato, scegli tu il contatto)
  const whatsapp = () => {
    openUrl(waUrl(salonWa, `Ciao DF Barbershop! Sono ${info.first} ${info.last}, mi sono appena registrato all’app con l’e-mail ${info.email} (tel. ${info.phone}).`));
  };

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onLogin}>
      <View style={s.doneRoot}>
        <ScrollView contentContainerStyle={[s.doneBody, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={s.doneIcon}>
            <Ionicons name="checkmark" size={54} color={C.onAccent} />
          </View>
          <Text style={s.doneKicker}>Registrazione completata</Text>
          <Text style={s.doneTitle}>Grazie, {info.first}!</Text>
          {info.active ? (
            <Text style={s.doneSub}>Il tuo account è pronto: puoi accedere subito e prenotare il tuo prossimo taglio.</Text>
          ) : (
            <>
              <Text style={s.doneSub}>Ti abbiamo inviato un’e-mail di conferma a</Text>
              <Text style={s.doneMail}>{info.email}</Text>
              <Text style={s.doneSub}>Aprila e tocca il link per attivare l’account, poi accedi. Se non la trovi, guarda anche nello spam.</Text>
            </>
          )}

          <View style={{ width: '100%', maxWidth: 420, marginTop: 34 }}>
            <View style={s.grp}>
              <Pressable onPress={resend} disabled={wait > 0} style={({ pressed }) => [s.grpRow, (wait > 0 || pressed) && { opacity: wait > 0 ? 0.5 : 0.8 }]}>
                <View style={s.menuIcon}><Ionicons name="mail" size={18} color={C.onAccent} /></View>
                <Text style={[s.rowT, { flex: 1, marginLeft: 14 }]}>{wait > 0 ? `Rinvia e-mail (${wait}s)` : 'Rinvia e-mail'}</Text>
              </Pressable>
              <View style={s.grpSep} />
              <Pressable onPress={whatsapp} style={({ pressed }) => [s.grpRow, pressed && { opacity: 0.8 }]}>
                <View style={s.menuIcon}><Ionicons name="logo-whatsapp" size={18} color={C.onAccent} /></View>
                <Text style={[s.rowT, { flex: 1, marginLeft: 14 }]}>Invia WhatsApp</Text>
              </Pressable>
            </View>
            <Pressable style={s.btn} onPress={onLogin}>
              <Text style={s.btnT}>Accedi</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Auth({ onHold }: { onHold: (v: boolean) => void }) {
  const [stage, setStage] = useState<'welcome' | 'in' | 'up'>('welcome');
  const [done, setDone] = useState<Done | null>(null);
  const [email0, setEmail0] = useState('');

  const finish = () => {
    const d = done;
    setDone(null);
    onHold(false); // se la sessione è già attiva si entra nell'app, altrimenti si resta sull'accesso
    if (d && !d.active) { setEmail0(d.email); setStage('in'); }
  };

  return (
    <View style={{ flex: 1 }}>
      {stage === 'welcome' && <Hello onNext={() => setStage('in')} />}
      {stage === 'in' && <LoginForm email0={email0} onBack={() => setStage('welcome')} onSwitch={() => setStage('up')} />}
      {stage === 'up' && <RegisterForm onBack={() => setStage('welcome')} onSwitch={() => setStage('in')} onHold={onHold} onDone={setDone} />}
      {done && <Registered info={done} onLogin={finish} />}
    </View>
  );
}

// ───────── Prenotazione ─────────
// Barbiere scelto con le foto, scorrendo in orizzontale
function BarberCard({ name, url, firstFree, fav, on, onPress }: { name: string; url?: string | null; firstFree?: boolean; fav?: boolean; on: boolean; onPress: () => void }) {
  const ini = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} style={[s.bCard, on && s.bCardOn]}>
      <View>
        {url && !firstFree ? (
          <Image source={{ uri: url }} style={s.bPhoto} />
        ) : (
          <View style={[s.bPhoto, { alignItems: 'center', justifyContent: 'center' }]}>
            {firstFree ? <Ionicons name="flash-outline" size={32} color={C.accentText} /> : <Text style={s.bIni}>{ini}</Text>}
          </View>
        )}
        {fav && (
          <View style={s.bFav}>
            <Ionicons name="star" size={11} color={C.onAccent} />
          </View>
        )}
        {on && (
          <View style={s.bCheck}>
            <Ionicons name="checkmark" size={14} color={C.onAccent} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={[s.bName, on && { color: C.accentText }]}>{name}</Text>
    </Pressable>
  );
}

// Storico del cliente con il barbiere scelto: appuntamenti passati e in programma, visite e punti guadagnati con lui
const hisState = (status: string): { t: string; c: string; i: string } | undefined =>
  ({
    completed: { t: 'Completato', c: C.muted, i: 'checkmark-circle-outline' },
    no_show: { t: 'Non presentato', c: C.danger, i: 'close-circle-outline' },
  } as Record<string, { t: string; c: string; i: string }>)[status];

function BarberHistory({ uid, staffId, name, photo }: { uid: string; staffId: string; name: string; photo?: string | null }) {
  const [rows, setRows] = useState<any[] | null>(null); // null = in caricamento
  const [points, setPoints] = useState<number | null>(0); // null = non disponibile
  const [visits, setVisits] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const first = name.split(' ')[0];

  useEffect(() => {
    let off = false;
    setRows(null);
    setFailed(false);
    setAll(false);
    setVisits(null);
    (async () => {
      const [a, b, c] = await Promise.all([
        supabase
          .from('appointments')
          .select('id,starts_at,status,salons(name,timezone),services(name)')
          .eq('customer_id', uid)
          .eq('staff_id', staffId)
          .neq('status', 'cancelled')
          .order('starts_at', { ascending: false })
          .limit(60),
        supabase.from('loyalty_ledger').select('credits').eq('user_id', uid).eq('staff_id', staffId).eq('kind', 'earn'),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('customer_id', uid).eq('staff_id', staffId).eq('status', 'completed'),
      ]);
      if (off) return;
      if (a.error) { setFailed(true); setRows([]); return; }
      setRows(a.data ?? []);
      setPoints(b.error ? null : (b.data ?? []).reduce((n: number, r: any) => n + r.credits, 0));
      setVisits(c.error ? null : c.count ?? null);
    })();
    return () => { off = true; };
  }, [uid, staffId]);

  const now = Date.now();
  const list = rows ?? [];
  const upcoming = list.filter((r) => r.status === 'confirmed' && new Date(r.starts_at).getTime() >= now).reverse(); // dal più vicino
  const past = list.filter((r) => !upcoming.includes(r));                                                          // dal più recente
  const done = list.filter((r) => r.status === 'completed');
  const shown = all ? past : past.slice(0, 4);
  const thisYear = new Date().getFullYear();
  const lastD = done.length ? new Date(done[0].starts_at) : null;
  const lastTz = done[0]?.salons?.timezone ?? 'Europe/Rome';
  const lastTxt = lastD
    ? lastD.toLocaleDateString('it-IT', lastD.getFullYear() !== thisYear ? { month: 'short', year: 'numeric', timeZone: lastTz } : { day: 'numeric', month: 'short', timeZone: lastTz })
    : '—';
  const nVisits = visits ?? done.length;

  const row = (r: any, soon: boolean) => {
    const d = new Date(r.starts_at);
    const st = hisState(r.status);
    const tz = r.salons?.timezone ?? 'Europe/Rome';
    return (
      <View key={r.id} style={[s.hisRow, soon && { backgroundColor: C.accentSoft }]}>
        <View style={[s.hisDate, soon && { backgroundColor: C.accent }]}>
          <Text style={[s.hisDay, soon && { color: C.onAccent }]}>{d.toLocaleDateString('it-IT', { day: 'numeric', timeZone: tz })}</Text>
          <Text style={[s.hisMon, soon && { color: C.onAccent }]}>{d.toLocaleDateString('it-IT', { month: 'short', timeZone: tz }).replace('.', '')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowT} numberOfLines={1}>{r.services?.name ?? 'Servizio'}</Text>
          <Text style={s.rowSub} numberOfLines={1}>
            {cap(d.toLocaleDateString('it-IT', { weekday: 'short', timeZone: tz }))} {hhmm(r.starts_at, tz)} · {r.salons?.name ?? ''}
            {d.getFullYear() !== thisYear ? ` · ${d.getFullYear()}` : ''}
          </Text>
        </View>
        {soon ? (
          <Text style={[s.hisTag, { color: C.accentText }]}>In programma</Text>
        ) : st ? (
          <View style={s.hisState}>
            <Ionicons name={st.i as any} size={15} color={st.c} />
            <Text style={[s.hisTag, { color: st.c }]}>{st.t}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ marginTop: 26 }}>
      <View style={s.hisHead}>
        <Avatar name={name} url={photo} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={s.hisKicker}>Il tuo storico</Text>
          <Text style={s.h2} numberOfLines={1}>Con {name}</Text>
        </View>
      </View>

      {rows === null ? (
        <ActivityIndicator color={C.accentText} style={{ marginVertical: 28 }} />
      ) : failed ? (
        <Text style={s.muted}>Non riesco a caricare lo storico adesso. Puoi prenotare lo stesso.</Text>
      ) : list.length === 0 ? (
        <View style={s.hisEmpty}>
          <Ionicons name="cut-outline" size={26} color={C.accentText} />
          <Text style={[s.rowT, { marginTop: 10, textAlign: 'center' }]}>Non sei ancora stato da {first}</Text>
          <Text style={[s.rowSub, { textAlign: 'center' }]}>
            Dopo il primo appuntamento troverai qui le vostre visite e i punti fedeltà guadagnati con lui.
          </Text>
        </View>
      ) : (
        <>
          <View style={s.hisStats}>
            <View style={s.hisTile}>
              <Text style={s.hisNum}>{nVisits}</Text>
              <Text style={s.hisLbl}>{nVisits === 1 ? 'visita' : 'visite'}</Text>
            </View>
            <View style={s.hisTile}>
              <Text style={[s.hisNum, { fontSize: 26 }]} numberOfLines={1} adjustsFontSizeToFit>{lastTxt}</Text>
              <Text style={s.hisLbl}>ultima volta</Text>
            </View>
            <View style={s.hisTile}>
              <Text style={s.hisNum}>{points ?? '—'}</Text>
              <Text style={s.hisLbl}>punti con lui</Text>
            </View>
          </View>

          {upcoming.length > 0 && (
            <>
              <Text style={s.hisSection}>{upcoming.length === 1 ? 'Prossimo appuntamento' : 'Prossimi appuntamenti'}</Text>
              {upcoming.map((r) => row(r, true))}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={s.hisSection}>Visite precedenti</Text>
              {shown.map((r) => row(r, false))}
              {past.length > 4 && (
                <Pressable onPress={() => setAll((v) => !v)} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 8 }}>
                  <Text style={{ color: C.accentText, fontWeight: '600' }}>{all ? 'Mostra meno' : `Mostra tutte (${past.length})`}</Text>
                </Pressable>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

function Book({ onBooked, staff, uid }: { onBooked: () => void; staff?: StaffScope; uid?: string }) {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const lastDay = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + HORIZON_DAYS); return d; }, [today]);

  const [stage, setStage] = useState<'pick' | 'calendar'>('pick');
  const [salons, setSalons] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [salon, setSalon] = useState<any>(null);
  const [service, setService] = useState<any>(null);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [staffSel, setStaffSel] = useState<string | null>(null); // null = da scegliere, 'any' = il primo disponibile
  const [prefStaff, setPrefStaff] = useState<string | null>(null);
  const staffId = staffSel && staffSel !== 'any' ? staffSel : null; // barbiere passato al database
  const scroller = useRef<ScrollView>(null);
  const pos = useRef<Record<string, number>>({});
  const [vh, setVh] = useState(600);
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [avail, setAvail] = useState<Set<string>>(new Set());
  const [availLoading, setAvailLoading] = useState(false);
  const [calLoaded, setCalLoaded] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [slot, setSlot] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [source, setSource] = useState<'manual' | 'treatwell'>('manual');
  const autoPick = useRef(false);

  // Sedi, servizi e sede preferita del cliente (già selezionata)
  useEffect(() => {
    (async () => {
      const [a, b, p] = await Promise.all([
        supabase.from('salons').select('id,name,address,timezone').eq('active', true).order('name'),
        supabase.from('services').select('id,name,category,duration_min,price_cents').eq('active', true).order('duration_min'),
        uid && !staff ? loadPrefs(uid) : Promise.resolve({ salon: null, staff: null }),
      ]);
      const list = (a.data ?? []).filter((x: any) => !staff?.salonIds || staff.salonIds.includes(x.id));
      const pref: string | null = (p as any).salon ?? null;
      setPrefStaff((p as any).staff ?? null);
      setSalons(list);
      setServices(b.data ?? []);
      setPrefId(pref);
      setSalon((cur: any) => cur ?? list.find((x: any) => x.id === pref) ?? (list.length === 1 ? list[0] : null));
    })();
  }, []);

  // Barbieri della sede che fanno il servizio scelto
  useEffect(() => {
    setStaffSel(null);
    setStaffList([]);
    if (!salon || !service) return;
    supabase
      .from('staff')
      .select('id,name,photo_url,staff_salons!inner(salon_id),staff_services!inner(service_id)')
      .eq('staff_salons.salon_id', salon.id)
      .eq('active', true)
      .eq('staff_services.service_id', service.id)
      .order('name')
      .then(({ data }) => setStaffList(data ?? []));
  }, [salon, service]);

  // Calendario: quali giorni del mese hanno almeno un orario libero
  useEffect(() => {
    if (stage !== 'calendar' || !salon || !service) return;
    let off = false;
    const from = month < today ? today : month;
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const to = end > lastDay ? lastDay : end;
    if (from > to) { setAvail(new Set()); setCalLoaded(true); return; }
    setAvailLoading(true);
    supabase
      .rpc('get_available_days', { p_salon: salon.id, p_service: service.id, p_from: ymd(from), p_to: ymd(to), p_staff: staffId })
      .then(({ data, error }) => {
        if (off) return;
        setAvailLoading(false);
        if (error) {
          autoPick.current = false;
          setCalLoaded(true);
          Alert.alert('Calendario non disponibile', 'Non riesco a caricare i giorni liberi. Controlla di aver eseguito la migrazione v4 nel database.');
          return;
        }
        const list: string[] = ((data as any[]) ?? []).map((r: any) => r.day).sort();
        setAvail(new Set(list));
        // Alla prima apertura seleziono subito il primo giorno libero (se il mese è vuoto passo al successivo)
        if (autoPick.current && !list.length && addMonths(month, 1) <= lastDay) {
          setMonth(addMonths(month, 1)); // mese vuoto: passo al successivo
          return;
        }
        if (autoPick.current && list.length) setDay(fromYmd(list[0]));
        autoPick.current = false;
        setCalLoaded(true);
      });
    return () => { off = true; };
  }, [stage, salon, service, staffId, month]);

  // Orari liberi del giorno scelto
  useEffect(() => {
    setSlot(null);
    setSlots([]);
    if (stage !== 'calendar' || !salon || !service || !day) return;
    let off = false;
    setLoading(true);
    supabase
      .rpc('get_available_slots', { p_salon: salon.id, p_service: service.id, p_day: ymd(day), p_staff: staffId })
      .then(({ data, error }) => {
        if (off) return;
        setLoading(false);
        if (error) return Alert.alert('Errore', errText(error));
        const seen = new Set<string>();
        setSlots((data ?? []).filter((r: any) => !seen.has(r.slot_start) && seen.add(r.slot_start)));
      });
    return () => { off = true; };
  }, [stage, salon, service, day, staffId]);

  const openCalendar = () => {
    autoPick.current = true;
    setDay(null);
    setSlot(null);
    setSlots([]);
    setAvail(new Set());
    setCalLoaded(false);
    setMonth(startOfMonth(today));
    setStage('calendar');
  };

  const book = async () => {
    if (!slot || !day) return;
    if (staff && !guestName.trim()) return Alert.alert('Manca il nome', 'Inserisci il nome del cliente.');
    setBusy(true);
    // Staff: inserimento diretto (telefono, passante, Treatwell). Cliente: funzione protetta.
    const { error } = staff
      ? await supabase.from('appointments').insert({
          salon_id: salon.id,
          staff_id: slot.staff_id,
          service_id: service.id,
          starts_at: slot.slot_start,
          ends_at: new Date(new Date(slot.slot_start).getTime() + service.duration_min * 60000).toISOString(),
          guest_name: guestName.trim(),
          guest_phone: guestPhone.trim() || null,
          source,
        })
      : await supabase.rpc('book_appointment', {
          p_salon: salon.id, p_staff: slot.staff_id, p_service: service.id, p_start: slot.slot_start,
        });
    setBusy(false);
    if (error) {
      setDay(new Date(day)); // ricarico orari e giorni liberi
      setMonth(new Date(month));
      return Alert.alert('Prenotazione non riuscita', errText(error));
    }
    const who = staffList.find((x) => x.id === slot.staff_id)?.name;
    Alert.alert('Prenotato', `${service.name} con ${who ?? 'il tuo barbiere'}, ${dayLabel(day)} alle ${hhmm(slot.slot_start, salon.timezone)}.`, [
      { text: 'Ok', onPress: () => { setStage('pick'); onBooked(); } },
    ]);
  };

  const barberName = staffId ? staffList.find((x) => x.id === staffId)?.name ?? 'Barbiere' : 'Il primo disponibile';
  const showBarber = !!salon && !!service;
  const canBook = showBarber && staffSel !== null; // "Prenota" compare solo dopo aver scelto il barbiere
  const chosen = staffId ? staffList.find((x) => x.id === staffId) : null;
  const showHis = !!chosen && !!uid && !staff; // lo storico è solo del cliente, con un barbiere preciso
  const orderedStaff = [...staffList].sort((a, b) => (a.id === prefStaff ? -1 : b.id === prefStaff ? 1 : 0));
  // Ogni scelta fa scorrere la pagina fino al passo successivo
  const mark = (k: string) => (e: LayoutChangeEvent) => { pos.current[k] = e.nativeEvent.layout.y; };
  const goTo = (k: string, tries = 0) => {
    setTimeout(() => {
      if (pos.current[k] == null) { if (tries < 4) goTo(k, tries + 1); return; } // la posizione del passo non è ancora nota
      scroller.current?.scrollTo({ y: Math.max(pos.current[k] + 14, 0), animated: true });
    }, 200);
  };

  // Griglia del mese, con la settimana che parte da lunedì
  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const arr: (Date | null)[] = Array(lead).fill(null);
    for (let i = 1; i <= n; i++) arr.push(new Date(month.getFullYear(), month.getMonth(), i));
    while (arr.length % 7) arr.push(null);
    return arr;
  }, [month]);
  const canPrev = month.getTime() > startOfMonth(today).getTime();
  const canNext = addMonths(month, 1) <= lastDay;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setVh(e.nativeEvent.layout.height)}>
      <ScrollView ref={scroller} contentContainerStyle={[s.pad, { paddingBottom: showBarber ? Math.max(vh - 210, 130) : 40 }]}>
        <View onLayout={mark('salon')}>
          <Step n={1} t="Sede" done={!!salon} />
          {salons.map((x) => (
            <Pressable key={x.id} onPress={() => { setSalon(x); goTo(service ? 'barber' : 'service'); }} style={[s.row, salon?.id === x.id && s.rowOn]}>
              <Ionicons name="location-outline" size={22} color={C.accentText} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.rowT}>{x.name}{x.id === prefId ? '  ★' : ''}</Text>
                {x.address ? <Text style={s.rowSub}>{x.address}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>

        {salon && (
          <View onLayout={mark('service')}>
            <Step n={2} t="Servizio" done={!!service} />
            {Object.entries(groupBy(services, 'category')).map(([cat, list]) => (
              <View key={cat} style={{ marginBottom: 10 }}>
                <Text style={s.cat}>{cat}</Text>
                {list.map((x) => (
                  <Pressable key={x.id} onPress={() => { setService(x); goTo('barber'); }} style={[s.row, service?.id === x.id && s.rowOn]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowT}>{x.name}</Text>
                      <Text style={s.rowSub}>{durLabel(x.duration_min)}</Text>
                    </View>
                    <Text style={s.price}>{eur(x.price_cents)}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        )}

        {showBarber && (
          <View onLayout={mark('barber')}>
            <Step n={3} t="Barbiere" done={staffSel !== null} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={s.pickRow}>
              <BarberCard name="Il primo disponibile" firstFree on={staffSel === 'any'} onPress={() => setStaffSel('any')} />
              {orderedStaff.map((x) => (
                <BarberCard key={x.id} name={x.name} url={x.photo_url} fav={x.id === prefStaff} on={staffSel === x.id} onPress={() => setStaffSel(x.id)} />
              ))}
            </ScrollView>
            {showHis && chosen ? (
              <BarberHistory uid={uid as string} staffId={chosen.id} name={chosen.name} photo={chosen.photo_url} />
            ) : staffSel === 'any' && uid && !staff ? (
              <Text style={[s.rowSub, { marginTop: 18, textAlign: 'center' }]}>
                Ti assegniamo il barbiere con il primo orario libero. Scegli un barbiere per vedere il vostro storico.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      {canBook && (
        <View style={s.bookBar}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowT} numberOfLines={1}>{service.name}</Text>
            <Text style={s.rowSub} numberOfLines={1}>{eur(service.price_cents)} · {durLabel(service.duration_min)} · {barberName}</Text>
          </View>
          <Pressable style={s.bookGo} onPress={openCalendar} accessibilityRole="button">
            <Text style={s.goT}>Prenota</Text>
            <Ionicons name="arrow-forward" size={16} color={C.onAccent} />
          </Pressable>
        </View>
      )}

      {/* Pagina del calendario, a tutto schermo */}
      <Modal visible={stage === 'calendar'} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setStage('pick')}>
        <KeyboardAvoidingView style={s.calRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.calTop, { paddingTop: insets.top + 8 }]}>
            <IconBtn name="chevron-back" onPress={() => setStage('pick')} label="Indietro" />
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>Prenota</Text>
              <Text style={s.calTitle} accessibilityRole="header">Data e orario</Text>
              <Text style={s.rowSub} numberOfLines={1}>{service?.name} · {barberName} · {salon?.name}</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={s.calBody} keyboardShouldPersistTaps="handled">
            <View style={s.calCard}>
              <View style={s.calHead}>
                <Pressable onPress={() => canPrev && setMonth(addMonths(month, -1))} disabled={!canPrev} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mese precedente" style={[s.calArrow, !canPrev && { opacity: 0.3 }]}>
                  <Ionicons name="chevron-back" size={18} color={C.text} />
                </Pressable>
                <View style={{ alignItems: 'center' }}>
                  <Text style={s.calMonth}>{cap(month.toLocaleDateString('it-IT', { month: 'long' }))}</Text>
                  <Text style={s.calYear}>{month.getFullYear()}</Text>
                </View>
                <Pressable onPress={() => canNext && setMonth(addMonths(month, 1))} disabled={!canNext} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mese successivo" style={[s.calArrow, !canNext && { opacity: 0.3 }]}>
                  <Ionicons name="chevron-forward" size={18} color={C.text} />
                </Pressable>
              </View>

              <View style={s.calGrid}>
                {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((w, i) => (
                  <View key={`w${i}`} style={s.calCellHead}><Text style={s.calWeekT}>{w}</Text></View>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <View key={`e${i}`} style={s.calCell} />;
                  const k = ymd(d);
                  const can = avail.has(k) && d >= today && d <= lastDay;
                  const sel = !!day && ymd(day) === k;
                  return (
                    <Pressable key={k} disabled={!can} onPress={() => setDay(d)} style={s.calCell}>
                      <View style={[s.calDay, k === ymd(today) && s.calToday, sel && s.calSel]}>
                        <Text style={[s.calNum, !can && s.calOff, sel && s.onT]}>{d.getDate()}</Text>
                      </View>
                      {can && !sel ? <View style={s.calDot} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              <View style={s.calLegend}>
                <View style={s.calDot2} />
                <Text style={s.rowSub}>Giorni con posti liberi</Text>
                {availLoading ? <ActivityIndicator size="small" color={C.accentText} style={{ marginLeft: 'auto' }} /> : null}
              </View>
            </View>

            <Text style={s.calSlotsTitle}>
              {day ? cap(day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })) : 'Orari liberi'}
            </Text>
            {!day ? (
              availLoading || !calLoaded ? null : (
                <Text style={s.muted}>Nessun giorno libero nei prossimi {HORIZON_DAYS} giorni per questa scelta. Prova un altro barbiere o un altro servizio.</Text>
              )
            ) : loading ? (
              <ActivityIndicator color={C.accentText} style={{ marginTop: 10 }} />
            ) : slots.length === 0 ? (
              <Text style={s.muted}>Nessun orario libero in questo giorno. Scegli un altro giorno.</Text>
            ) : (
              <Slots slots={slots} tz={salon.timezone} selected={slot?.slot_start ?? null} onPick={setSlot} />
            )}

            {slot && staff && (
              <>
                <Title t="Cliente" />
                <TextInput style={s.input} placeholder="Nome e cognome" placeholderTextColor={C.muted} value={guestName} onChangeText={setGuestName} />
                <TextInput style={s.input} placeholder="Telefono" placeholderTextColor={C.muted} keyboardType="phone-pad" value={guestPhone} onChangeText={setGuestPhone} />
                <View style={[s.wrap, { marginTop: 12 }]}>
                  <Chip label="Telefono o di passaggio" on={source === 'manual'} onPress={() => setSource('manual')} />
                  <Chip label="Da Treatwell" on={source === 'treatwell'} onPress={() => setSource('treatwell')} />
                </View>
              </>
            )}
          </ScrollView>

          <View style={[s.calBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={{ flex: 1 }}>
              {slot && day ? (
                <>
                  <Text style={s.rowT}>{cap(day.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }))} · {hhmm(slot.slot_start, salon.timezone)}</Text>
                  <Text style={s.rowSub}>{eur(service.price_cents)} · {durLabel(service.duration_min)}</Text>
                </>
              ) : (
                <Text style={s.rowSub}>Scegli un giorno e un orario</Text>
              )}
            </View>
            <Pressable style={[s.bookGo, (!slot || busy) && { opacity: 0.4 }]} disabled={!slot || busy} onPress={book}>
              <Text style={s.goT}>{busy ? 'Un attimo…' : staff ? 'Salva' : 'Conferma'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ───────── I miei appuntamenti ─────────
function Mine({ session, refreshKey }: { session: Session; refreshKey: number }) {
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('appointments')
      .select('id,starts_at,salons(name,timezone),services(name),staff(name)')
      .eq('customer_id', session.user.id)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');
    setRows(data ?? []);
  }, [session]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const cancel = (id: string) =>
    Alert.alert('Disdire l’appuntamento?', 'Il posto tornerà disponibile per altri clienti.', [
      { text: 'Tienilo', style: 'cancel' },
      {
        text: 'Disdici',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_appointment', { p_id: id });
          if (error) Alert.alert('Non posso disdire', errText(error));
          else load();
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <PageTitle t="La tua agenda" />
      {rows.length === 0 && <Text style={[s.muted, { marginTop: 14 }]}>Nessun appuntamento in programma. Prenota il tuo prossimo taglio dalla scheda Prenota.</Text>}
      {rows.map((r) => (
        <View key={r.id} style={[s.card, { flexDirection: 'row', gap: 14, marginTop: 14 }]}>
          <View style={s.badge}>
            <Text style={s.badgeN}>{new Date(r.starts_at).getDate()}</Text>
            <Text style={s.badgeM}>{new Date(r.starts_at).toLocaleDateString('it-IT', { month: 'short' })}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowT}>{hhmm(r.starts_at, r.salons.timezone)}, {r.services.name}</Text>
            <Text style={s.rowSub}>con {r.staff.name}, {r.salons.name}</Text>
            <Pressable onPress={() => cancel(r.id)} style={{ marginTop: 10 }} accessibilityRole="button">
              <Text style={[s.link, { color: C.danger }]}>Disdici</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Orders uid={session.user.id} />
    </ScrollView>
  );
}

// ───────── I miei ordini ─────────
function Orders({ uid }: { uid: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase
      .from('orders')
      .select('id,created_at,total_cents,fulfillment,fulfillment_status,salons(name),order_items(name,qty)')
      .eq('user_id', uid).eq('status', 'paid').order('created_at', { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, [uid]);
  if (rows.length === 0) return null;
  return (
    <>
      <Title t="I miei ordini" />
      {rows.map((o) => (
        <View key={o.id} style={s.card}>
          <Text style={s.rowT}>
            {new Date(o.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}, {eur(o.total_cents)}
          </Text>
          <Text style={s.rowSub}>{o.order_items.map((i: any) => `${i.qty} × ${i.name}`).join(', ')}</Text>
          <Text style={[s.rowSub, { color: C.accentText }]}>
            {o.fulfillment === 'shipping' ? 'Spedizione a domicilio' : `Ritiro: ${o.salons?.name ?? ''}`}, {o.fulfillment_status === 'done' ? (o.fulfillment === 'shipping' ? 'spedito' : 'consegnato') : 'in preparazione'}
          </Text>
        </View>
      ))}
    </>
  );
}

// ───────── Eliminazione account (richiesta da Apple) ─────────
function askDeleteAccount() {
  Alert.alert('Eliminare l’account?', 'Il tuo profilo e i tuoi dati personali saranno cancellati. Non si può annullare.', [
    { text: 'Annulla', style: 'cancel' },
    {
      text: 'Elimina account',
      style: 'destructive',
      onPress: async () => {
        const { error } = await supabase.rpc('delete_my_account');
        if (error) Alert.alert('Errore', errText(error));
        else await supabase.auth.signOut();
      },
    },
  ]);
}

// ───────── Ordini dello Shop (titolare e barbieri) ─────────
function OrdersAdmin() {
  const [done, setDone] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select('id,created_at,total_cents,fulfillment,customer_name,customer_phone,shipping_name,shipping_address,salons(name),order_items(name,qty)')
      .eq('status', 'paid').eq('fulfillment_status', done ? 'done' : 'new')
      .order('created_at', { ascending: false }).limit(50);
    setRows(data ?? []);
  }, [done]);
  useEffect(() => { load(); }, [load]);

  const finish = async (id: string) => {
    const { error } = await supabase.from('orders').update({ fulfillment_status: 'done' }).eq('id', id);
    if (error) Alert.alert('Errore', errText(error)); else load();
  };

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <View style={s.wrap}>
        <Chip label="Da evadere" on={!done} onPress={() => setDone(false)} />
        <Chip label="Evasi" on={done} onPress={() => setDone(true)} />
      </View>
      {rows.length === 0 && <Text style={[s.muted, { marginTop: 24 }]}>Nessun ordine.</Text>}
      {rows.map((o) => {
        const ship = o.fulfillment === 'shipping';
        const a = o.shipping_address;
        return (
          <View key={o.id} style={[s.card, { marginTop: 14 }]}>
            <Text style={s.rowT}>
              {new Date(o.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}, {eur(o.total_cents)}
            </Text>
            <Text style={s.rowSub}>{o.order_items.map((i: any) => `${i.qty} × ${i.name}`).join(', ')}</Text>
            <Text style={[s.rowSub, { color: C.accentText, marginTop: 6 }]}>{ship ? 'Spedizione a casa' : `Ritiro: ${o.salons?.name ?? ''}`}</Text>
            <Text style={s.rowSub}>{(ship ? o.shipping_name : o.customer_name) ?? 'Cliente'}{o.customer_phone ? `, ${o.customer_phone}` : ''}</Text>
            {ship && a && (
              <Text style={s.rowSub}>{[a.line1, a.line2, `${a.postal_code ?? ''} ${a.city ?? ''}`.trim(), a.state].filter(Boolean).join(', ')}</Text>
            )}
            {!done && (
              <Pressable onPress={() => finish(o.id)} style={{ marginTop: 10 }}>
                <Text style={s.link}>{ship ? 'Segna come spedito' : 'Segna come consegnato'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ───────── Ferie e assenze dei barbieri ─────────
function TimeOff({ staff, uid }: { staff: StaffScope; uid: string }) {
  const days = useMemo(
    () => Array.from({ length: 45 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }),
    []
  );
  const owner = staff.salonIds === null;
  const [people, setPeople] = useState<any[]>([]);
  const [who, setWho] = useState<any>(null);
  const [start, setStart] = useState<Date>(days[0]);
  const [n, setN] = useState(1);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let q = supabase.from('staff').select('id,name').eq('active', true).order('name');
    if (!owner) q = q.eq('user_id', uid); // il barbiere inserisce solo le proprie assenze
    q.then(({ data }) => { setPeople(data ?? []); setWho((data ?? [])[0] ?? null); });
  }, [owner, uid]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('time_off')
      .select('id,starts_at,ends_at,reason,staff(name)')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at');
    setRows(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!who) return;
    const end = new Date(start); end.setDate(end.getDate() + n);
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', who.id).neq('status', 'cancelled')
      .lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString());
    const doSave = async () => {
      const { error } = await supabase.from('time_off').insert({
        staff_id: who.id, starts_at: start.toISOString(), ends_at: end.toISOString(), reason: reason.trim() || null,
      });
      if (error) Alert.alert('Errore', errText(error)); else { setReason(''); load(); }
    };
    if (count) {
      Alert.alert('Ci sono già appuntamenti', `${count} appuntamenti cadono in questo periodo: vanno annullati o spostati a mano. Salvo comunque l’assenza?`, [
        { text: 'No', style: 'cancel' },
        { text: 'Salva comunque', onPress: doSave },
      ]);
    } else doSave();
  };

  const remove = (id: string) =>
    Alert.alert('Eliminare l’assenza?', undefined, [
      { text: 'No', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: async () => { await supabase.from('time_off').delete().eq('id', id); load(); } },
    ]);

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Title t="Chi" />
      <View style={s.wrap}>
        {people.map((x) => <Chip key={x.id} label={x.name} on={who?.id === x.id} onPress={() => setWho(x)} />)}
      </View>
      <Title t="Dal giorno" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => <Chip key={ymd(d)} label={dayLabel(d)} on={ymd(d) === ymd(start)} onPress={() => setStart(d)} />)}
      </ScrollView>
      <Title t="Per quanti giorni" />
      <View style={s.wrap}>
        {[1, 2, 3, 5, 7, 14].map((k) => (
          <Chip key={k} label={k === 1 ? '1 giorno' : `${k} giorni`} on={n === k} onPress={() => setN(k)} />
        ))}
      </View>
      <TextInput style={[s.input, { marginTop: 16 }]} placeholder="Motivo (facoltativo)" value={reason} onChangeText={setReason} />
      <Pressable style={s.btn} onPress={save}><Text style={s.btnT}>Salva assenza</Text></Pressable>

      <Title t="Assenze in programma" />
      {rows.length === 0 && <Text style={s.muted}>Nessuna assenza in programma.</Text>}
      {rows.map((r) => {
        const first = new Date(r.starts_at);
        const last = new Date(new Date(r.ends_at).getTime() - 1);
        return (
          <View key={r.id} style={s.card}>
            <Text style={s.chipT}>{r.staff.name}</Text>
            <Text style={s.chipSub}>
              {dayLabel(first)}{ymd(first) !== ymd(last) ? ` al ${dayLabel(last)}` : ''}{r.reason ? `, ${r.reason}` : ''}
            </Text>
            <Pressable onPress={() => remove(r.id)} style={{ marginTop: 10 }}>
              <Text style={[s.link, { color: C.danger }]}>Elimina</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ───────── Agenda per barbieri e titolare ─────────
// ───────── Agenda della sede: barbieri in colonna, orari in riga ─────────
// Pensata per il tablet fisso in negozio: tutta la giornata in una schermata, uno slot vuoto = un tocco per aggiungere.
const AG_TIME_W = 52;    // colonna degli orari
const AG_MIN_COL = 148;  // larghezza minima di un barbiere (con più barbieri si scorre di lato)
const AG_ROW = { comoda: 64, compatta: 44 } as const; // altezza di uno slot, in px
type AgDensity = keyof typeof AG_ROW;
type AgData = { salon: string; day: string; staff: any[]; hours: any[]; appts: any[]; off: any[]; services: any[]; links: any[] };
const NO_ROWS: any[] = [];

const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const mergeRanges = (list: [number, number][]) => {
  const out: [number, number][] = [];
  [...list].sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  });
  return out;
};

// Data (AAAA-MM-GG) e minuti dalla mezzanotte, "a muro" nel fuso della sede
function wall(at: string | number | Date, tz: string): { date: string; min: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { date: `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}-${p.find((x) => x.type === 'day')?.value}`, min: (g('hour') % 24) * 60 + g('minute') };
}
// Istante reale di un orario "a muro" della sede: giorno AAAA-MM-GG + minuti dalla mezzanotte
function wallToDate(day: string, min: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d, 0, min);
  let t = base;
  for (let i = 0; i < 2; i++) {
    const w = wall(t, tz);
    const [wy, wm, wd] = w.date.split('-').map(Number);
    t -= Date.UTC(wy, wm - 1, wd, 0, w.min) - base;
  }
  return new Date(t);
}

function Agenda({ staff }: { staff: StaffScope }) {
  const days = useMemo(
    () => Array.from({ length: 15 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 1); return d; }),
    []
  );
  const [salons, setSalons] = useState<any[]>([]);
  const [salon, setSalon] = useState<any>(null);
  const [day, setDay] = useState<Date>(days[1]);
  const [data, setData] = useState<AgData | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [dense, setDense] = useState<AgDensity>('comoda');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [add, setAdd] = useState<{ st: any; t: number; room: number; svc: any[] } | null>(null);
  const [open, setOpen] = useState<any>(null);
  const scroller = useRef<ScrollView>(null);
  const scrolled = useRef('');
  const stamp = useRef(0);

  useEffect(() => {
    supabase.from('salons').select('id,name,timezone,slot_step_min').eq('active', true).order('name').then(({ data }) => {
      const list = (data ?? []).filter((x: any) => !staff.salonIds || staff.salonIds.includes(x.id));
      setSalons(list);
      setSalon(list[0] ?? null);
    });
  }, [staff]);

  const tz: string = salon?.timezone ?? 'Europe/Rome';
  const step: number = salon?.slot_step_min || 30;
  const ROW = AG_ROW[dense];
  const dayS = ymd(day);
  const nowW = wall(now, tz);
  const isToday = nowW.date === dayS;

  // Carico barbieri, turni, appuntamenti e assenze del giorno. Gli appuntamenti sono quelli dei barbieri della sede
  // in tutte le sedi: un barbiere non può stare in due posti nello stesso momento.
  const load = useCallback(async () => {
    if (!salon) return;
    const me = ++stamp.current;
    const wd = ((day.getDay() + 6) % 7) + 1;
    const from = wallToDate(dayS, 0, salon.timezone).toISOString();
    const to = wallToDate(dayS, 1440, salon.timezone).toISOString();
    const st = await supabase.from('staff').select('id,name,photo_url,staff_salons!inner(salon_id)').eq('staff_salons.salon_id', salon.id).eq('active', true).order('name');
    const people: any[] = st.data ?? [];
    const ids = people.map((x) => x.id);
    if (!ids.length) { if (me === stamp.current) setData({ salon: salon.id, day: dayS, staff: [], hours: [], appts: [], off: [], services: [], links: [] }); return; }
    const [h, a, o, sv, ln] = await Promise.all([
      supabase.from('working_hours').select('staff_id,start_time,end_time').eq('salon_id', salon.id).eq('weekday', wd),
      supabase.from('appointments')
        .select('id,salon_id,staff_id,starts_at,ends_at,status,source,customer_id,reward_id,guest_name,guest_phone,profiles(full_name,phone),services(name,duration_min,price_cents),staff(name)')
        .in('staff_id', ids).gte('starts_at', from).lt('starts_at', to).neq('status', 'cancelled').order('starts_at'),
      supabase.from('time_off').select('staff_id,starts_at,ends_at,reason').in('staff_id', ids).lt('starts_at', to).gt('ends_at', from),
      supabase.from('services').select('id,name,category,duration_min,price_cents').eq('active', true).order('duration_min'),
      supabase.from('staff_services').select('staff_id,service_id').in('staff_id', ids),
    ]);
    if (me !== stamp.current) return; // nel frattempo è stato scelto un altro giorno o un'altra sede
    setData({ salon: salon.id, day: dayS, staff: people, hours: h.data ?? [], appts: a.data ?? [], off: o.data ?? [], services: sv.data ?? [], links: ln.data ?? [] });
  }, [salon, day]);

  useEffect(() => { setData(null); load(); }, [load]);
  // Il tablet resta acceso: ogni minuto aggiorno l'ora e i dati
  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const rewards = useRewards(data?.appts ?? NO_ROWS);

  const vm = useMemo(() => {
    if (!data || !salon || data.salon !== salon.id || data.day !== dayS) return null; // dati di un'altra sede o di un altro giorno
    const clampMin = (iso: string) => { const w = wall(iso, tz); return w.date < dayS ? 0 : w.date > dayS ? 1440 : w.min; };
    const cols = data.staff.map((st) => {
      const raw = data.hours.filter((x) => x.staff_id === st.id).map((x) => [toMin(x.start_time), toMin(x.end_time)] as [number, number]).sort((a, b) => a[0] - b[0]);
      const appts = data.appts.filter((x) => x.staff_id === st.id).map((x) => { const s0 = clampMin(x.starts_at); return { r: x, s: s0, e: Math.max(clampMin(x.ends_at), s0 + 1), other: x.salon_id !== salon.id }; });
      const off = data.off.filter((x) => x.staff_id === st.id).map((x) => ({ r: x, s: clampMin(x.starts_at), e: clampMin(x.ends_at) })).filter((x) => x.e > x.s);
      const svc = data.links.filter((l) => l.staff_id === st.id).map((l) => data.services.find((x) => x.id === l.service_id)).filter(Boolean) as any[];
      const minDur = svc.length ? Math.min(...svc.map((x) => x.duration_min)) : step;
      const busy: { s: number; e: number }[] = [...appts, ...off];
      const seen = new Set<number>();
      const slots: { t: number; room: number }[] = [];
      // Gli orari liberi sono gli stessi che il database offre ai clienti: partono dall'inizio di ogni turno, a passi di "step"
      raw.forEach(([a, b]) => {
        for (let t = a; t + minDur <= b; t += step) {
          if (seen.has(t) || busy.some((x) => x.s <= t && t < x.e)) continue;
          const next = Math.min(b, ...busy.filter((x) => x.s > t).map((x) => x.s));
          if (next - t < minDur) continue;
          seen.add(t); slots.push({ t, room: next - t });
        }
      });
      return { st, shifts: mergeRanges(raw), appts, off, slots, svc };
    });
    // Orari coperti da almeno un turno o appuntamento; i vuoti in mezzo (la pausa pranzo) diventano una sola riga
    const cov = mergeRanges(cols.flatMap((c) => [...c.shifts, ...c.appts.map((x) => [x.s, x.e] as [number, number])].map(([a, b]) => [a, b] as [number, number])));
    if (!cov.length) return { cols, lo: 0, hi: 0, gaps: [] as { a: number; b: number }[], rows: [] as number[] };
    const lo = Math.floor(cov[0][0] / step) * step;
    const hi = Math.ceil(cov[cov.length - 1][1] / step) * step;
    const gaps: { a: number; b: number }[] = [];
    for (let i = 1; i < cov.length; i++) {
      const a = Math.ceil(cov[i - 1][1] / step) * step;
      const b = Math.floor(cov[i][0] / step) * step;
      if (b - a >= Math.max(60, 2 * step)) gaps.push({ a, b });
    }
    const rows: number[] = [];
    for (let t = lo; t < hi; t += step) if (!gaps.some((g) => t >= g.a && t < g.b)) rows.push(t);
    return { cols, lo, hi, gaps, rows };
  }, [data, tz, dayS, step, salon?.id]);

  const past = (t: number, len: number) => dayS < nowW.date || (isToday && t + len <= nowW.min);
  const PAUSE_H = dense === 'comoda' ? 52 : 36; // altezza della riga di pausa
  // Posizione verticale di un orario: le pause occupano solo PAUSE_H invece di tutte le righe che coprirebbero
  const y = (min: number) => {
    if (!vm) return 0;
    let cut = 0;
    for (const g of vm.gaps) {
      if (min >= g.b) { cut += ((g.b - g.a) / step) * ROW - PAUSE_H; continue; }
      if (min > g.a) return ((g.a - vm.lo) / step) * ROW - cut + ((min - g.a) / (g.b - g.a)) * PAUSE_H;
      break;
    }
    return ((min - vm.lo) / step) * ROW - cut;
  };
  const n = vm?.cols.length ?? 0;
  const colW = n ? Math.max(AG_MIN_COL, Math.floor((box.w - AG_TIME_W) / n)) : 0;
  const contentW = AG_TIME_W + colW * n;
  const totalH = vm ? y(vm.hi) : 0;
  const rowsN = vm ? vm.rows.length : 0;

  // Prima apertura del giorno: scorro fino all'ora attuale
  useEffect(() => {
    const k = `${salon?.id}|${dayS}|${dense}`;
    if (!vm || !rowsN || !box.h || scrolled.current === k) return;
    scrolled.current = k;
    const to = isToday ? Math.max(0, y(nowW.min) - ROW * 1.5) : 0;
    setTimeout(() => scroller.current?.scrollTo({ y: to, animated: false }), 60);
  }, [vm, dense, box.h]);

  const counts = useMemo(() => {
    if (!vm) return { booked: 0, free: 0 };
    return {
      booked: vm.cols.reduce((a, c) => a + c.appts.filter((x) => !x.other).length, 0),
      free: vm.cols.reduce((a, c) => a + c.slots.filter((x) => !past(x.t, Math.min(step, x.room))).length, 0),
    };
  }, [vm, nowW.min, dayS]);

  const { width: winW } = useWindowDimensions();
  const wide = winW >= 900; // c'è spazio per titolo e conteggi accanto alle sedi
  const dayName = cap(day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }));
  const head = (
    <>
      <Text style={s.agTitle} numberOfLines={1}>{dayName}</Text>
      {vm && rowsN ? (
        <Text style={s.rowSub} numberOfLines={1}>
          {counts.booked} {counts.booked === 1 ? 'appuntamento' : 'appuntamenti'}{dayS < nowW.date ? '' : ` · ${counts.free} ${counts.free === 1 ? 'libero' : 'liberi'}`}
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={s.agBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
            {salons.map((x) => (
              <Chip key={x.id} label={x.name} on={salon?.id === x.id} onPress={() => setSalon(x)} />
            ))}
          </ScrollView>
          {wide ? <View style={{ alignItems: 'flex-end', marginRight: 6 }}>{head}</View> : null}
          <IconBtn name={dense === 'comoda' ? 'contract-outline' : 'expand-outline'} onPress={() => setDense(dense === 'comoda' ? 'compatta' : 'comoda')} label={dense === 'comoda' ? 'Mostra più orari' : 'Mostra più dettagli'} />
          <IconBtn name="refresh-outline" onPress={() => { setNow(new Date()); load(); }} label="Aggiorna" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {days.map((d) => {
            const on = ymd(d) === dayS;
            return (
              <Pressable key={ymd(d)} onPress={() => setDay(d)} style={[s.agDay, on && s.chipOn]} accessibilityRole="button" accessibilityLabel={d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}>
                <Text style={[s.agDayW, on && s.onT]}>{d.toLocaleDateString('it-IT', { weekday: 'short' })}</Text>
                <Text style={[s.agDayN, on && s.onT]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {wide ? null : <View style={{ alignItems: 'flex-start' }}>{head}</View>}
      </View>

      <View style={{ flex: 1, marginTop: 10 }} onLayout={(e: LayoutChangeEvent) => { const { width: w, height: h } = e.nativeEvent.layout; setBox((b) => (b.w === w && b.h === h ? b : { w, h })); }}>
        {!salon || !vm || !box.h ? (
          <ActivityIndicator color={C.accentText} style={{ marginTop: 40 }} />
        ) : !rowsN ? (
          <Text style={[s.muted, { padding: 20 }]}>
            {vm.cols.length === 0 ? 'Nessun barbiere attivo in questa sede.' : 'Nessun turno in questo giorno: la sede è chiusa.'}
          </Text>
        ) : (
          <ScrollView horizontal scrollEnabled={contentW > box.w} showsHorizontalScrollIndicator={contentW > box.w} style={{ flexGrow: 0 }}>
            <ScrollView ref={scroller} style={{ width: contentW, height: box.h }} stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false}>
              {/* Barbieri (resta fissa in alto mentre si scorre) */}
              <View style={s.agHeadRow}>
                <View style={{ width: AG_TIME_W }} />
                {vm.cols.map((c) => (
                  <View key={c.st.id} style={[s.agHead, { width: colW }]}>
                    <Avatar name={c.st.name} url={c.st.photo_url} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={s.agHeadName}>{c.st.name}</Text>
                      <Text numberOfLines={1} style={s.agHeadSub}>
                        {!c.shifts.length && !c.appts.length
                          ? 'Non in turno'
                          : `${c.appts.filter((x) => !x.other).length} app.${dayS < nowW.date ? '' : ` · ${c.slots.filter((x) => !past(x.t, Math.min(step, x.room))).length} liberi`}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', height: totalH, width: contentW }}>
                <View style={{ width: AG_TIME_W, height: totalH }}>
                  {vm.rows.map((t) => <Text key={t} style={[s.agTime, t % 60 === 0 && s.agTimeH, { top: y(t) + 4 }]}>{hm(t)}</Text>)}
                </View>

                {vm.cols.map((c) => (
                  <View key={c.st.id} style={[s.agCol, { width: colW, height: totalH }]}>
                    {c.shifts.map(([a, b], i) => (
                      <View key={`w${i}`} pointerEvents="none" style={[s.agShift, { top: y(Math.max(a, vm.lo)), height: y(Math.min(b, vm.hi)) - y(Math.max(a, vm.lo)) }]} />
                    ))}
                    {vm.rows.map((t) => (
                      <View key={`l${t}`} pointerEvents="none" style={[s.agLine, t % 60 === 0 && s.agLineH, { top: y(t) }]} />
                    ))}

                    {c.off.map((o, i) => {
                      const top = y(Math.max(o.s, vm.lo)); const h = y(Math.min(o.e, vm.hi)) - top;
                      if (h <= 0) return null;
                      return (
                        <View key={`o${i}`} style={[s.agOff, { top, height: h }]}>
                          <Ionicons name="moon-outline" size={14} color={C.muted} />
                          <Text style={s.agOffT} numberOfLines={2}>{o.r.reason || 'Assente'}</Text>
                        </View>
                      );
                    })}

                    {c.slots.map(({ t, room }) => {
                      const len = Math.min(step, room);
                      const gone = past(t, len);
                      return (
                        <Pressable
                          key={`f${t}`}
                          disabled={gone}
                          onPress={() => setAdd({ st: c.st, t, room, svc: c.svc })}
                          accessibilityRole="button"
                          accessibilityLabel={`Aggiungi appuntamento con ${c.st.name} alle ${hm(t)}`}
                          style={[s.agSlot, gone && s.agSlotOff, { top: y(t) + 2, height: (len / step) * ROW - 4 }]}
                        >
                          {gone ? null : <Ionicons name="add" size={18} color={C.accentText} />}
                          <Text style={[s.agSlotT, gone && { color: C.muted }]}>{hm(t)}</Text>
                        </Pressable>
                      );
                    })}

                    {c.appts.map((x) => {
                      const top = y(x.s) + 1; const h = Math.max(y(x.e) - y(x.s) - 2, 18);
                      if (x.other) {
                        return (
                          <View key={x.r.id} style={[s.agBlk, s.agBlkOther, { top, height: h }]}>
                            <Text style={s.agBlkSvc} numberOfLines={1}>{hm(x.s)} · In altra sede</Text>
                          </View>
                        );
                      }
                      const r = x.r;
                      const who = r.profiles?.full_name ?? r.guest_name ?? 'Cliente';
                      const tel = r.profiles?.phone ?? r.guest_phone;
                      const lines = h >= 56 ? 3 : h >= 36 ? 2 : 1;
                      const done = r.status === 'completed';
                      const miss = r.status === 'no_show';
                      const gift = !!r.reward_id || (r.status === 'confirmed' && rewards.has(r.customer_id));
                      return (
                        <Pressable
                          key={r.id}
                          onPress={() => setOpen(r)}
                          accessibilityRole="button"
                          accessibilityLabel={`${hm(x.s)} ${who}, ${r.services?.name ?? ''}. Apri`}
                          style={[s.agBlk, done && s.agBlkDone, miss && s.agBlkMiss, { top, height: h }]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <Text style={s.agBlkWho} numberOfLines={1}>
                              <Text style={s.agBlkTime}>{hm(x.s)}</Text>{'  '}{who}
                            </Text>
                            {done ? <Ionicons name="checkmark-circle" size={15} color={C.ok} /> : null}
                            {miss ? <Ionicons name="close-circle" size={15} color={C.danger} /> : null}
                            {gift ? <Ionicons name="gift-outline" size={14} color={C.accentText} /> : null}
                            {r.source === 'treatwell' ? <Text style={s.agTag}>{colW >= 190 ? 'TREATWELL' : 'TW'}</Text> : null}
                          </View>
                          {lines >= 2 ? <Text style={s.agBlkSvc} numberOfLines={1}>{r.services?.name}{lines >= 3 || h >= 46 ? ` · ${durLabel(x.e - x.s)}` : ''}</Text> : null}
                          {lines >= 3 && tel ? <Text style={s.agBlkSvc} numberOfLines={1}>{tel}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}

                {/* Pausa: una sola riga per tutti i barbieri */}
                {vm.gaps.map((g) => (
                  <View key={`p${g.a}`} pointerEvents="none" style={[s.agPause, { top: y(g.a), height: PAUSE_H, width: contentW }]}>
                    <Ionicons name="restaurant-outline" size={16} color={C.muted} />
                    <Text style={s.agPauseT} numberOfLines={1}>{g.a >= 11 * 60 && g.b <= 16 * 60 ? 'Pausa pranzo' : 'Pausa'} · {hm(g.a)}–{hm(g.b)}</Text>
                  </View>
                ))}

                {/* Ora attuale */}
                {isToday && nowW.min >= vm.lo && nowW.min <= vm.hi ? (
                  <View pointerEvents="none" style={[s.agNow, { top: y(nowW.min) - 1 }]}>
                    <View style={s.agNowDot} />
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </ScrollView>
        )}
      </View>

      {add && salon ? (
        <AgAdd
          st={add.st} t={add.t} room={add.room} svc={add.svc} day={day} dayS={dayS} tz={tz} salon={salon}
          onClose={() => setAdd(null)}
          onSaved={() => { setAdd(null); load(); }}
          onFail={load}
        />
      ) : null}
      {open ? (
        <AgDetail r={open} tz={tz} hasReward={rewards.has(open.customer_id)} onClose={() => setOpen(null)} reload={() => { setOpen(null); load(); }} />
      ) : null}
    </View>
  );
}

// Nuovo appuntamento da uno slot vuoto: barbiere e orario sono già scelti
function AgAdd({ st, t, room, svc, day, dayS, tz, salon, onClose, onSaved, onFail }: {
  st: any; t: number; room: number; svc: any[]; day: Date; dayS: string; tz: string; salon: any;
  onClose: () => void; onSaved: () => void; onFail: () => void;
}) {
  const { height } = useWindowDimensions();
  const [service, setService] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<'manual' | 'treatwell'>('manual');
  const [busy, setBusy] = useState(false);
  const fits = (x: any) => x.duration_min <= room;

  const save = async () => {
    if (!service) return Alert.alert('Manca il servizio', 'Scegli il servizio.');
    if (!name.trim()) return Alert.alert('Manca il nome', 'Inserisci il nome del cliente.');
    setBusy(true);
    const start = wallToDate(dayS, t, tz);
    const { error } = await supabase.from('appointments').insert({
      salon_id: salon.id,
      staff_id: st.id,
      service_id: service.id,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + service.duration_min * 60000).toISOString(),
      guest_name: name.trim(),
      guest_phone: phone.trim() || null,
      source,
    });
    setBusy(false);
    if (error) { Alert.alert('Appuntamento non salvato', errText(error)); onFail(); return; }
    onSaved();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, s.agSheet]}>
<View style={s.grab} />
          <ScrollView style={{ maxHeight: Math.max(height * 0.82, 320) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={s.eyebrow}>Nuovo appuntamento</Text>
            <Text style={s.h2}>{st.name} · {hm(t)}</Text>
            <Text style={[s.rowSub, { marginBottom: 6 }]}>{dayLabel(day)} · libero fino alle {hm(t + room)}</Text>

            <Text style={[s.cat, { marginTop: 14 }]}>Servizio</Text>
            {svc.length === 0 ? <Text style={s.muted}>Questo barbiere non ha servizi assegnati.</Text> : null}
            {Object.entries(groupBy(svc, 'category')).map(([cat, list]) => (
              <View key={cat} style={{ marginBottom: 8 }}>
                <View style={s.wrap}>
                  {list.map((x) => {
                    const on = service?.id === x.id;
                    return (
                      <Pressable key={x.id} disabled={!fits(x)} onPress={() => setService(x)} style={[s.chip, on && s.chipOn, !fits(x) && { opacity: 0.35 }]} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !fits(x) }}>
                        <Text style={[s.chipT, on && s.onT]}>{x.name}</Text>
                        <Text style={[s.chipSub, on && s.onT]}>{fits(x) ? `${durLabel(x.duration_min)} · ${eur(x.price_cents)}` : 'Non c’è tempo'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <TextInput style={s.input} placeholder="Nome e cognome" placeholderTextColor={C.muted} value={name} onChangeText={setName} />
            <TextInput style={s.input} placeholder="Telefono (facoltativo)" placeholderTextColor={C.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <View style={[s.wrap, { marginTop: 12 }]}>
              <Chip label="Telefono o di passaggio" on={source === 'manual'} onPress={() => setSource('manual')} />
              <Chip label="Da Treatwell" on={source === 'treatwell'} onPress={() => setSource('treatwell')} />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable style={[s.prefBtn, { flex: 1, marginTop: 0 }]} onPress={onClose} accessibilityRole="button">
                <Text style={s.prefBtnT}>Annulla</Text>
              </Pressable>
              <Pressable style={[s.bookGo, { flex: 1, justifyContent: 'center' }, (busy || !service) && { opacity: 0.45 }]} disabled={busy} onPress={save} accessibilityRole="button">
                <Text style={s.goT}>{busy ? 'Un attimo…' : 'Salva'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Dettaglio di un appuntamento: chiamata, WhatsApp e azioni (completato, non presentato, premio, annulla)
function AgDetail({ r, tz, hasReward, onClose, reload }: { r: any; tz: string; hasReward: boolean; onClose: () => void; reload: () => void }) {
  const tel = r.profiles?.phone ?? r.guest_phone;
  const who = r.profiles?.full_name ?? r.guest_name ?? 'Cliente';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, s.agSheet]}>
<View style={s.grab} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>{r.staff?.name ?? 'Barbiere'}</Text>
            <Text style={s.h2} numberOfLines={1}>{who}</Text>
          </View>
          <IconBtn name="close" onPress={onClose} label="Chiudi" />
        </View>
        {tel ? (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <Pressable style={[s.prefBtn, { flex: 1, marginTop: 0 }]} onPress={() => openUrl(telUrl(tel))} accessibilityRole="button" accessibilityLabel={`Chiama ${tel}`}>
              <Ionicons name="call-outline" size={18} color={C.accentText} />
              <Text style={s.prefBtnT}>Chiama</Text>
            </Pressable>
            <Pressable style={[s.prefBtn, { flex: 1, marginTop: 0 }]} onPress={() => openUrl(waUrl(tel))} accessibilityRole="button" accessibilityLabel={`Scrivi su WhatsApp a ${tel}`}>
              <Ionicons name="logo-whatsapp" size={18} color={C.accentText} />
              <Text style={s.prefBtnT}>WhatsApp</Text>
            </Pressable>
          </View>
        ) : null}
        <ApptCard r={r} tz={tz} hasReward={hasReward} reload={reload} extra={`${durLabel(r.services?.duration_min ?? 0)} · ${eur(r.services?.price_cents ?? 0)}`} />
      </View>
    </Modal>
  );
}

// ───────── Avatar ─────────
function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={[base, { backgroundColor: C.card2 }]} />;
  const ini = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[base, { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: C.accentText, fontSize: Math.round(size * 0.4), fontWeight: '700' }}>{ini}</Text>
    </View>
  );
}

// ───────── Premi aperti dei clienti (per l'agenda dei barbieri) ─────────
function useRewards(rows: any[]) {
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));
    if (ids.length === 0) { setSet(new Set()); return; }
    supabase.from('loyalty_rewards').select('user_id').is('used_at', null).in('user_id', ids)
      .then(({ data }) => setSet(new Set((data ?? []).map((x: any) => x.user_id))));
  }, [rows]);
  return set;
}

// ───────── Scheda appuntamento (agenda sede e giornata del barbiere) ─────────
const APPT_STATE: Record<string, string> = { completed: 'Completato', no_show: 'Non presentato' };

function ApptCard({ r, tz, hasReward, reload, extra }: { r: any; tz: string; hasReward: boolean; reload: () => void; extra?: string }) {
  const who = r.profiles?.full_name ?? r.guest_name ?? 'Cliente';
  const tel = r.profiles?.phone ?? r.guest_phone;
  const origin = r.source === 'treatwell' ? 'Treatwell' : r.source === 'manual' ? 'inserito a mano' : null;

  const mark = async (status: 'completed' | 'no_show') => {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', r.id);
    if (error) Alert.alert('Errore', errText(error)); else reload();
  };
  const cancel = () =>
    Alert.alert('Annullare l’appuntamento?', 'Il posto tornerà libero.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Annulla appuntamento',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_appointment', { p_id: r.id });
          if (error) Alert.alert('Errore', errText(error)); else reload();
        },
      },
    ]);
  const reward = async () => {
    const { error } = await supabase.rpc('apply_reward', { p_appointment: r.id });
    if (error) Alert.alert('Premio non applicabile', 'Il cliente non ha un premio attivo, o è già stato applicato.');
    else reload();
  };

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Text style={s.timeBig}>{hhmm(r.starts_at, tz)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.rowT}>{r.services.name}</Text>
          <Text style={s.rowSub}>{who}{tel ? `, ${tel}` : ''}{origin ? `, ${origin}` : ''}</Text>
          {extra ? <Text style={s.rowSub}>{extra}</Text> : null}
        </View>
      </View>
      {r.reward_id ? <Text style={[s.rowSub, { color: C.accentText, marginTop: 10 }]}>Taglio gratis con il premio fedeltà</Text> : null}
      {r.status === 'confirmed' ? (
        <View style={[s.wrap, { marginTop: 12 }]}>
          <Pressable onPress={() => mark('completed')}><Text style={s.link}>Completato</Text></Pressable>
          <Pressable onPress={() => mark('no_show')}><Text style={s.link}>Non presentato</Text></Pressable>
          {hasReward && !r.reward_id ? <Pressable onPress={reward}><Text style={s.link}>Applica premio</Text></Pressable> : null}
          <Pressable onPress={cancel}><Text style={[s.link, { color: C.danger }]}>Annulla</Text></Pressable>
        </View>
      ) : (
        <Text style={[s.rowSub, { marginTop: 8 }]}>{APPT_STATE[r.status]}</Text>
      )}
    </View>
  );
}

// ───────── La mia giornata (agenda personale del barbiere) ─────────
function MyDay({ uid }: { uid: string }) {
  const days = useMemo(
    () => Array.from({ length: 15 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 1); return d; }),
    []
  );
  const [day, setDay] = useState<Date>(days[1]);
  const [ids, setIds] = useState<string[] | null>(null);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('staff').select('id').eq('user_id', uid).then(({ data }) => setIds((data ?? []).map((x: any) => x.id)));
  }, [uid]);

  const load = useCallback(async () => {
    if (!ids || ids.length === 0) return;
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const { data } = await supabase
      .from('appointments')
      .select('id,starts_at,status,source,customer_id,reward_id,guest_name,guest_phone,profiles(full_name,phone),services(name),salons(name,timezone)')
      .in('staff_id', ids)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .neq('status', 'cancelled')
      .order('starts_at');
    setRows(data ?? []);
  }, [ids, day]);
  useEffect(() => { load(); }, [load]);
  const rewards = useRewards(rows);

  if (ids && ids.length === 0) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <PageTitle t="La mia giornata" />
        <Text style={[s.muted, { marginTop: 14 }]}>Il tuo accesso non è ancora collegato a un barbiere. Il titolare deve collegarlo nella tabella staff (colonna user_id).</Text>
      </ScrollView>
    );
  }

  const todo = rows.filter((r) => r.status === 'confirmed').length;
  const done = rows.filter((r) => r.status === 'completed').length;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <PageTitle t="La mia giornata" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 14 }}>
        {days.map((d) => <DayTile key={ymd(d)} d={d} on={ymd(d) === ymd(day)} onPress={() => setDay(d)} />)}
      </ScrollView>
      <View style={[s.wrap, { marginTop: 18 }]}>
        {[['Appuntamenti', rows.length], ['Da svolgere', todo], ['Completati', done]].map(([l, n]) => (
          <View key={l as string} style={s.kpi}>
            <Text style={s.kpiBig}>{n as number}</Text>
            <Text style={s.rowSub}>{l as string}</Text>
          </View>
        ))}
      </View>
      {rows.length === 0 && <Text style={[s.muted, { marginTop: 24 }]}>Nessun appuntamento in questo giorno.</Text>}
      <View style={{ marginTop: 18 }}>
        {rows.map((r) => (
          <ApptCard key={r.id} r={r} tz={r.salons.timezone} hasReward={rewards.has(r.customer_id)} reload={load} extra={r.salons.name} />
        ))}
      </View>
    </ScrollView>
  );
}

// ───────── Barbieri (con foto) ─────────
function Barbers({ canEdit, uid }: { canEdit: boolean; uid?: string }) {
  const desk = useDesk();
  const [rows, setRows] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [favId, setFavId] = useState<string | null>(null);

  useEffect(() => { if (uid) loadPrefs(uid).then((p) => setFavId(p.staff)); }, [uid]);
  const toggleFav = async (st: any) => {
    if (!uid) return;
    const value = favId === st.id ? null : st.id;
    const ok = await savePref(uid, 'preferred_staff_id', value);
    if (!ok) return Alert.alert('Preferenza non salvata', PREF_ERR);
    setFavId(value);
  };

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('staff').select('id,name,photo_url,staff_salons(salons(name))').eq('active', true).order('name');
    setRows(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Solo il titolare: scegli una foto dalla galleria e la carico
  const pick = async (st: any) => {
    if (!canEdit) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setBusyId(st.id);
    try {
      const buf = await (await fetch(a.uri)).arrayBuffer();
      const type = a.mimeType ?? 'image/jpeg';
      const path = `${st.id}-${Date.now()}.${type.includes('png') ? 'png' : 'jpg'}`;
      const up = await supabase.storage.from('barbers').upload(path, buf, { contentType: type, upsert: true });
      if (up.error) throw up.error;
      const url = supabase.storage.from('barbers').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('staff').update({ photo_url: url }).eq('id', st.id);
      if (error) throw error;
      await load();
    } catch {
      Alert.alert('Foto non caricata', 'Controlla di aver eseguito la migrazione v2 e di essere entrato come titolare.');
    }
    setBusyId(null);
  };

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <PageTitle t="I nostri barbieri" sub={canEdit ? 'Tocca una foto per cambiarla.' : uid ? 'Tocca la stella per scegliere il tuo barbiere preferito.' : 'Il team di DF Barbershop.'} />
      <View style={[s.grid, desk && s.grid3]}>
        {rows.map((st) => (
          <Pressable key={st.id} style={[s.barber, desk && s.col3]} onPress={() => pick(st)}>
            {st.photo_url ? (
              <Image source={{ uri: st.photo_url }} style={s.barberPhoto} />
            ) : (
              <View style={[s.barberPhoto, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: C.accentText, fontSize: 46, fontWeight: '700' }}>
                  {st.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
            )}
            {busyId === st.id && <ActivityIndicator style={StyleSheet.absoluteFill} color={C.accentText} />}
            {canEdit && <View style={s.camera}><Ionicons name="camera" size={16} color={C.onAccent} /></View>}
            {uid ? (
              <Pressable style={s.favBtn} onPress={() => toggleFav(st)} hitSlop={8}>
                <Ionicons name={favId === st.id ? 'star' : 'star-outline'} size={18} color={C.accent} />
              </Pressable>
            ) : null}
            <Text style={s.barberName} numberOfLines={1}>{st.name}</Text>
            <Text style={s.prodDesc} numberOfLines={2}>
              {st.staff_salons.map((x: any) => x.salons.name).join(', ')}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// ───────── Carta fedeltà (nel Profilo del cliente) ─────────
function Loyalty({ uid, onBalance, between }: { uid: string; onBalance?: (n: number) => void; between?: ReactNode }) {
  const [cfg, setCfg] = useState<{ reward_credits: number; reward_name: string } | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('loyalty_settings').select('reward_credits,reward_name').eq('id', 1).maybeSingle(),
      supabase.from('loyalty_ledger').select('id,credits,kind,created_at,staff(name,photo_url)').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('loyalty_rewards').select('id').eq('user_id', uid).is('used_at', null),
    ]);
    setCfg(a.data ?? { reward_credits: 100, reward_name: 'Un taglio gratis' });
    setRows(b.data ?? []);
    setOpen((c.data ?? []).length);
    onBalance?.((b.data ?? []).reduce((n: number, r: any) => n + r.credits, 0));
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  if (!cfg) return <View><ActivityIndicator style={{ marginVertical: 30 }} color={C.accentText} />{between}</View>;

  const need = cfg.reward_credits;
  const balance = rows.reduce((n, r) => n + r.credits, 0);
  const pct = Math.min(balance / need, 1);
  const reached = balance >= need;
  const earned = rows.filter((r) => r.kind === 'earn');
  const perBarber = Object.values(
    earned.reduce((acc: Record<string, any>, r) => {
      const k = r.staff?.name ?? 'Altro';
      acc[k] ||= { name: k, photo: r.staff?.photo_url, credits: 0, visits: 0 };
      acc[k].credits += r.credits;
      acc[k].visits += 1;
      return acc;
    }, {})
  ).sort((a: any, b: any) => b.credits - a.credits) as any[];
  const maxCr = Math.max(...perBarber.map((b) => b.credits), 1);

  const redeem = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('redeem_reward');
    setBusy(false);
    if (error) return Alert.alert('Errore', 'Non riesco a riscattare il premio. Riprova.');
    Alert.alert('Premio riscattato', 'Al tuo prossimo appuntamento il barbiere ti applicherà il taglio gratis.');
    load();
  };

  return (
    <View>
      <View style={s.loyHero}>
        <View style={s.heroTop}>
          <Text style={s.heroLabel}>Carta fedeltà</Text>
          <Ionicons name="ribbon-outline" size={22} color={C.accentText} />
        </View>
        <Text style={s.heroNum}>{balance}<Text style={s.heroOf}> / {need}</Text></Text>
        <Text style={s.rowSub}>punti accumulati</Text>
        <View style={s.stamps}>
          {Array.from({ length: 10 }, (_, i) => (
            <View key={i} style={[s.stamp, i < Math.floor(pct * 10 + 0.0001) && s.stampOn]}>
              {i < Math.floor(pct * 10 + 0.0001) && <Ionicons name="cut" size={13} color={C.onAccent} />}
            </View>
          ))}
        </View>
        <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%` }]} /></View>
        <Text style={[s.rowSub, { marginTop: 10 }]}>
          {reached ? `Obiettivo raggiunto: ${cfg.reward_name}` : `Ti mancano ${need - balance} punti per: ${cfg.reward_name}`}
        </Text>
        {reached && (
          <Pressable style={s.btn} onPress={redeem} disabled={busy}>
            <Text style={s.btnT}>{busy ? 'Un attimo…' : 'Riscatta il premio'}</Text>
          </Pressable>
        )}
        {open > 0 && (
          <Text style={[s.rowT, { color: C.accentText, marginTop: 14 }]}>
            Hai {open === 1 ? 'un premio attivo' : `${open} premi attivi`}: mostralo al barbiere al prossimo appuntamento.
          </Text>
        )}
      </View>

      {between}

      <Title t="Punti per barbiere" />
      {perBarber.length === 0 && <Text style={s.muted}>Appena completi un taglio, qui vedrai con quale barbiere hai guadagnato i tuoi punti.</Text>}
      {perBarber.map((b) => (
        <View key={b.name} style={[s.row, { marginBottom: 8 }]}>
          <Avatar name={b.name} url={b.photo} size={44} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={s.barHead}>
              <Text style={s.rowT}>{b.name}</Text>
              <Text style={s.price}>{b.credits}</Text>
            </View>
            <View style={[s.track, { marginTop: 6 }]}><View style={[s.fill, { width: `${(b.credits / maxCr) * 100}%` }]} /></View>
            <Text style={s.rowSub}>{b.visits} {b.visits === 1 ? 'visita' : 'visite'}</Text>
          </View>
        </View>
      ))}

      {rows.length > 0 && (
        <>
          <Title t="Ultimi movimenti" />
          {rows.slice(0, 8).map((r) => (
            <View key={r.id} style={[s.barHead, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowT}>{r.kind === 'earn' ? `Taglio con ${r.staff?.name ?? 'un barbiere'}` : r.kind === 'redeem' ? 'Premio riscattato' : 'Rettifica'}</Text>
                <Text style={s.rowSub}>{new Date(r.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </View>
              <Text style={[s.price, r.credits < 0 && { color: C.muted }]}>{r.credits > 0 ? `+${r.credits}` : r.credits}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// ───────── Preferiti del cliente (sede e barbiere) ─────────
async function loadPrefs(uid: string): Promise<{ salon: string | null; staff: string | null }> {
  const a: any = await supabase.from('profiles').select('preferred_salon_id,preferred_staff_id').eq('id', uid).maybeSingle();
  if (!a.error) return { salon: a.data?.preferred_salon_id ?? null, staff: a.data?.preferred_staff_id ?? null };
  // migrazione v5 non ancora eseguita: leggo almeno la sede preferita
  const b: any = await supabase.from('profiles').select('preferred_salon_id').eq('id', uid).maybeSingle();
  return { salon: b.data?.preferred_salon_id ?? null, staff: null };
}
async function savePref(uid: string, field: 'preferred_salon_id' | 'preferred_staff_id', value: string | null) {
  const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', uid);
  return !error;
}
const PREF_ERR = 'Non riesco a salvare la preferenza. Controlla di aver eseguito l’ultima migrazione del database (v5) e riprova.';

// ───────── Profilo del cliente ─────────
function Profile({ session }: { session: Session }) {
  const uid = session.user.id;
  const email0 = session.user.email ?? '';
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(email0);
  const [saved, setSaved] = useState({ first: '', last: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [salons, setSalons] = useState<any[]>([]);
  const [barbers, setBarbers] = useState<any[]>([]);
  const [pref, setPref] = useState<{ salon: string | null; staff: string | null }>({ salon: null, staff: null });

  useEffect(() => {
    (async () => {
      const a: any = await supabase.from('profiles').select('first_name,last_name,full_name,phone').eq('id', uid).maybeSingle();
      // se la migrazione v4 non è stata eseguita, leggo solo il nome completo
      const p: any = a.error ? (await supabase.from('profiles').select('full_name,phone').eq('id', uid).maybeSingle()).data : a.data;
      let f: string = p?.first_name ?? '';
      let l: string = p?.last_name ?? '';
      if (!f && !l && p?.full_name) {
        const parts = String(p.full_name).trim().split(/\s+/);
        f = parts[0] ?? '';
        l = parts.slice(1).join(' ');
      }
      setFirst(f); setLast(l); setPhone(p?.phone ?? '');
      setSaved({ first: f, last: l, phone: p?.phone ?? '' });
    })();
  }, [uid]);

  useEffect(() => {
    (async () => {
      const [a, b, p] = await Promise.all([
        supabase.from('salons').select('id,name').eq('active', true).order('name'),
        supabase.from('staff').select('id,name,photo_url').eq('active', true).order('name'),
        loadPrefs(uid),
      ]);
      setSalons(a.data ?? []);
      setBarbers(b.data ?? []);
      setPref(p);
    })();
  }, [uid]);

  const dirty = first.trim() !== saved.first || last.trim() !== saved.last || phone.trim() !== saved.phone;
  const emailChanged = email.trim().toLowerCase() !== email0.toLowerCase();
  const fullName = `${saved.first} ${saved.last}`.trim();

  const save = async () => {
    const miss: string[] = [];
    if (!first.trim()) miss.push('il nome');
    if (!last.trim()) miss.push('il cognome');
    if (!phoneOk(phone)) miss.push('un numero di telefono valido');
    if (!emailOk(email)) miss.push('un’e-mail valida');
    if (miss.length) return Alert.alert('Controlla i dati', `Inserisci ${miss.join(', ')}.`);
    setBusy(true);
    if (dirty) {
      const { error } = await supabase
        .from('profiles')
        .update({ first_name: first.trim(), last_name: last.trim(), full_name: `${first.trim()} ${last.trim()}`, phone: phone.trim() })
        .eq('id', uid);
      if (error) { setBusy(false); return Alert.alert('Non riesco a salvare', 'Riprova tra poco.'); }
      setSaved({ first: first.trim(), last: last.trim(), phone: phone.trim() });
    }
    if (emailChanged) {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      setBusy(false);
      if (error) {
        return Alert.alert('E-mail non cambiata', error.message.toLowerCase().includes('already') ? 'Questa e-mail è già usata da un altro account.' : 'Riprova tra poco.');
      }
      return Alert.alert('Controlla la posta', `Ti abbiamo inviato un link a ${email.trim()}: la nuova e-mail sarà attiva dopo la conferma.`);
    }
    setBusy(false);
    Alert.alert('Salvato', 'I tuoi dati sono aggiornati.');
  };

  // Un secondo tocco sulla scelta attuale toglie la preferenza
  const choose = async (field: 'salon' | 'staff', id: string) => {
    const value = pref[field] === id ? null : id;
    const ok = await savePref(uid, field === 'salon' ? 'preferred_salon_id' : 'preferred_staff_id', value);
    if (!ok) return Alert.alert('Preferenza non salvata', PREF_ERR);
    setPref((cur) => ({ ...cur, [field]: value }));
  };

  // Dati personali e preferenze: compaiono subito dopo la carta fedeltà
  const below = (
    <>
      <Title t="I tuoi dati" />
      <View style={s.card}>
        <View style={s.profRow}>
          <Avatar name={fullName || 'DF'} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={s.profName} numberOfLines={1}>{fullName || 'Il tuo profilo'}</Text>
            <Text style={s.rowSub} numberOfLines={1}>{email0}</Text>
          </View>
        </View>
        <Field label="Nome" value={first} onChangeText={setFirst} autoCapitalize="words" textContentType="givenName" />
        <Field label="Cognome" value={last} onChangeText={setLast} autoCapitalize="words" textContentType="familyName" />
        <Field label="Telefono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" />
        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
        <Pressable style={[s.btn, (!(dirty || emailChanged) || busy) && { opacity: 0.4 }]} onPress={save} disabled={!(dirty || emailChanged) || busy}>
          <Text style={s.btnT}>{busy ? 'Un attimo…' : 'Salva modifiche'}</Text>
        </Pressable>
      </View>

      <Title t="Le tue preferenze" />
      <View style={s.card}>
        <Text style={s.cat}>Sede preferita</Text>
        <View style={s.wrap}>
          {salons.map((x) => (
            <Chip key={x.id} label={`${pref.salon === x.id ? '★ ' : ''}${x.name}`} on={pref.salon === x.id} onPress={() => choose('salon', x.id)} />
          ))}
        </View>
        <Text style={[s.cat, { marginTop: 20 }]}>Barbiere preferito</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={s.pickRowCard}>
          {barbers.map((x) => (
            <BarberCard key={x.id} name={x.name} url={x.photo_url} fav={pref.staff === x.id} on={pref.staff === x.id} onPress={() => choose('staff', x.id)} />
          ))}
        </ScrollView>
        <Text style={[s.rowSub, { marginTop: 12 }]}>
          Quando prenoti, la sede preferita è già selezionata e il barbiere preferito è il primo della lista. Tocca di nuovo per toglierlo.
        </Text>
      </View>

      {Platform.OS === 'web' && <ThemePicker />}
    </>
  );

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <PageTitle t="Il tuo profilo" />
      <View style={{ height: 18 }} />
      <Loyalty uid={uid} between={below} />
    </ScrollView>
  );
}

// ───────── Contatti delle sedi ─────────
// Anteprima della mappa: tessere OpenStreetMap disegnate come immagini, senza chiavi né pacchetti aggiuntivi.
// Se la sede non ha coordinate nel database, si ricavano dall'indirizzo (e il titolare le salva aprendo questa scheda).
const MAP_ZOOM = 17;
const MAP_TILE = 160;
const MAP_H = 220;
const geoCache: Record<string, { lat: number; lng: number } | null> = {};
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (address in geoCache) return geoCache[address];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&viewbox=12.2,42.0,12.8,41.7&q=${encodeURIComponent(address)}`, {
      headers: Platform.OS === 'web' ? undefined : { 'User-Agent': 'DFBarbershopApp/1.0' },
    });
    const j = await r.json();
    geoCache[address] = j?.[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch {
    return null; // errore di rete: non lo memorizzo, si riprova alla prossima apertura
  }
  return geoCache[address];
}

function MapCard({ address, lat, lng, onLocated }: { address: string; lat?: number | null; lng?: number | null; onLocated?: (p: { lat: number; lng: number }) => void }) {
  const [w, setW] = useState(0);
  const [bad, setBad] = useState(0); // tessere non caricate
  const [pt, setPt] = useState<{ lat: number; lng: number } | null>(lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null);

  useEffect(() => {
    if (lat != null && lng != null) { setPt({ lat: Number(lat), lng: Number(lng) }); return; }
    let off = false;
    setPt(null);
    geocode(address).then((p) => {
      if (off || !p || !isFinite(p.lat) || !isFinite(p.lng)) return;
      setPt(p);
      onLocated?.(p);
    });
    return () => { off = true; };
  }, [address, lat, lng]);

  const tiles = useMemo(() => {
    if (!pt || !w) return [];
    const n = 2 ** MAP_ZOOM;
    const rad = (pt.lat * Math.PI) / 180;
    const cx = ((pt.lng + 180) / 360) * n;
    const cy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    const x0 = Math.floor(cx - w / 2 / MAP_TILE);
    const x1 = Math.floor(cx + w / 2 / MAP_TILE);
    const y0 = Math.floor(cy - MAP_H / 2 / MAP_TILE);
    const y1 = Math.floor(cy + MAP_H / 2 / MAP_TILE);
    const ox = Math.round(w / 2 - (cx - x0) * MAP_TILE);
    const oy = Math.round(MAP_H / 2 - (cy - y0) * MAP_TILE);
    const out: { key: string; uri: string; left: number; top: number }[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        out.push({
          key: `${tx}/${ty}`,
          uri: `https://tile.openstreetmap.org/${MAP_ZOOM}/${((tx % n) + n) % n}/${ty}.png`,
          left: ox + (tx - x0) * MAP_TILE,
          top: oy + (ty - y0) * MAP_TILE,
        });
      }
    }
    return out;
  }, [pt, w]);

  return (
    <Pressable onPress={() => openUrl(mapsSearch(address))} style={s.mapBox} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.mapA }]} />
      {tiles.length > 0 && bad <= tiles.length / 2 ? (
        <>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tiles.map((t) => (
              <Image
                key={t.key}
                source={Platform.OS === 'web' ? { uri: t.uri } : { uri: t.uri, headers: { 'User-Agent': 'DFBarbershopApp/1.0' } }}
                onError={() => setBad((b) => b + 1)}
                style={{ position: 'absolute', left: t.left, top: t.top, width: MAP_TILE, height: MAP_TILE }}
              />
            ))}
          </View>
          <View pointerEvents="none" style={s.pinWrap}>
            <View style={s.pinRing} />
            <View style={{ position: 'absolute', transform: [{ translateY: -22 }] }}>
              <Ionicons name="location" size={46} color={C.accentText} />
            </View>
          </View>
          <Text style={s.mapAttr}>© OpenStreetMap contributors</Text>
        </>
      ) : (
        <View style={s.mapFallback}>
          <Ionicons name="location" size={42} color={C.accentText} />
          <Text style={[s.rowSub, { textAlign: 'center', marginTop: 6 }]}>{address}</Text>
        </View>
      )}
      <View style={s.mapTag} pointerEvents="none">
        <Panel style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="navigate" size={14} color={C.accentText} />
          <Text style={s.mapTagT}>Apri in Google Maps</Text>
        </Panel>
      </View>
    </Pressable>
  );
}

// Solo il titolare: numeri di telefono e WhatsApp della sede
function ContactEditor({ salon, onSaved }: { salon: any; onSaved: () => void }) {
  const [phone, setPhone] = useState(salon.phone ?? '');
  const [wa, setWa] = useState(salon.whatsapp ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('salons').update({ phone: phone.trim() || null, whatsapp: wa.trim() || null }).eq('id', salon.id);
    setBusy(false);
    if (error) return Alert.alert('Non riesco a salvare', 'Controlla di aver eseguito la migrazione v4 e di essere entrato come titolare.');
    Alert.alert('Salvato', 'I contatti della sede sono aggiornati.');
    onSaved();
  };
  return (
    <View style={s.card}>
      <Text style={s.rowT}>Modifica contatti (solo titolare)</Text>
      <Field label="Telefono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+39 06 1234567" />
      <Field label="WhatsApp" value={wa} onChangeText={setWa} keyboardType="phone-pad" placeholder="+39 333 1234567" />
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
        <Text style={s.btnT}>{busy ? 'Un attimo…' : 'Salva contatti'}</Text>
      </Pressable>
    </View>
  );
}

function Contacts({ uid, canPrefer, canEdit }: { uid?: string; canPrefer: boolean; canEdit: boolean }) {
  const [salons, setSalons] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [hours, setHours] = useState<any[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    // dalle colonne più recenti a quelle di base, se qualche migrazione non è ancora stata eseguita
    let q: any = null;
    for (const cols of ['id,name,address,timezone,phone,whatsapp,email,lat,lng', 'id,name,address,timezone,phone,whatsapp', 'id,name,address,timezone']) {
      q = await supabase.from('salons').select(cols).eq('active', true).order('name');
      if (!q.error) break;
    }
    const list: any[] = q.data ?? [];
    let pref: string | null = null;
    if (uid && canPrefer) {
      const p: any = await supabase.from('profiles').select('preferred_salon_id').eq('id', uid).maybeSingle();
      pref = p.data?.preferred_salon_id ?? null;
    }
    setSalons(list);
    setPrefId(pref);
    setLoaded(true);
    setSelId((cur) => cur ?? (pref && list.some((x) => x.id === pref) ? pref : list[0]?.id ?? null));
  }, [uid, canPrefer]);
  useEffect(() => { load(); }, [load]);

  const sel = salons.find((x) => x.id === selId) ?? null;

  useEffect(() => {
    setHours(null);
    if (!selId) return;
    let off = false;
    supabase.rpc('get_salon_hours', { p_salon: selId }).then(({ data, error }) => { if (!off) setHours(error ? [] : data ?? []); });
    return () => { off = true; };
  }, [selId]);

  // Il titolare salva le coordinate ricavate dall'indirizzo, così i clienti non devono ricavarle
  const saveCoords = async (id: string, p: { lat: number; lng: number }) => {
    const { error } = await supabase.from('salons').update({ lat: p.lat, lng: p.lng }).eq('id', id);
    if (!error) load();
  };

  const setPreferred = async () => {
    if (!uid || !sel) return;
    const { error } = await supabase.from('profiles').update({ preferred_salon_id: sel.id }).eq('id', uid);
    if (error) return Alert.alert('Non riesco a salvare', 'Riprova tra poco.');
    setPrefId(sel.id);
  };

  // Aperto adesso? Giorno e ora si leggono nel fuso orario della sede
  const openNow = (() => {
    if (!sel || !hours) return null;
    const tz = sel.timezone ?? 'Europe/Rome';
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })) + 1;
    const t = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    return { wd, open: hours.some((h) => h.weekday === wd && h.start_time.slice(0, 5) <= t && t < h.end_time.slice(0, 5)) };
  })();

  const ordered = [...salons].sort((a, b) => (a.id === prefId ? -1 : b.id === prefId ? 1 : 0));
  const need = (what: string) => Alert.alert('Numero non disponibile', `Il numero ${what} di questa sede non è ancora stato inserito.`);

  if (!sel) {
    return loaded ? (
      <ScrollView contentContainerStyle={s.pad}>
        <PageTitle t="I nostri contatti" />
        <Text style={[s.muted, { marginTop: 14 }]}>Nessuna sede disponibile al momento.</Text>
      </ScrollView>
    ) : (
      <ActivityIndicator style={{ marginTop: 80 }} color={C.accentText} />
    );
  }

  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingBottom: 90 }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <PageTitle t="I nostri contatti" />
      <View style={[s.wrap, { marginTop: 14 }]}>
        {ordered.map((x) => (
          <Chip key={x.id} label={`${x.id === prefId ? '★ ' : ''}${x.name}`} on={x.id === selId} onPress={() => setSelId(x.id)} />
        ))}
      </View>

      <View style={[s.card, { marginTop: 16 }]}>
        <Text style={s.h2}>{sel.name}</Text>
        <View style={s.infoRow}>
          <Ionicons name="location-outline" size={18} color={C.accentText} />
          <Text style={s.infoT}>{sel.address ?? 'Indirizzo non disponibile'}</Text>
        </View>
        <View style={s.infoRow}>
          <Ionicons name="call-outline" size={18} color={C.accentText} />
          <Text style={s.infoT}>{sel.phone || 'Telefono non ancora disponibile'}</Text>
        </View>
        <View style={s.infoRow}>
          <Ionicons name="logo-whatsapp" size={18} color={C.accentText} />
          <Text style={s.infoT}>{sel.whatsapp || 'WhatsApp non ancora disponibile'}</Text>
        </View>
        {sel.email ? (
          <Pressable style={s.infoRow} onPress={() => openUrl(`mailto:${sel.email}`)}>
            <Ionicons name="mail-outline" size={18} color={C.accentText} />
            <Text style={s.infoT}>{sel.email}</Text>
          </Pressable>
        ) : null}
        {canPrefer && (
          sel.id === prefId ? (
            <Text style={[s.rowSub, { color: C.accentText, marginTop: 12 }]}>★ È la tua sede preferita: la trovi già selezionata quando prenoti.</Text>
          ) : (
            <Pressable onPress={setPreferred} style={s.prefBtn}>
              <Ionicons name="star-outline" size={16} color={C.accentText} />
              <Text style={s.prefBtnT}>Imposta come sede preferita</Text>
            </Pressable>
          )
        )}
      </View>

      <View style={s.actRow}>
        <Pressable style={{ flex: 1 }} onPress={() => (sel.phone ? openUrl(telUrl(sel.phone)) : need('di telefono'))}>
          <Panel style={s.actBtn}>
            <Ionicons name="call" size={24} color={C.accentText} />
            <Text style={s.actT}>Chiama</Text>
          </Panel>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => (sel.whatsapp ? openUrl(waUrl(sel.whatsapp)) : need('WhatsApp'))}>
          <Panel style={s.actBtn}>
            <Ionicons name="logo-whatsapp" size={24} color={C.accentText} />
            <Text style={s.actT}>WhatsApp</Text>
          </Panel>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => (sel.address ? openUrl(mapsRoute(sel.address)) : need('di indirizzo'))}>
          <Panel style={s.actBtn}>
            <Ionicons name="navigate" size={24} color={C.accentText} />
            <Text style={s.actT}>Navigazione</Text>
          </Panel>
        </Pressable>
      </View>

      <Title t="Orari di apertura" />
      <View style={s.card}>
        {hours === null ? (
          <ActivityIndicator color={C.accentText} />
        ) : hours.length === 0 ? (
          <Text style={s.muted}>Orari non disponibili al momento.</Text>
        ) : (
          <>
            {openNow && (
              <View style={s.openRow}>
                <View style={[s.openDot, { backgroundColor: openNow.open ? C.ok : C.danger }]} />
                <Text style={s.rowT}>{openNow.open ? 'Aperto ora' : 'Chiuso ora'}</Text>
              </View>
            )}
            {WEEKDAYS.map((name, i) => {
              const w = hours.filter((h) => h.weekday === i + 1);
              const today = openNow?.wd === i + 1;
              return (
                <View key={name} style={[s.hoursRow, i === 6 && { borderBottomWidth: 0 }]}>
                  <Text style={[s.hoursDay, today && { color: C.accentText }]}>{name}</Text>
                  <Text style={[s.hoursT, today && { color: C.accentText }, w.length === 0 && { color: C.muted }]}>
                    {w.length === 0 ? 'Chiuso' : w.map((h) => `${h.start_time.slice(0, 5)} – ${h.end_time.slice(0, 5)}`).join('   ')}
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </View>

      {sel.address ? (
        <>
          <Title t="Dove siamo" />
          <MapCard key={sel.id} address={sel.address} lat={sel.lat} lng={sel.lng} onLocated={canEdit ? (p) => saveCoords(sel.id, p) : undefined} />
        </>
      ) : null}

      {canEdit && (
        <>
          <Title t="Gestione" />
          <ContactEditor key={sel.id} salon={sel} onSaved={load} />
        </>
      )}
    </ScrollView>
  );
}

// ───────── Control room (titolare) ─────────
function ColChart({ data }: { data: { day: string; revenue: number }[] }) {
  const max = Math.max(...data.map((x) => x.revenue), 1);
  const lab = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return (
    <View>
      <View style={s.cols}>
        {data.map((x) => (
          <View key={x.day} style={s.colWrap}>
            <View style={[s.col, { height: x.revenue > 0 ? Math.max((x.revenue / max) * 120, 4) : 1 }]} />
          </View>
        ))}
      </View>
      {data.length > 0 && (
        <View style={s.barHead}>
          <Text style={s.rowSub}>{lab(data[0].day)}</Text>
          <Text style={s.rowSub}>{lab(data[data.length - 1].day)}</Text>
        </View>
      )}
    </View>
  );
}

function ControlRoom() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setD(null);
    supabase.rpc('control_room', { p_days: days }).then(({ data, error }) => {
      setFailed(!!error);
      if (!error) setD(data);
    });
  }, [days]);

  const periods = (
    <View style={s.wrap}>
      {[7, 30, 90].map((n) => <Chip key={n} label={`${n} giorni`} on={days === n} onPress={() => setDays(n)} />)}
    </View>
  );
  if (failed) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <PageTitle t="Control room" />
        <Text style={[s.muted, { marginTop: 14 }]}>Dati non disponibili. Controlla di aver eseguito la migrazione v2 nel database e di essere entrato come titolare.</Text>
      </ScrollView>
    );
  }
  if (!d) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <PageTitle t="Control room" />
        <View style={{ height: 14 }} />
        {periods}
        <ActivityIndicator style={{ marginTop: 60 }} color={C.accentText} />
      </ScrollView>
    );
  }

  const servicesTot = d.salons.reduce((n: number, x: any) => n + x.services, 0);
  const shopTot = d.salons.reduce((n: number, x: any) => n + x.shop, 0) + d.online;
  const cuts = d.salons.reduce((n: number, x: any) => n + x.cuts, 0);
  const total = servicesTot + shopTot;
  const maxSalon = Math.max(...d.salons.map((x: any) => x.services + x.shop), 1);
  const maxStaff = Math.max(...d.staff.map((x: any) => x.revenue), 1);
  const best = d.days.reduce((a: any, b: any) => (b.revenue > (a?.revenue ?? 0) ? b : a), null);

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <PageTitle t="Control room" />
      <View style={{ height: 14 }} />
      {periods}

      <View style={[s.loyHero, { marginTop: 18 }]}>
        <Text style={s.heroLabel}>Incasso totale, ultimi {days} giorni</Text>
        <Text style={[s.heroNum, { marginTop: 8 }]}>{eur(total)}</Text>
        <Text style={s.rowSub}>
          {cuts} servizi completati{best ? `, giorno migliore ${new Date(`${best.day}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} (${eur(best.revenue)})` : ''}
        </Text>
        <View style={[s.wrap, { marginTop: 14 }]}>
          <View style={s.kpi}><Text style={s.kpiBig}>{eur(servicesTot)}</Text><Text style={s.rowSub}>Servizi</Text></View>
          <View style={s.kpi}><Text style={s.kpiBig}>{eur(shopTot)}</Text><Text style={s.rowSub}>Shop</Text></View>
        </View>
      </View>

      <Title t="Incasso per sede" />
      <View style={[s.wrap, { marginBottom: 12 }]}>
        <Text style={[s.rowSub, { color: C.accentText }]}>● Servizi</Text>
        <Text style={[s.rowSub, { color: C.series2 }]}>● Shop</Text>
      </View>
      {d.salons.map((x: any) => (
        <View key={x.id} style={{ marginBottom: 16 }}>
          <View style={s.barHead}>
            <Text style={s.rowT}>{x.name}</Text>
            <Text style={s.price}>{eur(x.services + x.shop)}</Text>
          </View>
          <View style={[s.track, { marginTop: 6 }]}>
            <View style={[s.fill, { width: `${(x.services / maxSalon) * 100}%` }]} />
            <View style={[s.fill, { width: `${(x.shop / maxSalon) * 100}%`, backgroundColor: C.series2 }]} />
          </View>
        </View>
      ))}
      {d.online > 0 && <Text style={s.rowSub}>Vendite Shop con spedizione (non legate a una sede): {eur(d.online)}</Text>}

      <Title t="Chi rende di più" />
      {d.staff.map((x: any, i: number) => (
        <View key={x.id} style={[s.row, { marginBottom: 8 }]}>
          <Avatar name={x.name} url={x.photo_url} size={44} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={s.barHead}>
              <Text style={s.rowT}>{i === 0 && x.revenue > 0 ? `${x.name}  ★` : x.name}</Text>
              <Text style={s.price}>{eur(x.revenue)}</Text>
            </View>
            <View style={[s.track, { marginTop: 6 }]}><View style={[s.fill, { width: `${(x.revenue / maxStaff) * 100}%` }]} /></View>
            <Text style={s.rowSub}>{x.cuts} {x.cuts === 1 ? 'servizio' : 'servizi'}</Text>
          </View>
        </View>
      ))}

      <Title t="Andamento giornaliero" />
      <ColChart data={d.days} />

      <Text style={[s.rowSub, { marginTop: 24 }]}>
        Gli incassi dei servizi si registrano quando il barbiere segna l’appuntamento come Completato. I tagli gratuiti con il premio contano 0 €. Lo Shop conta gli ordini pagati.
      </Text>
    </ScrollView>
  );
}

// ───────── Altro (menu per titolare e barbieri) ─────────
function More({ owner, go }: { owner: boolean; go: (t: Tab) => void }) {
  const items: [Tab, string, string, string][] = [
    ...(owner ? [['myday', 'La mia giornata', 'today-outline', 'Se lavori anche come barbiere'] as [Tab, string, string, string]] : []),
    ['off', 'Ferie e assenze', 'bed-outline', 'Blocca i giorni di un barbiere'],
    ['team', 'Barbieri', 'people-outline', owner ? 'Foto e profili del team' : 'Il team'],
    ['shop', 'Shop', 'bag-handle-outline', owner ? 'Prodotti e descrizioni' : 'Catalogo prodotti'],
    ...(owner ? [['contacts', 'Contatti delle sedi', 'call-outline', 'Telefono, WhatsApp e orari'] as [Tab, string, string, string]] : []),
  ];
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <PageTitle t="Altro" />
      <View style={[s.grp, { marginTop: 14 }]}>
        {items.map(([id, title, icon, sub], i) => (
          <View key={id}>
            {i > 0 && <View style={s.grpSep} />}
            <Pressable style={({ pressed }) => [s.grpRow, pressed && { backgroundColor: C.card2 }]} onPress={() => go(id)}>
              <View style={s.menuIcon}><Ionicons name={tabIcon(icon, true)} size={18} color={C.onAccent} /></View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={s.rowT}>{title}</Text>
                <Text style={s.rowSub}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </Pressable>
          </View>
        ))}
      </View>
      {Platform.OS === 'web' && <ThemePicker />}
    </ScrollView>
  );
}

// ───────── Radice ─────────
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [roleReady, setRoleReady] = useState(false); // il ruolo è stato letto: solo allora il cliente vede il menu account
  const [menu, setMenu] = useState(false); // menu account del cliente (esci, elimina account)
  const [hold, setHold] = useState(false); // tiene aperta la schermata di registrazione finché il cliente non ha letto la conferma
  const [staff, setStaff] = useState<StaffScope | null>(null);
  const [tab, setTab] = useState<Tab>('book');
  const [key, setKey] = useState(0);
  const [cart, setCart] = useState<Cart>({});
  const uid = session?.user.id;
  const desk = useDesk();

  // Tema: sul telefono segue il sistema; sul web conta anche la scelta fatta nell'app. Va deciso prima di disegnare le schermate.
  const system = useColorScheme();
  const [themePref] = useThemePref();
  const mode: Mode = (themePref === 'auto' ? system : themePref) === 'light' ? 'light' : 'dark';
  applyMode(mode);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const d: any = (globalThis as any).document;
      if (d?.documentElement && d.body) {
        d.documentElement.style.colorScheme = mode;
        d.documentElement.style.backgroundColor = C.bg;
        d.body.style.backgroundColor = C.bg;
      }
    }
    try { require('expo-system-ui').setBackgroundColorAsync(C.bg)?.catch?.(() => {}); } catch { /* modulo facoltativo */ }
  }, [mode]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Dopo l'accesso: notifiche push, ruolo e sedi di competenza
  useEffect(() => {
    setStaff(null);
    setRoleReady(false);
    if (!uid || hold) return;
    registerForPush();
    (async () => {
      const { data: p, error: roleErr } = await supabase.from('profiles').select('role').eq('id', uid).single();
      if (p?.role === 'owner') {
        setStaff({ salonIds: null });
        setTab('control');
      } else if (p?.role === 'barber') {
        const { data } = await supabase
          .from('staff_salons')
          .select('salon_id, staff!inner(user_id)')
          .eq('staff.user_id', uid);
        setStaff({ salonIds: (data ?? []).map((r: any) => r.salon_id) });
        setTab('myday');
      } else {
        setTab('book');
      }
      if (!roleErr) setRoleReady(true);
    })();
  }, [uid, hold]);

  // Ritorno dal pagamento (versione web)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const w: any = globalThis;
    if (new URLSearchParams(w.location?.search ?? '').get('paid') === '1') {
      Alert.alert('Grazie!', 'Pagamento ricevuto. Trovi l’ordine nella scheda Agenda.');
      w.history?.replaceState(null, '', w.location.pathname);
    }
  }, [uid]);

  if (!ready) return <View style={s.root}><ActivityIndicator style={{ marginTop: 120 }} color={C.accentText} /></View>;

  const owner = staff?.salonIds === null;
  const tabs: [Tab, string, string][] = staff
    ? [
        owner ? ['control', 'Incassi', 'stats-chart-outline'] : ['myday', 'Giornata', 'today-outline'],
        ['agenda', 'Sede', 'calendar-outline'],
        ['new', 'Nuovo', 'add-circle-outline'],
        ['orders', 'Ordini', 'receipt-outline'],
        ['more', 'Altro', 'ellipsis-horizontal-circle-outline'],
      ]
    : [
        ['book', 'Prenota', 'cut-outline'],
        ['shop', 'Shop', 'bag-handle-outline'],
        ['team', 'Barbieri', 'people-outline'],
        ['contacts', 'Contatti', 'call-outline'],
        ['mine', 'Agenda', 'calendar-outline'],
        ['profile', 'Profilo', 'person-circle-outline'],
      ];
  // Schermate raggiunte da "Altro": la scheda Altro resta evidenziata
  const sub = !!staff && (['off', 'team', 'shop', 'contacts'].includes(tab) || (owner && tab === 'myday'));
  const active: Tab = sub ? 'more' : tab;

  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {!session || hold ? (
        <View style={s.root}>
          <Auth onHold={setHold} />
        </View>
      ) : (
        <SafeAreaView style={s.root}>
          {(() => {
            const onMenu = staff || !roleReady ? undefined : () => setMenu(true);
            const back = sub && (
              <Pressable style={s.back} onPress={() => setTab('more')}>
                <Ionicons name="chevron-back" size={20} color={C.accentText} />
                <Text style={s.backT}>Altro</Text>
              </Pressable>
            );
            const screen = (
              <Appear key={tab}>
                {tab === 'book' && <Book uid={uid} onBooked={() => { setKey((k) => k + 1); setTab('mine'); }} />}
                {tab === 'shop' && <Shop cart={cart} setCart={setCart} canEdit={owner} />}
                {tab === 'team' && <Barbers canEdit={owner} uid={staff ? undefined : uid} />}
                {tab === 'contacts' && <Contacts uid={uid} canPrefer={!staff} canEdit={owner} />}
                {tab === 'mine' && <Mine session={session} refreshKey={key} />}
                {tab === 'profile' && <Profile session={session} />}
                {tab === 'myday' && staff && uid && <MyDay uid={uid} />}
                {tab === 'agenda' && staff && <Agenda staff={staff} />}
                {tab === 'new' && staff && <Book staff={staff} onBooked={() => setTab('agenda')} />}
                {tab === 'orders' && staff && <OrdersAdmin />}
                {tab === 'control' && owner && <ControlRoom />}
                {tab === 'off' && staff && uid && <TimeOff staff={staff} uid={uid} />}
                {tab === 'more' && staff && <More owner={owner} go={setTab} />}
              </Appear>
            );
            // Computer: menu in alto, pagina centrata (l'agenda usa tutta la larghezza)
            if (desk) {
              return (
                <View style={s.deskCol}>
                  <View style={s.top}>
                    <View style={s.topBrand}>
                      <DFMark size={32} />
                      <View>
                        <Text style={s.headT} numberOfLines={1}>Daniele Fichera</Text>
                        <Text style={s.headSub} numberOfLines={1}>Barber Shop · Roma</Text>
                      </View>
                    </View>
                    <View style={s.topMid}>
                      <View style={s.topNav}>
                        {tabs.map(([id, label, icon]) => {
                          const on = active === id;
                          return (
                            <Pressable key={id} style={[s.topItem, on && s.topItemOn]} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
                              <Ionicons name={tabIcon(icon, on)} size={18} color={on ? C.text : C.muted} />
                              <Text numberOfLines={1} style={[s.topLabel, on && { color: C.text }]}>{label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    <Pressable style={s.topAcc} onPress={onMenu ?? (() => supabase.auth.signOut())} accessibilityRole="button" accessibilityLabel={onMenu ? 'Account' : 'Esci'}>
                      <Ionicons name={onMenu ? 'person-circle-outline' : 'log-out-outline'} size={20} color={C.accentText} />
                      <Text style={[s.topLabel, { color: C.accentText }]}>{onMenu ? 'Account' : 'Esci'}</Text>
                    </Pressable>
                  </View>
                  <View style={s.deskMain}>
                    <View style={[s.deskPage, tab !== 'agenda' && s.deskPageNarrow]}>
                      {back}
                      {screen}
                    </View>
                  </View>
                </View>
              );
            }
            return (
              <>
                <Header onLogout={() => supabase.auth.signOut()} onMenu={onMenu} />
                {back}
                {screen}
                <View style={s.tabWrap}>
                  <View style={s.tabbar}>
                    {tabs.map(([id, label, icon]) => {
                      const on = active === id;
                      return (
                        <Pressable key={id} style={s.tabItem} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
                          <View style={s.tabPill}>
                            <Ionicons name={tabIcon(icon, on)} size={25} color={on ? C.accentText : C.muted} />
                            <Text numberOfLines={1} allowFontScaling={false} style={[s.tabLabel, on && { color: C.accentText }]}>{label}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            );
          })()}

          <Modal visible={menu && !staff} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
            <Pressable style={s.backdrop} onPress={() => setMenu(false)} />
            <View style={s.sheet}>
<View style={s.grab} />
              <Text style={s.h2}>Account</Text>
              <Text style={[s.rowSub, { marginBottom: 14 }]}>{session.user.email}</Text>
              <View style={[s.grp, { backgroundColor: C.card2 }]}>
                <Pressable style={({ pressed }) => [s.grpRow, pressed && { backgroundColor: C.line }]} onPress={() => { setMenu(false); supabase.auth.signOut(); }}>
                  <View style={s.menuIcon}><Ionicons name="log-out" size={18} color={C.onAccent} /></View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={s.rowT}>Esci</Text>
                    <Text style={s.rowSub}>Disconnetti questo dispositivo</Text>
                  </View>
                </Pressable>
                <View style={s.grpSep} />
                <Pressable style={({ pressed }) => [s.grpRow, pressed && { backgroundColor: C.line }]} onPress={() => { setMenu(false); setTimeout(askDeleteAccount, 450); }}>
                  <View style={[s.menuIcon, { backgroundColor: C.danger }]}><Ionicons name="trash" size={18} color="#FFFFFF" /></View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={[s.rowT, { color: C.danger }]}>Elimina account</Text>
                    <Text style={s.rowSub}>Cancella il tuo profilo e i dati personali</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

function makeStyles() {
  const HL = StyleSheet.hairlineWidth;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 34, lineHeight: 41, fontWeight: '700', color: C.text, letterSpacing: -0.6, marginBottom: 6 },
  h2: { fontSize: 20, lineHeight: 25, fontWeight: '600', color: C.text, letterSpacing: -0.3 },
  muted: { color: C.muted, fontSize: 15, lineHeight: 21 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Titoli
  eyebrow: { color: C.accentText, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  lead: { color: C.muted, fontSize: 17, lineHeight: 23 },

  // Testata
  headerWrap: {},
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 52 },
  headT: { color: C.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  headSub: { color: C.muted, fontSize: 12, marginTop: 1 },
  logoutBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4 },
  backT: { color: C.accentText, fontSize: 17, fontWeight: '400' },

  // Passi della prenotazione
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 28, marginBottom: 12 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  stepNumOn: { backgroundColor: C.accent },
  stepNumT: { color: C.muted, fontSize: 14, fontWeight: '600' },

  chip: { backgroundColor: C.card2, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
  chipOn: { backgroundColor: C.accent },
  chipT: { fontSize: 16, fontWeight: '500', color: C.text },
  chipSub: { fontSize: 13, color: C.muted, marginTop: 2 },
  onT: { color: C.onAccent },

  cat: { color: C.muted, fontSize: 13, fontWeight: '400', letterSpacing: -0.1, textTransform: 'uppercase', marginBottom: 8, marginTop: 4, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8 },
  rowOn: { borderColor: C.accent },
  rowT: { color: C.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  rowSub: { color: C.muted, fontSize: 14, marginTop: 2, lineHeight: 19 },
  price: { color: C.accentText, fontSize: 17, fontWeight: '600' },

  dayTile: { width: 62, alignItems: 'center', paddingVertical: 11, borderRadius: 14, backgroundColor: C.card2 },
  dayW: { color: C.muted, fontSize: 12, fontWeight: '500' },
  dayN: { color: C.text, fontSize: 22, fontWeight: '600', marginVertical: 2 },

  slot: { backgroundColor: C.card2, borderRadius: 12, width: 80, alignItems: 'center', paddingVertical: 13 },
  slotT: { fontSize: 17, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },

  btn: { backgroundColor: C.accent, borderRadius: 26, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  btnT: { color: C.onAccent, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  goT: { color: C.onAccent, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  input: { backgroundColor: C.card2, borderRadius: 12, padding: 14, fontSize: 17, color: C.text, marginTop: 10 },

  // Computer: menu in alto e pagina centrata
  deskCol: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: HL, borderBottomColor: C.line, backgroundColor: C.bar },
  topBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topMid: { flex: 1, alignItems: 'center' },
  topNav: { flexDirection: 'row', alignItems: 'center', padding: 3, gap: 2, borderRadius: 11, backgroundColor: C.card2 },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  topItemOn: { backgroundColor: C.seg },
  topLabel: { color: C.muted, fontSize: 14, fontWeight: '500' },
  topAcc: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: C.card2 },
  deskMain: { flex: 1, minWidth: 0 },
  deskPage: { flex: 1, width: '100%' },
  deskPageNarrow: { maxWidth: 980, alignSelf: 'center' },
  grid3: { justifyContent: 'flex-start', columnGap: '2.15%' as any },
  col3: { width: '31.9%' },

  // Barra delle schede: come quella di iOS, con filo in alto e icone piene sulla voce attiva
  tabWrap: { borderTopWidth: HL, borderTopColor: C.line, backgroundColor: C.bar },
  tabbar: { flexDirection: 'row', paddingTop: 7, paddingHorizontal: 4 },
  tabItem: { flex: 1 },
  tabPill: { alignItems: 'center', gap: 2, paddingVertical: 2 },
  tabLabel: { color: C.muted, fontSize: 10, fontWeight: '500' },

  // Selettore a segmenti (tema)
  seg: { flexDirection: 'row', backgroundColor: C.card2, borderRadius: 10, padding: 2 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  segItemOn: { backgroundColor: C.seg, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segT: { color: C.text, fontSize: 14, fontWeight: '500' },
  segTOn: { fontWeight: '600' },

  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  link: { fontSize: 16, fontWeight: '500', color: C.accentText, paddingVertical: 4, paddingRight: 14 },
  badge: { width: 54, height: 58, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  badgeN: { color: C.text, fontSize: 22, fontWeight: '600' },
  badgeM: { color: C.accentText, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  timeBig: { color: C.text, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 62 },

  // Shop
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 18 },
  product: { width: '48.5%', backgroundColor: C.card, borderRadius: 18, padding: 10, paddingBottom: 12 },
  productTile: { aspectRatio: 1, backgroundColor: C.tileA, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  productTileBig: { height: 220, backgroundColor: C.tileA, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  productImg: { width: '88%', height: '88%' },
  productImgBig: { width: '88%', height: '88%' },
  prodName: { color: C.text, fontSize: 15, fontWeight: '600', lineHeight: 20, letterSpacing: -0.2 },
  prodDesc: { color: C.muted, fontSize: 13, lineHeight: 18, marginTop: 1 },
  cartImg: { width: 44, height: 44, borderRadius: 8, backgroundColor: C.tileA, marginRight: 12 },
  productFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  plus: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  cartBar: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.accent, borderRadius: 26, paddingVertical: 15, paddingHorizontal: 22 },
  cartT: { color: C.onAccent, fontSize: 17, fontWeight: '600' },
  // Pannelli: sul web lo scuro viene dall'ombra della scheda (copre anche i lati su schermo largo); sul telefono è lo sfondo qui sopra
  backdrop: { flex: 1, backgroundColor: Platform.OS === 'web' ? 'transparent' : C.scrim },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingTop: 12, paddingBottom: 34, ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 100vmax ${C.scrim}` } as any) : null) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: C.muted, opacity: 0.45, marginBottom: 16 },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  qtyT: { color: C.text, fontSize: 17, fontWeight: '600', minWidth: 22, textAlign: 'center', marginLeft: 8 },

  // Barbieri e liste raggruppate
  barber: { width: '48.5%' },
  barberPhoto: { width: '100%', aspectRatio: 1, borderRadius: 20, backgroundColor: C.card2 },
  barberName: { color: C.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3, marginTop: 10 },
  camera: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { width: 30, height: 30, borderRadius: 7, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  grp: { backgroundColor: C.card, borderRadius: 18, overflow: 'hidden' },
  grpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  grpSep: { height: HL, backgroundColor: C.line, marginLeft: 60 },

  // Carta fedeltà e incassi
  loyHero: { backgroundColor: C.loyA, borderRadius: 22, padding: 20, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { color: C.accentText, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  heroNum: { color: C.text, fontSize: 56, fontWeight: '700', letterSpacing: -2, marginTop: 8 },
  heroOf: { color: C.muted, fontSize: 24, fontWeight: '600', letterSpacing: 0 },
  stamps: { flexDirection: 'row', gap: 6, marginTop: 18, marginBottom: 14 },
  stamp: { flex: 1, aspectRatio: 1, borderRadius: 99, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  stampOn: { backgroundColor: C.accent },
  track: { height: 6, borderRadius: 3, backgroundColor: C.card2, flexDirection: 'row', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.accent },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  kpi: { backgroundColor: C.card2, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, minWidth: 104 },
  kpiBig: { color: C.text, fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  cols: { flexDirection: 'row', alignItems: 'flex-end', height: 124, gap: 2 },
  colWrap: { flex: 1, justifyContent: 'flex-end' },
  col: { backgroundColor: C.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 },

  // Campi dei moduli (Profilo, Contatti)
  fieldLabel: { color: C.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card2, borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: 14 },
  fieldFocus: { borderColor: C.accent },
  fieldInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 17, paddingVertical: 13 },
  fieldErr: { color: C.danger, fontSize: 12.5, marginTop: 5, marginLeft: 4 },

  // Conferma dopo la registrazione
  doneRoot: { flex: 1, backgroundColor: C.bg },
  doneBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  doneIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  doneKicker: { color: C.accentText, fontSize: 13, fontWeight: '600', letterSpacing: 0.6 },
  doneTitle: { color: C.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.8, textAlign: 'center', marginTop: 10, marginBottom: 14 },
  doneSub: { color: C.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  doneMail: { color: C.accentText, fontSize: 17, fontWeight: '600', textAlign: 'center', marginVertical: 6 },

  // Prenotazione: barbieri e barra in basso
  pickRow: { paddingHorizontal: 20, gap: 12, paddingBottom: 4 },
  pickRowCard: { paddingHorizontal: 16, gap: 12 },
  bCard: { width: 116, alignItems: 'center', padding: 10, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', backgroundColor: C.card },
  bCardOn: { borderColor: C.accent },
  bPhoto: { width: 92, height: 92, borderRadius: 46, backgroundColor: C.card2 },
  bIni: { color: C.accentText, fontSize: 30, fontWeight: '700' },
  bCheck: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card },
  bFav: { position: 'absolute', left: -2, top: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card },
  bName: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 10, minHeight: 36 },
  hisHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  hisKicker: { color: C.accentText, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  hisStats: { flexDirection: 'row', gap: 10 },
  hisTile: { flex: 1, backgroundColor: C.card, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center' },
  hisNum: { color: C.text, fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  hisLbl: { color: C.muted, fontSize: 12, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  hisSection: { color: C.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 18, marginBottom: 8, marginLeft: 4 },
  hisRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 8 },
  hisDate: { width: 48, height: 52, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  hisDay: { color: C.text, fontSize: 19, fontWeight: '600', lineHeight: 22 },
  hisMon: { color: C.accentText, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  hisState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hisTag: { fontSize: 12, fontWeight: '700' },
  hisEmpty: { alignItems: 'center', backgroundColor: C.card, borderRadius: 18, paddingVertical: 24, paddingHorizontal: 22 },
  bookBar: { position: 'absolute', left: 14, right: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 24, borderWidth: HL, borderColor: C.line, padding: 12, paddingLeft: 18, shadowColor: C.shadow, shadowOpacity: C.shadowO, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  bookGo: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 22, paddingVertical: 13, paddingHorizontal: 20 },

  // Pagina del calendario
  calRoot: { flex: 1, backgroundColor: C.bg },
  calTop: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingBottom: 10 },
  calTitle: { color: C.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  calBody: { padding: 16, paddingBottom: 30 },
  calCard: { backgroundColor: C.calCard, borderRadius: 20, padding: 14 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calArrow: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  calMonth: { color: C.text, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  calYear: { color: C.accentText, fontSize: 13, fontWeight: '600', letterSpacing: 0.4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellHead: { width: '14.28%', alignItems: 'center', paddingVertical: 8 },
  calWeekT: { color: C.muted, fontSize: 12, fontWeight: '600' },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 3 },
  calDay: { width: '100%', height: '100%', borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  calToday: { backgroundColor: C.accentSoft },
  calSel: { backgroundColor: C.accent },
  calNum: { color: C.text, fontSize: 17, fontWeight: '500' },
  calOff: { color: C.calOff, fontWeight: '500' },
  calDot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  calDot2: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 8 },
  calLegend: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 4 },
  calSlotsTitle: { color: C.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 26, marginBottom: 12 },
  calBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: HL, borderTopColor: C.line, backgroundColor: C.calBar },

  // Profilo
  profName: { color: C.text, fontSize: 21, fontWeight: '600', letterSpacing: -0.4 },
  profRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },

  // Contatti
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  infoT: { flex: 1, color: C.text, fontSize: 15, lineHeight: 21 },
  prefBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: C.accentSoft },
  prefBtnT: { color: C.accentText, fontSize: 16, fontWeight: '600' },
  actRow: { flexDirection: 'row', gap: 10 },
  actBtn: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  actT: { color: C.accentText, fontSize: 12, fontWeight: '500' },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  openDot: { width: 10, height: 10, borderRadius: 5 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: HL, borderBottomColor: C.line },
  hoursDay: { color: C.text, fontSize: 16, fontWeight: '500' },
  hoursT: { color: C.muted, fontSize: 16, fontVariant: ['tabular-nums'] },

  // Preferiti, mappa
  favBtn: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  mapBox: { height: MAP_H, borderRadius: 18, overflow: 'hidden' },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 },
  mapTag: { position: 'absolute', right: 10, bottom: 10 },
  mapTagT: { color: C.text, fontSize: 13, fontWeight: '600' },
  mapAttr: { position: 'absolute', left: 8, bottom: 6, color: 'rgba(248,244,234,0.7)', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  pinWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pinRing: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(196,168,104,0.28)', borderWidth: 1.5, borderColor: 'rgba(196,168,104,0.8)' },

  // Agenda della sede (griglia barbieri × orari)
  agBar: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  agDay: { width: 50, alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: C.card2 },
  agDayW: { color: C.muted, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  agDayN: { color: C.text, fontSize: 19, fontWeight: '600', lineHeight: 22 },
  agTitle: { color: C.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4, flexShrink: 1 },
  agHeadRow: { flexDirection: 'row', backgroundColor: C.bg, borderTopWidth: HL, borderTopColor: C.line, borderBottomWidth: HL, borderBottomColor: C.line },
  agHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderLeftWidth: HL, borderLeftColor: C.line },
  agHeadName: { color: C.text, fontSize: 15, fontWeight: '600' },
  agHeadSub: { color: C.muted, fontSize: 11.5, marginTop: 1 },
  agTime: { position: 'absolute', left: 0, width: AG_TIME_W, textAlign: 'center', color: C.muted, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  agTimeH: { color: C.text, fontWeight: '700', fontSize: 12.5 },
  agCol: { borderLeftWidth: HL, borderLeftColor: C.line, backgroundColor: C.bg },
  agShift: { position: 'absolute', left: 0, right: 0, backgroundColor: C.card },
  agLine: { position: 'absolute', left: 0, right: 0, height: HL, backgroundColor: C.line, opacity: 0.6 },
  agLineH: { opacity: 1 },
  agSlot: { position: 'absolute', left: 4, right: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8, backgroundColor: C.slot },
  agSlotOff: { backgroundColor: 'transparent', opacity: 0.4 },
  agSlotT: { color: C.accentText, fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  agBlk: { position: 'absolute', left: 4, right: 4, paddingHorizontal: 8, paddingVertical: 4, gap: 1, overflow: 'hidden', borderRadius: 8, backgroundColor: C.accentSoft, borderLeftWidth: 3, borderLeftColor: C.accent },
  agBlkDone: { backgroundColor: C.card2, borderLeftColor: C.ok, opacity: 0.8 },
  agBlkMiss: { backgroundColor: C.dangerSoft, borderLeftColor: C.danger },
  agBlkOther: { backgroundColor: C.card2, borderLeftColor: C.muted, justifyContent: 'center' },
  agBlkWho: { flex: 1, color: C.text, fontSize: 14, fontWeight: '600' },
  agBlkTime: { color: C.accentText, fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  agBlkSvc: { color: C.muted, fontSize: 12.5 },
  agTag: { fontSize: 9, letterSpacing: 0.6, fontWeight: '700', color: C.onAccent, backgroundColor: C.accent, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  agOff: { position: 'absolute', left: 4, right: 4, padding: 8, gap: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: C.card2, opacity: 0.95 },
  agOffT: { color: C.muted, fontSize: 12.5, textAlign: 'center' },
  agPause: { position: 'absolute', left: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: AG_TIME_W + 14, backgroundColor: C.card, borderTopWidth: HL, borderBottomWidth: HL, borderColor: C.line },
  agPauseT: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  agNow: { position: 'absolute', left: AG_TIME_W - 5, right: 0, height: 2, backgroundColor: C.danger },
  agNowDot: { position: 'absolute', left: 0, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger },
  agSheet: { width: '100%', maxWidth: 560, alignSelf: 'center' },
});
}
let s = makeStyles();
