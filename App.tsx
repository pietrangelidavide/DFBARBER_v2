import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { AccessibilityInfo, ActivityIndicator, Alert as RNAlert, Animated, Easing, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
// Scuro: oro su nero caldo (dal logo DFBARBER). Chiaro: bianco caldo; testi e icone dorati usano un oro più scuro, leggibile sul bianco.
// Sul telefono l'app segue il tema del sistema; sul web si sceglie fra Automatico, Chiaro e Scuro (la scelta resta nel browser).
const DARK = {
  bg: '#070706', card: '#11100E', card2: '#1A1815', line: '#2A2722',
  text: '#F8F4EA', muted: '#A39D8E',
  accent: '#ECC052', accent2: '#B98A22', accentSoft: '#ECC05224',
  accentText: '#ECC052',            // oro per testi e icone
  accentBorder: '#ECC052',          // oro per i bordi di selezione
  accentLine: 'rgba(236,192,82,0.35)', accentLine2: 'rgba(236,192,82,0.6)',
  danger: '#FF6B5E', dangerSoft: 'rgba(255,107,94,0.14)', ok: '#3DDC84', series2: '#8C877A',
  // sfumature di sfondo
  heroA: '#2B2111', heroB: '#0B0A07', welA: '#17120A', tabEnd: '#1E170B',
  tileA: '#2E2410', tileB: '#14110A', photoA: '#3A2D12', photoB: '#15110A', barberA: '#2A2415', barberB: '#12100B',
  loyA: '#2E2410', loyB: '#0F0E0A', mapA: '#14120D', mapB: '#0A0907',
  // ombre, vetro, calendario, pagina iniziale
  scrim: 'rgba(0,0,0,0.65)', shadow: '#000000', shadowO: 0.5,
  glassBorder: 'rgba(255,255,255,0.18)', glassA: 'rgba(255,255,255,0.18)', glassB: 'rgba(255,255,255,0.04)',
  glassTint: 'rgba(236,192,82,0.10)', nativeTint: 'rgba(236,192,82,0.14)',
  calCard: 'rgba(17,16,14,0.92)', calBar: 'rgba(11,10,7,0.96)', calOff: 'rgba(163,157,142,0.35)',
  welTitle: '#F3E3B3', welLine: 'rgba(236,192,82,0.7)', welGhostBg: 'rgba(255,255,255,0.04)',
  // alias usati più in basso nel codice
  ink: '#F8F4EA', paper: '#070706', steel: '#A39D8E', red: '#FF6B5E',
};
const LIGHT: typeof DARK = {
  bg: '#FAF8F3', card: '#FFFFFF', card2: '#F2EEE4', line: '#DCD5C2',
  text: '#1A160D', muted: '#6B6554',
  accent: '#ECC052', accent2: '#B98A22', accentSoft: 'rgba(185,138,34,0.14)',
  accentText: '#7F5C0D',
  accentBorder: '#B38420',
  accentLine: 'rgba(185,138,34,0.40)', accentLine2: 'rgba(185,138,34,0.65)',
  danger: '#C8362B', dangerSoft: 'rgba(200,54,43,0.10)', ok: '#178A49', series2: '#746E5D',
  heroA: '#F5E6B8', heroB: '#FAF1D9', welA: '#F3E2B0', tabEnd: '#F4EAD0',
  tileA: '#F6E8BE', tileB: '#EBD79B', photoA: '#F3E3B3', photoB: '#E8D39A', barberA: '#F3E3B3', barberB: '#E8D39A',
  loyA: '#F7E9BF', loyB: '#FFFFFF', mapA: '#EFE9DB', mapB: '#E4DCC8',
  scrim: 'rgba(26,22,13,0.45)', shadow: '#3A2D0B', shadowO: 0.14,
  glassBorder: 'rgba(0,0,0,0.08)', glassA: 'rgba(255,255,255,0.75)', glassB: 'rgba(255,255,255,0.35)',
  glassTint: 'rgba(236,192,82,0.14)', nativeTint: 'rgba(236,192,82,0.18)',
  calCard: 'rgba(255,255,255,0.96)', calBar: 'rgba(250,248,243,0.96)', calOff: 'rgba(107,101,84,0.35)',
  welTitle: '#7A5708', welLine: 'rgba(185,138,34,0.7)', welGhostBg: 'rgba(255,255,255,0.6)',
  ink: '#1A160D', paper: '#FAF8F3', steel: '#6B6554', red: '#C8362B',
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

// ───────── Moduli facoltativi ─────────
// Carattere elegante per i titoli (Playfair Display): se i pacchetti non sono installati
// l'app funziona lo stesso, con il carattere serif di sistema.
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }) as string;
let useFontsHook: any = null;
let BRAND_FONTS: any = null;
try {
  useFontsHook = require('expo-font').useFonts;
  const pf = require('@expo-google-fonts/playfair-display');
  BRAND_FONTS = { PlayfairDisplay_700Bold: pf.PlayfairDisplay_700Bold, PlayfairDisplay_700Bold_Italic: pf.PlayfairDisplay_700Bold_Italic };
} catch {
  // pacchetti assenti
}
// Restituisce [carattere, pronto, corsivo]
const useBrandFont: () => [string, boolean, string] =
  useFontsHook && BRAND_FONTS
    ? () => {
        const [ok, err] = useFontsHook(BRAND_FONTS);
        return ok ? ['PlayfairDisplay_700Bold', true, 'PlayfairDisplay_700Bold_Italic'] : [SERIF, !!err, SERIF];
      }
    : () => [SERIF, true, SERIF];

type Cart = Record<string, { p: any; qty: number }>;
type StaffScope = { salonIds: string[] | null }; // null = tutte le sedi (titolare)
type Tab = 'book' | 'shop' | 'team' | 'contacts' | 'profile' | 'mine' | 'myday' | 'agenda' | 'new' | 'off' | 'orders' | 'control' | 'more';

// ───────── Vetro liquido ─────────
// iPhone con iOS 26: effetto nativo Liquid Glass (expo-glass-effect).
// Altrove, o se il modulo non è disponibile: vetro smerigliato (sfocatura, riflesso e bordo luminoso).
let NativeGlass: any = null;
let liquidOk = false;
try {
  const g = require('expo-glass-effect');
  if (Platform.OS === 'ios' && g.isLiquidGlassAvailable() && g.isGlassEffectAPIAvailable()) {
    NativeGlass = g.GlassView;
    liquidOk = true;
  }
} catch {
  // modulo assente: resta il vetro smerigliato
}

function Glass({ children, style, radius = 22, tint }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; tint?: string }) {
  const shell: ViewStyle = { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: C.glassBorder };
  if (liquidOk) {
    return (
      <NativeGlass glassEffectStyle="regular" tintColor={tint ?? C.nativeTint} colorScheme={MODE} style={[shell, style]}>
        {children}
      </NativeGlass>
    );
  }
  return (
    <BlurView intensity={50} tint={MODE} style={[shell, style]}>
      <LinearGradient
        colors={[C.glassA, C.glassB, tint ?? C.glassTint]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </BlurView>
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
const Title = ({ t }: { t: string }) => <Text style={[s.h2, { marginTop: 24, marginBottom: 10 }]}>{t}</Text>;

// Scelta del tema (solo web: sul telefono si segue il sistema)
const THEME_LABEL: Record<ThemePref, string> = { auto: 'Automatico', light: 'Chiaro', dark: 'Scuro' };
function ThemePicker() {
  const [pref, setPref] = useThemePref();
  return (
    <>
      <Title t="Aspetto" />
      <View style={s.card}>
        <View style={s.wrap}>
          {(['auto', 'light', 'dark'] as ThemePref[]).map((id) => (
            <Chip key={id} label={THEME_LABEL[id]} on={pref === id} onPress={() => setPref(id)} />
          ))}
        </View>
        <Text style={[s.rowSub, { marginTop: 12 }]}>Automatico segue il tema del tuo dispositivo. La scelta resta salvata su questo browser.</Text>
      </View>
    </>
  );
}
// Pulsante rapido per la pagina iniziale (web): Automatico → Chiaro → Scuro
function ThemeToggle({ top }: { top: number }) {
  const [pref, setPref] = useThemePref();
  const next: ThemePref = pref === 'auto' ? 'light' : pref === 'light' ? 'dark' : 'auto';
  const icon = pref === 'auto' ? 'contrast-outline' : pref === 'light' ? 'sunny-outline' : 'moon-outline';
  return (
    <Pressable
      onPress={() => setPref(next)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Tema: ${THEME_LABEL[pref]}. Tocca per cambiarlo`}
      style={{ position: 'absolute', top, right: 16, zIndex: 5 }}
    >
      <Glass radius={20} style={s.logoutBtn}>
        <Ionicons name={icon as any} size={20} color={C.text} />
      </Glass>
    </Pressable>
  );
}

const Step = ({ n, t, done }: { n: number; t: string; done?: boolean }) => (
  <View style={s.stepRow}>
    <View style={[s.stepNum, done && s.stepNumOn]}>
      {done ? <Ionicons name="checkmark" size={16} color="#000" /> : <Text style={s.stepNumT}>{n}</Text>}
    </View>
    <Text style={s.h2}>{t}</Text>
  </View>
);

function Header({ onLogout, onMenu }: { onLogout: () => void; onMenu?: () => void }) {
  return (
    <View style={s.headerWrap}>
      <LinearGradient colors={[C.heroA, C.bg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={s.header}>
        <Glass radius={22} style={s.logoPill}>
          <Image source={MODE === 'dark' ? require('./assets/logo-text.png') : require('./assets/logo-text-light.png')} style={s.headerLogo} resizeMode="contain" />
        </Glass>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onMenu ?? onLogout} hitSlop={12}>
          <Glass radius={20} style={s.logoutBtn}>
            <Ionicons name={onMenu ? 'ellipsis-horizontal' : 'log-out-outline'} size={22} color={C.text} />
          </Glass>
        </Pressable>
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
        <Text style={s.h1}>Shop</Text>
        <Text style={s.muted}>{items.length} prodotti selezionati dai nostri barbieri</Text>
        <View style={s.grid}>
          {items.map((p) => (
            <Pressable key={p.id} style={s.product} onPress={() => openProduct(p)}>
              {p.image_url ? (
                <Image source={{ uri: p.image_url }} style={s.productImg} resizeMode="contain" />
              ) : (
                <LinearGradient colors={[C.tileA, C.tileB]} style={s.productIcon}>
                  <Ionicons name="water-outline" size={32} color={C.accentText} />
                </LinearGradient>
              )}
              <Text style={s.rowT} numberOfLines={2}>{p.name}</Text>
              <Text style={[s.rowSub, { minHeight: 18 }]} numberOfLines={1}>{p.description ?? ''}</Text>
              <View style={s.productFoot}>
                <Text style={s.price}>{eur(p.price_cents)}</Text>
                <Pressable onPress={() => setQty(p, (cart[p.id]?.qty ?? 0) + 1)} hitSlop={8} style={s.plus}>
                  <Ionicons name="add" size={20} color="#000" />
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {count > 0 && (
        <Pressable style={s.cartBar} onPress={() => setCheckout(true)}>
          <Ionicons name="bag-handle" size={22} color="#000" />
          <Text style={s.cartT}>Carrello ({count})</Text>
          <Text style={s.cartT}>{eur(total)}</Text>
        </Pressable>
      )}

      {/* dettaglio prodotto */}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(null)} />
        <View style={s.sheet}>
          {open && (
            <>
              {open.image_url ? (
                <Image source={{ uri: open.image_url }} style={s.productImgBig} resizeMode="contain" />
              ) : (
                <LinearGradient colors={[C.tileA, C.tileB]} style={s.productIconBig}>
                  <Ionicons name="water-outline" size={56} color={C.accentText} />
                </LinearGradient>
              )}
              <Text style={s.h1}>{open.name}</Text>
              <Text style={[s.price, { fontSize: 22 }]}>{eur(open.price_cents)}</Text>
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

// Campo con etichetta, errore e (facoltativo) elemento a destra
function Field({ label, error, right, ...p }: TextInputProps & { label: string; error?: string | null; right?: ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldBox, !!error && { borderColor: C.danger }]}>
        <TextInput style={s.fieldInput} placeholderTextColor={C.muted} {...p} />
        {right}
      </View>
      {error ? <Text style={s.fieldErr}>{error}</Text> : null}
    </View>
  );
}

// ───────── Pagina iniziale ─────────
// Se il telefono ha "Riduci animazioni" attivo, le animazioni continue restano ferme
function useCalm() {
  const [calm, setCalm] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(() => {}); }, []);
  return calm;
}

// Alone luminoso: cerchi concentrici sempre più trasparenti (finto sfumato radiale, identico su iPhone e web)
function Glow({ size, peak = 0.5 }: { size: number; peak?: number }) {
  const n = 16;
  return (
    <View pointerEvents="none" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: n }, (_, i) => {
        const d = size * (1 - i / n);
        return <View key={i} style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: `rgba(236,192,82,${(peak / n).toFixed(3)})` }} />;
      })}
    </View>
  );
}

// L'introduzione animata si vede una volta sola per sessione (non si ripete tornando indietro dall'accesso)
let welcomePlayed = false;

// Pagina iniziale: il logo, "Benvenuti" che sale da dietro una linea e le lettere che si ravvicinano, poi i due pulsanti.
// Una sola entrata, lenta e pulita; poi tutto resta fermo.
function Welcome({ onIn, onUp }: { onIn: () => void; onUp: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [, ready, italic] = useBrandFont();
  const calm = useCalm();
  const v0 = welcomePlayed ? 1 : 0; // tornando alla pagina l'introduzione non si ripete
  const halo = useRef(new Animated.Value(v0)).current;  // alone dietro al logo
  const logo = useRef(new Animated.Value(v0)).current;  // logo e cerchio sottile
  const word = useRef(new Animated.Value(v0)).current;  // titolo: sale da dietro la maschera
  const track = useRef(new Animated.Value(v0)).current; // spazio fra le lettere che si chiude (animazione non nativa)
  const line = useRef(new Animated.Value(v0)).current;  // filetto e sottotitolo
  const rise = useRef(new Animated.Value(v0)).current;  // pulsanti

  const [late, setLate] = useState(false);
  const started = useRef(false);
  useEffect(() => { const id = setTimeout(() => setLate(true), 1500); return () => clearTimeout(id); }, []);

  useEffect(() => {
    if ((!ready && !late) || started.current) return; // se i font tardano troppo si parte lo stesso
    started.current = true;
    if (calm || welcomePlayed) {
      welcomePlayed = true;
      [halo, logo, word, track, line, rise].forEach((v) => v.setValue(1));
      return;
    }
    welcomePlayed = true;
    const go = (v: Animated.Value, duration: number, delay: number, easing: (t: number) => number, native = true) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing, useNativeDriver: native });
    Animated.parallel([
      go(halo, 1500, 0, Easing.out(Easing.cubic)),
      go(logo, 900, 150, Easing.out(Easing.cubic)),
      go(word, 1000, 750, Easing.out(Easing.exp)),
      go(track, 1600, 750, Easing.out(Easing.cubic), false),
      go(line, 700, 1600, Easing.out(Easing.cubic)),
      go(rise, 700, 1850, Easing.out(Easing.cubic)),
    ]).start();
  }, [ready, late, calm]);

  const disc = Math.round(Math.max(104, Math.min(132, height * 0.15)));
  const ring = disc + 24;
  const fs = Math.min(54, Math.round((width - 72) / 6.6));
  const lh = Math.round(fs * 1.32);
  const italicOk = italic !== SERIF;

  return (
    <View style={[s.welcome, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) + 6 }]}>
      <LinearGradient colors={[C.welA, C.heroB, C.bg]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      {Platform.OS === 'web' && <ThemeToggle top={insets.top + 12} />}

      <View style={s.welBrand}>
        <View style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View pointerEvents="none" style={{ position: 'absolute', opacity: halo }}>
            <Glow size={Math.round(disc * 2.7)} peak={0.3} />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', width: ring, height: ring, borderRadius: ring / 2,
              borderWidth: 1, borderColor: C.accentLine,
              opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
            }}
          />
          <Animated.View style={{ opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
            <Image source={require('./assets/logo.png')} style={{ width: disc, height: disc, borderRadius: disc / 2 }} resizeMode="contain" />
          </Animated.View>
        </View>

        <View style={[s.welMask, { height: lh, marginTop: 34 }]} accessible accessibilityRole="header" accessibilityLabel="Benvenuti">
          <Animated.View
            style={{
              opacity: word.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 1, 1] }),
              transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [lh, 0] }) }],
            }}
          >
            <Animated.Text
              numberOfLines={1}
              ellipsizeMode="clip"
              allowFontScaling={false}
              style={[
                s.welTitle,
                { fontFamily: italic, fontSize: fs, lineHeight: lh, letterSpacing: track.interpolate({ inputRange: [0, 1], outputRange: [Math.round(fs * 0.16), 1] }) },
                !italicOk && { fontStyle: 'italic', fontWeight: '700' },
              ]}
            >
              Benvenuti
            </Animated.Text>
          </Animated.View>
        </View>

        <Animated.View style={[s.welLine, { opacity: line, transform: [{ scaleX: line }] }]} />
        <Animated.Text style={[s.welSub, { opacity: line, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
          BARBER SHOP · ROMA
        </Animated.Text>
      </View>

      <Animated.View style={[s.welActions, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
        <Pressable onPress={onIn} style={({ pressed }) => [s.welPrimaryWrap, pressed && { opacity: 0.92, transform: [{ scale: 0.985 }] }]}>
          <LinearGradient colors={['#F4D26A', '#DDAE33']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.welPrimary}>
            <Text style={s.welPrimaryT}>Accedi</Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={onUp} style={({ pressed }) => [s.welGhost, pressed && { backgroundColor: C.accentSoft, transform: [{ scale: 0.985 }] }]}>
          <Text style={s.welGhostT}>Registrati</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function AuthShell({ title, sub, onBack, children }: { title: string; sub: string; onBack: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[s.authPad, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={s.authBack} onPress={onBack} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color={C.accentText} />
          <Text style={s.backT}>Indietro</Text>
        </Pressable>
        <Image source={require('./assets/logo.png')} style={s.authMini} resizeMode="contain" />
        <Text style={s.h1}>{title}</Text>
        <Text style={s.muted}>{sub}</Text>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
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
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="nome@esempio.it" />
      <Field
        label="Password"
        value={pw}
        onChangeText={setPw}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        placeholder="La tua password"
        onSubmitEditing={submit}
        right={
          <Pressable onPress={() => setShow(!show)} hitSlop={10}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} />
          </Pressable>
        }
      />
      {err ? <Text style={s.formErr}>{err}</Text> : null}
      {unconfirmed ? (
        <Pressable onPress={resend} style={{ marginTop: 8 }}>
          <Text style={s.link}>Rinvia l’e-mail di conferma</Text>
        </Pressable>
      ) : null}
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.btnT}>{busy ? 'Un attimo…' : 'Accedi'}</Text>
      </Pressable>
      <Pressable onPress={onSwitch} style={{ marginTop: 18, alignItems: 'center' }}>
        <Text style={s.muted}>Non hai un account? <Text style={{ color: C.accentText, fontWeight: '700' }}>Registrati</Text></Text>
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
    <AuthShell title="Crea il tuo account" sub="Ti servono pochi secondi. Tutti i campi sono obbligatori." onBack={onBack}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label="Nome" value={first} onChangeText={setFirst} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" error={shown('first')} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Cognome" value={last} onChangeText={setLast} autoCapitalize="words" autoComplete="family-name" textContentType="familyName" error={shown('last')} />
        </View>
      </View>
      <Field label="Numero di telefono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+39 333 1234567" error={shown('phone')} />
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="nome@esempio.it" error={shown('email')} />
      <Field
        label="Password"
        value={pw}
        onChangeText={setPw}
        secureTextEntry={!show}
        autoCapitalize="none"
        textContentType="newPassword"
        placeholder="Almeno 8 caratteri"
        error={shown('pw')}
        right={
          <Pressable onPress={() => setShow(!show)} hitSlop={10}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} />
          </Pressable>
        }
      />
      <Field
        label="Ripeti la password"
        value={pw2}
        onChangeText={setPw2}
        secureTextEntry={!show}
        autoCapitalize="none"
        textContentType="newPassword"
        placeholder="Scrivila ancora una volta"
        error={shown('pw2')}
        onSubmitEditing={submit}
      />
      {fail ? <Text style={s.formErr}>{fail}</Text> : null}
      <Pressable style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={s.btnT}>{busy ? 'Un attimo…' : 'Crea account'}</Text>
      </Pressable>
      <Pressable onPress={onSwitch} style={{ marginTop: 18, alignItems: 'center' }}>
        <Text style={s.muted}>Hai già un account? <Text style={{ color: C.accentText, fontWeight: '700' }}>Accedi</Text></Text>
      </Pressable>
    </AuthShell>
  );
}

// Conferma a tutta pagina dopo la registrazione: rinvia e-mail, invia WhatsApp, accedi
function Registered({ info, onLogin }: { info: Done; onLogin: () => void }) {
  const insets = useSafeAreaInsets();
  const [font] = useBrandFont();
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
        <LinearGradient colors={[C.heroA, C.heroB, C.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={[s.doneBody, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={s.welGlowSm} />
          <Glass radius={60} style={s.doneIcon}>
            <Ionicons name="checkmark" size={58} color={C.accentText} />
          </Glass>
          <Text style={s.doneKicker}>REGISTRAZIONE COMPLETATA</Text>
          <Text style={[s.doneTitle, { fontFamily: font }]}>Grazie, {info.first}!</Text>
          {info.active ? (
            <Text style={s.doneSub}>Il tuo account è pronto: puoi accedere subito e prenotare il tuo prossimo taglio.</Text>
          ) : (
            <>
              <Text style={s.doneSub}>Ti abbiamo inviato un’e-mail di conferma a</Text>
              <Text style={s.doneMail}>{info.email}</Text>
              <Text style={s.doneSub}>Aprila e tocca il link per attivare l’account, poi accedi. Se non la trovi, guarda anche nello spam.</Text>
            </>
          )}

          <View style={{ width: '100%', marginTop: 34 }}>
            <Pressable onPress={resend} disabled={wait > 0}>
              <Glass radius={16} style={[s.doneBtn, wait > 0 && { opacity: 0.55 }]}>
                <Ionicons name="mail-outline" size={20} color={C.text} />
                <Text style={s.doneBtnT}>{wait > 0 ? `Rinvia e-mail (${wait}s)` : 'Rinvia e-mail'}</Text>
              </Glass>
            </Pressable>
            <Pressable onPress={whatsapp} style={{ marginTop: 12 }}>
              <Glass radius={16} style={s.doneBtn}>
                <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                <Text style={s.doneBtnT}>Invia WhatsApp</Text>
              </Glass>
            </Pressable>
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
      {stage === 'welcome' && <Welcome onIn={() => setStage('in')} onUp={() => setStage('up')} />}
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
          <LinearGradient colors={[C.photoA, C.photoB]} style={[s.bPhoto, { alignItems: 'center', justifyContent: 'center' }]}>
            {firstFree ? <Ionicons name="flash" size={34} color={C.accentText} /> : <Text style={s.bIni}>{ini}</Text>}
          </LinearGradient>
        )}
        {fav && (
          <View style={s.bFav}>
            <Ionicons name="star" size={11} color="#000" />
          </View>
        )}
        {on && (
          <View style={s.bCheck}>
            <Ionicons name="checkmark" size={14} color="#000" />
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
      <View key={r.id} style={[s.hisRow, soon && { borderColor: C.accentBorder, backgroundColor: C.accentSoft }]}>
        <View style={[s.hisDate, soon && { backgroundColor: C.accent }]}>
          <Text style={[s.hisDay, soon && { color: '#000' }]}>{d.toLocaleDateString('it-IT', { day: 'numeric', timeZone: tz })}</Text>
          <Text style={[s.hisMon, soon && { color: '#000' }]}>{d.toLocaleDateString('it-IT', { month: 'short', timeZone: tz }).replace('.', '')}</Text>
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
          <Text style={s.hisKicker}>IL TUO STORICO</Text>
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
              <Text style={[s.hisNum, { fontSize: 19 }]} numberOfLines={1} adjustsFontSizeToFit>{lastTxt}</Text>
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
                  <Text style={{ color: C.accentText, fontWeight: '700' }}>{all ? 'Mostra meno' : `Mostra tutte (${past.length})`}</Text>
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
  const [font] = useBrandFont();
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
          <Pressable style={s.bookGo} onPress={openCalendar}>
            <Text style={s.btnT}>Prenota</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </Pressable>
        </View>
      )}

      {/* Pagina del calendario, a tutto schermo */}
      <Modal visible={stage === 'calendar'} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setStage('pick')}>
        <KeyboardAvoidingView style={s.calRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <LinearGradient colors={[C.heroA, C.heroB, C.bg]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
          <View style={[s.calTop, { paddingTop: insets.top + 8 }]}>
            <Pressable onPress={() => setStage('pick')} hitSlop={10}>
              <Glass radius={20} style={s.logoutBtn}>
                <Ionicons name="chevron-back" size={22} color={C.text} />
              </Glass>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[s.calTitle, { fontFamily: font }]}>Scegli data e orario</Text>
              <Text style={s.rowSub} numberOfLines={1}>{service?.name} · {barberName} · {salon?.name}</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={s.calBody} keyboardShouldPersistTaps="handled">
            <View style={s.calCard}>
              <View style={s.calHead}>
                <Pressable onPress={() => canPrev && setMonth(addMonths(month, -1))} disabled={!canPrev} hitSlop={8} style={!canPrev && { opacity: 0.3 }}>
                  <Glass radius={18} style={s.calArrow}>
                    <Ionicons name="chevron-back" size={18} color={C.text} />
                  </Glass>
                </Pressable>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[s.calMonth, { fontFamily: font }]}>{cap(month.toLocaleDateString('it-IT', { month: 'long' }))}</Text>
                  <Text style={s.calYear}>{month.getFullYear()}</Text>
                </View>
                <Pressable onPress={() => canNext && setMonth(addMonths(month, 1))} disabled={!canNext} hitSlop={8} style={!canNext && { opacity: 0.3 }}>
                  <Glass radius={18} style={s.calArrow}>
                    <Ionicons name="chevron-forward" size={18} color={C.text} />
                  </Glass>
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
              <Text style={s.btnT}>{busy ? 'Un attimo…' : staff ? 'Salva' : 'Conferma'}</Text>
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
      {rows.length === 0 && <Text style={s.muted}>Nessun appuntamento in programma. Prenota il tuo prossimo taglio dalla scheda Prenota.</Text>}
      {rows.map((r) => (
        <View key={r.id} style={[s.card, { flexDirection: 'row', gap: 14 }]}>
          <View style={s.badge}>
            <Text style={s.badgeN}>{new Date(r.starts_at).getDate()}</Text>
            <Text style={s.badgeM}>{new Date(r.starts_at).toLocaleDateString('it-IT', { month: 'short' })}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowT}>{hhmm(r.starts_at, r.salons.timezone)}, {r.services.name}</Text>
            <Text style={s.rowSub}>con {r.staff.name}, {r.salons.name}</Text>
            <Pressable onPress={() => cancel(r.id)} style={{ marginTop: 10 }}>
              <Text style={{ color: C.danger, fontWeight: '700' }}>Disdici</Text>
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
              <Text style={{ color: C.red, fontWeight: '700' }}>Elimina</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ───────── Agenda per barbieri e titolare ─────────
function Agenda({ staff }: { staff: StaffScope }) {
  const days = useMemo(
    () => Array.from({ length: 15 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i - 1); return d; }),
    []
  );
  const [salons, setSalons] = useState<any[]>([]);
  const [salon, setSalon] = useState<any>(null);
  const [day, setDay] = useState<Date>(days[1]);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('salons').select('id,name,timezone').eq('active', true).order('name').then(({ data }) => {
      const list = (data ?? []).filter((x: any) => !staff.salonIds || staff.salonIds.includes(x.id));
      setSalons(list);
      setSalon(list[0] ?? null);
    });
  }, [staff]);

  const load = useCallback(async () => {
    if (!salon) return;
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const { data } = await supabase
      .from('appointments')
      .select('id,starts_at,status,source,customer_id,reward_id,guest_name,guest_phone,profiles(full_name,phone),services(name),staff(name)')
      .eq('salon_id', salon.id)
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .neq('status', 'cancelled')
      .order('starts_at');
    setRows(data ?? []);
  }, [salon, day]);

  useEffect(() => { load(); }, [load]);

  const rewards = useRewards(rows);

  // Un blocco per barbiere, con i suoi appuntamenti in ordine di orario
  const byStaff: Record<string, any[]> = {};
  rows.forEach((r) => { (byStaff[r.staff.name] ||= []).push(r); });

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <View style={s.wrap}>
        {salons.map((x) => (
          <Chip key={x.id} label={x.name} on={salon?.id === x.id} onPress={() => setSalon(x)} />
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 14 }}>
        {days.map((d) => (
          <DayTile key={ymd(d)} d={d} on={ymd(d) === ymd(day)} onPress={() => setDay(d)} />
        ))}
      </ScrollView>

      {salon && rows.length === 0 && <Text style={[s.muted, { marginTop: 24 }]}>Nessun appuntamento in questo giorno.</Text>}

      {Object.entries(byStaff).map(([name, list]) => (
        <View key={name}>
          <Title t={name} />
          {list.map((r) => (
            <ApptCard key={r.id} r={r} tz={salon.timezone} hasReward={rewards.has(r.customer_id)} reload={load} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ───────── Avatar ─────────
function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: url }} style={[base, { backgroundColor: C.card2 }]} />;
  const ini = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[base, { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: C.accentText, fontWeight: '800', fontSize: size * 0.38 }}>{ini}</Text>
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
        <Text style={s.h1}>La mia giornata</Text>
        <Text style={s.muted}>Il tuo accesso non è ancora collegato a un barbiere. Il titolare deve collegarlo nella tabella staff (colonna user_id).</Text>
      </ScrollView>
    );
  }

  const todo = rows.filter((r) => r.status === 'confirmed').length;
  const done = rows.filter((r) => r.status === 'completed').length;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>La mia giornata</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
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
      <Text style={s.h1}>I nostri barbieri</Text>
      <Text style={s.muted}>{canEdit ? 'Tocca una foto per cambiarla.' : uid ? 'Tocca la stella per scegliere il tuo barbiere preferito.' : 'Il team di DF Barbershop.'}</Text>
      <View style={s.grid}>
        {rows.map((st) => (
          <Pressable key={st.id} style={s.barber} onPress={() => pick(st)}>
            {st.photo_url ? (
              <Image source={{ uri: st.photo_url }} style={s.barberPhoto} />
            ) : (
              <LinearGradient colors={[C.barberA, C.barberB]} style={[s.barberPhoto, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: C.accentText, fontSize: 44, fontWeight: '800' }}>
                  {st.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </LinearGradient>
            )}
            {busyId === st.id && <ActivityIndicator style={StyleSheet.absoluteFill} color={C.accentText} />}
            {canEdit && <View style={s.camera}><Ionicons name="camera" size={16} color="#000" /></View>}
            {uid ? (
              <Pressable style={s.favBtn} onPress={() => toggleFav(st)} hitSlop={8}>
                <Ionicons name={favId === st.id ? 'star' : 'star-outline'} size={18} color="#ECC052" />
              </Pressable>
            ) : null}
            <Text style={[s.rowT, { marginTop: 10 }]} numberOfLines={1}>{st.name}</Text>
            <Text style={s.rowSub} numberOfLines={2}>
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
      <LinearGradient colors={[C.loyA, C.loyB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.loyHero}>
        <View style={s.heroTop}>
          <Text style={s.heroLabel}>CARTA FEDELTÀ</Text>
          <Ionicons name="ribbon" size={22} color={C.accentText} />
        </View>
        <Text style={s.heroNum}>{balance}<Text style={s.heroOf}> / {need}</Text></Text>
        <Text style={s.rowSub}>punti accumulati</Text>
        <View style={s.stamps}>
          {Array.from({ length: 10 }, (_, i) => (
            <View key={i} style={[s.stamp, i < Math.floor(pct * 10 + 0.0001) && s.stampOn]}>
              {i < Math.floor(pct * 10 + 0.0001) && <Ionicons name="cut" size={13} color="#000" />}
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
      </LinearGradient>

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
      <LinearGradient colors={[C.mapA, C.mapB]} style={StyleSheet.absoluteFill} />
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
        <Glass radius={16} style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="navigate" size={14} color={C.accentText} />
          <Text style={s.mapTagT}>Apri in Google Maps</Text>
        </Glass>
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
        <Text style={s.h1}>Contatti</Text>
        <Text style={s.muted}>Nessuna sede disponibile al momento.</Text>
      </ScrollView>
    ) : (
      <ActivityIndicator style={{ marginTop: 80 }} color={C.accentText} />
    );
  }

  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingBottom: 90 }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.h1}>Contatti</Text>
      <View style={[s.wrap, { marginTop: 10 }]}>
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
          <Glass radius={20} style={s.actBtn}>
            <Ionicons name="call" size={24} color={C.accentText} />
            <Text style={s.actT}>Chiama</Text>
          </Glass>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => (sel.whatsapp ? openUrl(waUrl(sel.whatsapp)) : need('WhatsApp'))}>
          <Glass radius={20} style={s.actBtn}>
            <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
            <Text style={s.actT}>WhatsApp</Text>
          </Glass>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => (sel.address ? openUrl(mapsRoute(sel.address)) : need('di indirizzo'))}>
          <Glass radius={20} style={s.actBtn}>
            <Ionicons name="navigate" size={24} color={C.accentText} />
            <Text style={s.actT}>Navigazione</Text>
          </Glass>
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
        <Text style={s.h1}>Control room</Text>
        <Text style={s.muted}>Dati non disponibili. Controlla di aver eseguito la migrazione v2 nel database e di essere entrato come titolare.</Text>
      </ScrollView>
    );
  }
  if (!d) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.h1}>Control room</Text>
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
      <Text style={s.h1}>Control room</Text>
      {periods}

      <LinearGradient colors={[C.loyA, C.loyB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.loyHero, { marginTop: 18 }]}>
        <Text style={s.heroLabel}>INCASSO TOTALE, ULTIMI {days} GIORNI</Text>
        <Text style={[s.heroNum, { marginTop: 8 }]}>{eur(total)}</Text>
        <Text style={s.rowSub}>
          {cuts} servizi completati{best ? `, giorno migliore ${new Date(`${best.day}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} (${eur(best.revenue)})` : ''}
        </Text>
        <View style={[s.wrap, { marginTop: 14 }]}>
          <View style={s.kpi}><Text style={s.kpiBig}>{eur(servicesTot)}</Text><Text style={s.rowSub}>Servizi</Text></View>
          <View style={s.kpi}><Text style={s.kpiBig}>{eur(shopTot)}</Text><Text style={s.rowSub}>Shop</Text></View>
        </View>
      </LinearGradient>

      <Title t="Incasso per sede" />
      <View style={[s.wrap, { marginBottom: 12 }]}>
        <Text style={s.rowSub}>● Servizi</Text>
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
      <Text style={s.h1}>Altro</Text>
      <View style={{ marginTop: 14 }}>
        {items.map(([id, title, icon, sub]) => (
          <Pressable key={id} style={s.row} onPress={() => go(id)}>
            <View style={s.menuIcon}><Ionicons name={icon as any} size={22} color={C.accentText} /></View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.rowT}>{title}</Text>
              <Text style={s.rowSub}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </Pressable>
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

  if (!ready) return <View style={s.root}><ActivityIndicator style={{ marginTop: 120 }} color={C.ink} /></View>;

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
          <Header onLogout={() => supabase.auth.signOut()} onMenu={staff || !roleReady ? undefined : () => setMenu(true)} />
          {sub && (
            <Pressable style={s.back} onPress={() => setTab('more')}>
              <Ionicons name="chevron-back" size={20} color={C.accentText} />
              <Text style={s.backT}>Altro</Text>
            </Pressable>
          )}
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
          <View style={s.tabWrap}>
            <LinearGradient colors={[C.bg, C.tabEnd]} style={StyleSheet.absoluteFill} />
            <Glass radius={30} style={s.tabbar}>
              {tabs.map(([id, label, icon]) => {
                const on = active === id;
                return (
                  <Pressable key={id} style={s.tabItem} onPress={() => setTab(id)}>
                    <View style={[s.tabPill, on && s.tabPillOn]}>
                      <Ionicons name={icon as any} size={22} color={on ? C.accentText : C.muted} />
                      <Text numberOfLines={1} style={[s.tabLabel, on && { color: C.accentText }]}>{label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </Glass>
          </View>

          <Modal visible={menu && !staff} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
            <Pressable style={s.backdrop} onPress={() => setMenu(false)} />
            <View style={s.sheet}>
              <Text style={s.h2}>Account</Text>
              <Text style={[s.rowSub, { marginBottom: 14 }]}>{session.user.email}</Text>
              <Pressable style={s.row} onPress={() => { setMenu(false); supabase.auth.signOut(); }}>
                <View style={s.menuIcon}><Ionicons name="log-out-outline" size={22} color={C.accentText} /></View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={s.rowT}>Esci</Text>
                  <Text style={s.rowSub}>Disconnetti questo dispositivo</Text>
                </View>
              </Pressable>
              <Pressable style={s.row} onPress={() => { setMenu(false); setTimeout(askDeleteAccount, 450); }}>
                <View style={[s.menuIcon, { backgroundColor: C.dangerSoft }]}><Ionicons name="trash-outline" size={22} color={C.danger} /></View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[s.rowT, { color: C.danger }]}>Elimina account</Text>
                  <Text style={s.rowSub}>Cancella il tuo profilo e i dati personali</Text>
                </View>
              </Pressable>
            </View>
          </Modal>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

function makeStyles() {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 20, paddingBottom: 40 },
  h1: { fontSize: 30, fontWeight: '800', color: C.text, letterSpacing: -0.8, marginBottom: 6 },
  h2: { fontSize: 18, fontWeight: '700', color: C.text, letterSpacing: -0.2 },
  muted: { color: C.muted, fontSize: 15, lineHeight: 22 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  headerWrap: { borderBottomWidth: 1, borderBottomColor: C.line },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  logoPill: { paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  headerLogo: { width: 132, height: 20 },
  logoutBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  brand: { color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  brandBig: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: 0.5, marginTop: 16 },
  back: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10 },
  backT: { color: C.accentText, fontSize: 16, fontWeight: '700' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 30, marginBottom: 12 },
  stepNum: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stepNumOn: { backgroundColor: C.accent, borderColor: C.accentBorder },
  stepNumT: { color: C.muted, fontSize: 13, fontWeight: '800' },

  chip: { backgroundColor: C.card2, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 11, paddingHorizontal: 16 },
  chipOn: { backgroundColor: C.accent, borderColor: C.accentBorder },
  chipT: { fontSize: 16, fontWeight: '600', color: C.text },
  chipSub: { fontSize: 13, color: C.muted, marginTop: 2 },
  onT: { color: '#000000' },

  cat: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 15, marginBottom: 10 },
  rowOn: { borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  rowT: { color: C.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: C.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  price: { color: C.accentText, fontSize: 16, fontWeight: '800' },

  dayTile: { width: 64, alignItems: 'center', paddingVertical: 11, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2 },
  dayW: { color: C.muted, fontSize: 12, fontWeight: '600' },
  dayN: { color: C.text, fontSize: 22, fontWeight: '800', marginVertical: 2 },

  slot: { backgroundColor: C.card2, borderRadius: 14, borderWidth: 1, borderColor: C.line, width: 80, alignItems: 'center', paddingVertical: 13 },
  slotT: { fontSize: 17, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },

  btn: { backgroundColor: C.accent, borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginTop: 16 },
  btnT: { color: '#000000', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  input: { backgroundColor: C.card2, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 15, fontSize: 16, color: C.text, marginTop: 10 },

  tabWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: C.line },
  tabbar: { flexDirection: 'row', padding: 5 },
  tabItem: { flex: 1 },
  tabPill: { alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 22, borderWidth: 1, borderColor: 'transparent' },
  tabPillOn: { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  tabLabel: { color: C.muted, fontSize: 10, fontWeight: '700' },

  card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16, marginBottom: 12 },
  link: { fontSize: 15, fontWeight: '700', color: C.accentText, paddingVertical: 4, paddingRight: 14 },
  badge: { width: 54, height: 60, borderRadius: 14, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  badgeN: { color: C.accentText, fontSize: 22, fontWeight: '800' },
  badgeM: { color: C.accentText, fontSize: 12, fontWeight: '700' },
  timeBig: { color: C.accentText, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 62 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 18 },
  product: { width: '48%', backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 12 },
  productIcon: { height: 96, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  productIconBig: { height: 130, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  productImg: { width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#F4F0E6', marginBottom: 12 },
  productImgBig: { width: '100%', height: 200, borderRadius: 20, backgroundColor: '#F4F0E6', marginBottom: 16 },
  cartImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#F4F0E6', marginRight: 12 },
  productFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  plus: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  cartBar: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.accent, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 20 },
  cartT: { color: '#000000', fontSize: 16, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: C.scrim },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.line, padding: 22, paddingBottom: 34 },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  qtyT: { color: C.text, fontSize: 16, fontWeight: '800', minWidth: 22, textAlign: 'center', marginLeft: 8 },

  barber: { width: '48%' },
  barberPhoto: { width: '100%', aspectRatio: 1, borderRadius: 22, backgroundColor: C.card2 },
  camera: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },

  loyHero: { borderRadius: 26, borderWidth: 1, borderColor: C.accentBorder, padding: 20, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { color: C.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  heroNum: { color: C.text, fontSize: 52, fontWeight: '800', letterSpacing: -1.5, marginTop: 10 },
  heroOf: { color: C.muted, fontSize: 24, fontWeight: '600', letterSpacing: 0 },
  stamps: { flexDirection: 'row', gap: 6, marginTop: 18, marginBottom: 14 },
  stamp: { flex: 1, aspectRatio: 1, borderRadius: 99, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  stampOn: { backgroundColor: C.accent, borderColor: C.accentBorder },
  track: { height: 8, borderRadius: 4, backgroundColor: C.card2, flexDirection: 'row', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: C.accent },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  kpi: { backgroundColor: C.card2, borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingVertical: 12, paddingHorizontal: 16, minWidth: 104 },
  kpiBig: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  cols: { flexDirection: 'row', alignItems: 'flex-end', height: 124, gap: 2 },
  colWrap: { flex: 1, justifyContent: 'flex-end' },
  col: { backgroundColor: C.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 },

  // Pagina iniziale e accesso
  welcome: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 28 },
  welGlowSm: { position: 'absolute', top: 40, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(236,192,82,0.14)', shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 50, shadowOffset: { width: 0, height: 0 } },

  authPad: { paddingHorizontal: 24 },
  authBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginLeft: -6, paddingVertical: 6 },
  authMini: { width: 84, height: 84, marginTop: 10, marginBottom: 14 },
  fieldLabel: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  fieldBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card2, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14 },
  fieldInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 16, paddingVertical: 14 },
  fieldErr: { color: C.danger, fontSize: 12.5, marginTop: 5 },
  formErr: { color: C.danger, fontSize: 14, lineHeight: 20, marginTop: 14 },

  // Conferma dopo la registrazione
  doneRoot: { flex: 1, backgroundColor: C.bg },
  doneBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  doneIcon: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  doneKicker: { color: C.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  doneTitle: { color: C.text, fontSize: 36, textAlign: 'center', marginTop: 10, marginBottom: 14 },
  doneSub: { color: C.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  doneMail: { color: C.accentText, fontSize: 17, fontWeight: '800', textAlign: 'center', marginVertical: 6 },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  doneBtnT: { color: C.text, fontSize: 16, fontWeight: '800' },

  // Prenotazione: barbieri e barra in basso
  pickRow: { paddingHorizontal: 20, gap: 12, paddingBottom: 4 },
  bCard: { width: 116, alignItems: 'center', padding: 10, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  bCardOn: { borderColor: C.accentBorder, backgroundColor: C.accentSoft },
  bPhoto: { width: 92, height: 92, borderRadius: 46, backgroundColor: C.card2 },
  bIni: { color: C.accentText, fontSize: 30, fontWeight: '800' },
  bCheck: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  bName: { color: C.text, fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 10, minHeight: 36 },
  hisHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  hisKicker: { color: C.accentText, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, marginBottom: 2 },
  hisStats: { flexDirection: 'row', gap: 10 },
  hisTile: { flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center' },
  hisNum: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  hisLbl: { color: C.muted, fontSize: 11, fontWeight: '600', marginTop: 3, textAlign: 'center' },
  hisSection: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  hisRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 8 },
  hisDate: { width: 48, height: 52, borderRadius: 13, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  hisDay: { color: C.accentText, fontSize: 19, fontWeight: '800', lineHeight: 22 },
  hisMon: { color: C.accentText, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  hisState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hisTag: { fontSize: 12, fontWeight: '700' },
  hisEmpty: { alignItems: 'center', backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, paddingVertical: 24, paddingHorizontal: 22 },
  bookBar: { position: 'absolute', left: 14, right: 14, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.accentBorder, padding: 12, paddingLeft: 16, shadowColor: C.shadow, shadowOpacity: C.shadowO, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  bookGo: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 20 },

  // Pagina del calendario
  calRoot: { flex: 1, backgroundColor: C.bg },
  calTop: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingBottom: 10 },
  calTitle: { color: C.text, fontSize: 26 },
  calBody: { padding: 16, paddingBottom: 30 },
  calCard: { backgroundColor: C.calCard, borderRadius: 28, borderWidth: 1, borderColor: C.accentLine, padding: 14, shadowColor: C.accent, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calArrow: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  calMonth: { color: C.text, fontSize: 28, lineHeight: 34 },
  calYear: { color: C.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellHead: { width: '14.28%', alignItems: 'center', paddingVertical: 8 },
  calWeekT: { color: C.muted, fontSize: 12, fontWeight: '800' },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 3 },
  calDay: { width: '100%', height: '100%', borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  calToday: { borderWidth: 1.5, borderColor: C.accentLine2 },
  calSel: { backgroundColor: C.accent, shadowColor: C.accent, shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  calNum: { color: C.text, fontSize: 16, fontWeight: '700' },
  calOff: { color: C.calOff, fontWeight: '500' },
  calDot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  calDot2: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 8 },
  calLegend: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 4 },
  calSlotsTitle: { color: C.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 26, marginBottom: 12 },
  calBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.calBar },

  // Profilo
  profName: { color: C.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },

  // Contatti
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  infoT: { flex: 1, color: C.text, fontSize: 15, lineHeight: 21 },
  prefBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: C.accentLine2 },
  prefBtnT: { color: C.accentText, fontSize: 15, fontWeight: '700' },
  actRow: { flexDirection: 'row', gap: 10 },
  actBtn: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  actT: { color: C.text, fontSize: 13, fontWeight: '800' },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  openDot: { width: 10, height: 10, borderRadius: 5 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  hoursDay: { color: C.text, fontSize: 15, fontWeight: '700' },
  hoursT: { color: C.text, fontSize: 15, fontVariant: ['tabular-nums'] },

  // Pagina iniziale (nuova)
  welBrand: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 18 },
  welMask: { alignSelf: 'stretch', overflow: 'hidden', paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  welTitle: { color: C.welTitle, textAlign: 'center' },
  welLine: { width: 56, height: 1, backgroundColor: C.welLine, marginTop: 18 },
  welSub: { color: C.muted, fontSize: 11, fontWeight: '600', letterSpacing: 3.2, marginTop: 16, textAlign: 'center' },
  welActions: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 },
  welPrimaryWrap: { borderRadius: 28, shadowColor: C.accent, shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  welPrimary: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  welPrimaryT: { color: '#000000', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  welGhost: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.accentLine, backgroundColor: C.welGhostBg },
  welGhostT: { color: C.welTitle, fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },

  // Preferiti, profilo, mappa
  bFav: { position: 'absolute', left: -2, top: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  favBtn: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(236,192,82,0.5)', alignItems: 'center', justifyContent: 'center' },
  pickRowCard: { paddingHorizontal: 16, gap: 12 },
  profRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  mapBox: { height: MAP_H, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 },
  mapTag: { position: 'absolute', right: 10, bottom: 10 },
  mapTagT: { color: C.text, fontSize: 13, fontWeight: '800' },
  mapAttr: { position: 'absolute', left: 8, bottom: 6, color: 'rgba(248,244,234,0.7)', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  pinWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pinRing: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(236,192,82,0.28)', borderWidth: 1.5, borderColor: 'rgba(236,192,82,0.8)' },
});
}
let s = makeStyles();
