import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, PiggyBank, Home,
  CreditCard, Copy, LayoutGrid, PencilLine, History as HistoryIcon,
  Settings2, Save, ArrowRight, Landmark, PieChart as PieChartIcon, Layers, Car
} from 'lucide-react';

/* ---------- design tokens ---------- */
const C = {
  bg: '#12151b',
  surface: '#1a1f28',
  panel: '#1d232e',
  border: '#2b3341',
  borderSoft: '#242b37',
  text: '#eae6db',
  textMuted: '#93a0b5',
  textFaint: '#5d6577',
  gold: '#c9a227',
  goldSoft: '#e7c565',
  teal: '#52a29d',
  tealSoft: '#7ec0bb',
  rust: '#c16a48',
  blue: '#6f93cc',
  violet: '#8b7fc7',
};

const GROUP_META = {
  liquid:     { label: 'Likvidna imovina',     icon: Wallet,      color: C.teal },
  pension:    { label: 'Mirovinski stupovi',   icon: PiggyBank,   color: C.blue },
  liability:  { label: 'Obaveze',              icon: CreditCard,  color: C.rust },
  realestate: { label: 'Nekretnine',           icon: Home,        color: C.gold },
  offbalance: { label: 'Vanbilanca',           icon: Landmark,    color: C.violet },
};
const GROUP_ORDER = ['liquid', 'pension', 'liability', 'realestate', 'offbalance'];
// Vanbilanca se prati radi uvida, ali namjerno NE ulazi u netLiquid/netTotal
// (isto kao u izvornom Excelu) - npr. državni 2. mirovinski stup koji nije
// dio aktivne FIRE strategije.
const OFFBALANCE_NOTE = 'Prati se odvojeno, ne ulazi u neto vrijednost.';

// Diverzifikacija portfelja - druga "os" gledanja na iste kategorije,
// neovisna o grupama gore (koje su likvidno/mirovine/obaveze/nekretnine/vanbilanca).
// Namjerno isključuje obaveze - prikazuje samo bruto raspodjelu imovine po
// klasama. 2. mirovinski stup (Vanbilanca) JE uključen ovdje, pod "Mirovinski",
// iako se u glavnoj neto vrijednosti (Pregled) namjerno ne računa.
const ASSET_CLASSES = [
  { id: 'realestate', label: 'Nekretnine', color: '#a97155', categoryIds: ['poljica'], labels: [] },
  { id: 'pension', label: 'Mirovinski', color: '#6f93cc', categoryIds: ['treciStup', 'pepp', 'mirovinski2'], labels: [] },
  { id: 'etf', label: 'ETF (dionice/obveznice)', color: '#52a29d', categoryIds: ['trading212', 'revolut'], labels: ['genius by intercapital', 'genius'] },
  { id: 'cash', label: 'Cash', color: '#c9c2a8', categoryIds: ['tekuci'], labels: ['cash is king'] },
  { id: 'shortterm', label: 'Kratkoročni novčani depoziti', color: '#8fb8a8', categoryIds: ['mmdp', 'strc'], labels: [] },
  { id: 'bitcoin', label: 'Bitcoin', color: '#e8934a', categoryIds: ['btc'], labels: [] },
  { id: 'gold', label: 'Zlato', color: '#d4af37', categoryIds: ['zlato'], labels: [] },
  { id: 'silver', label: 'Srebro', color: '#b8bec7', categoryIds: ['srebro'], labels: [] },
  { id: 'art', label: 'Umjetnine i kolekcionarski predmeti', color: '#9c6f9e', categoryIds: [], labels: ['umjetnine', 'kolekcionarski predmeti', 'umjetnine i kolekcionarski predmeti', 'umjetnine, kolekcionarski predmeti'] },
];

const findAssetClass = (category) => ASSET_CLASSES.find(
  (ac) => ac.categoryIds.includes(category.id) || ac.labels.includes((category.label || '').trim().toLowerCase())
);

// computeAssetBreakdown prima i categories (ne samo fiksne id-eve), da uhvati
// i naknadno dodane kategorije koje se prepoznaju po nazivu (vidi findAssetClass).
const computeAssetBreakdown = (snap, categories) => {
  if (!snap) return [];
  const totals = Object.fromEntries(ASSET_CLASSES.map((ac) => [ac.id, 0]));
  (categories || []).forEach((c) => {
    const ac = findAssetClass(c);
    if (!ac) return;
    totals[ac.id] += Number(snap.values?.[c.id] || 0);
  });
  return ASSET_CLASSES.map((ac) => ({ ...ac, value: totals[ac.id] }));
};

// Treća "os" gledanja na iste kategorije (uz grupe iz Unosa i klase iz
// Diverzifikacije): svaka stavka imovine je Novac (gotovina/gotovinski
// ekvivalenti, spremno za trošenje bez gubitka vrijednosti), Proizvodna
// imovina (raste u vrijednosti / generira prihod - dionice, mirovinski
// fondovi, ali i store-of-value imovina poput BTC-a, zlata i srebra, te
// zemljište kao kapitalni lever) ili Potrošna imovina (gubi vrijednost ili
// se troši osobnom uporabom - trenutno nema default kategorije ovdje, ali
// je dostupna za buduće). Obaveze su namjerno izostavljene, isto kao u
// Diverzifikaciji - ovo je prikaz bruto imovine, ne neto vrijednosti.
const WEALTH_TYPES = [
  { id: 'cash', label: 'Novac', color: C.tealSoft, categoryIds: ['tekuci', 'mmdp', 'strc'], labels: ['cash is king'] },
  { id: 'productive', label: 'Proizvodna imovina', color: C.gold, categoryIds: ['revolut', 'trading212', 'treciStup', 'pepp', 'mirovinski2', 'btc', 'zlato', 'srebro', 'poljica'], labels: ['genius by intercapital', 'genius', 'umjetnine', 'kolekcionarski predmeti', 'umjetnine i kolekcionarski predmeti', 'umjetnine, kolekcionarski predmeti'] },
  { id: 'consumption', label: 'Potrošna imovina', color: C.rust, categoryIds: [], labels: [] },
];
const findWealthType = (category) => WEALTH_TYPES.find(
  (wt) => wt.categoryIds.includes(category.id) || (wt.labels || []).includes((category.label || '').trim().toLowerCase())
);

const computeWealthBreakdown = (snap, categories) => {
  if (!snap) return [];
  const totals = Object.fromEntries(WEALTH_TYPES.map((wt) => [wt.id, 0]));
  (categories || []).forEach((c) => {
    const wt = findWealthType(c);
    if (!wt) return;
    totals[wt.id] += Number(snap.values?.[c.id] || 0);
  });
  return WEALTH_TYPES.map((wt) => ({ ...wt, value: totals[wt.id] }));
};

// Potrošna imovina (auto, nekretnina gdje živiš, elektronika...) se NE prati
// mjesečno kao ostale kategorije - unosi se JEDNOM (nabavna vrijednost + datum),
// a trenutna procijenjena vrijednost se računa automatski (amortizacija po
// godišnjoj stopi, opadajući saldo). Za nekretninu gdje živiš amortizacija je
// namjerno isključena (0%) jer automatska formula ne može pouzdano pogoditi
// tržišne promjene/održavanje - umjesto toga se prikazuje podsjetnik da se
// procjena periodički ručno revidira ("Ažuriraj procjenu").
const CONSUMPTION_TYPES = [
  { id: 'auto', label: 'Automobil', defaultDepreciationRate: 15, warningMonths: null },
  { id: 'nekretnina', label: 'Nekretnina (gdje živim)', defaultDepreciationRate: 0, warningMonths: 24 },
  { id: 'elektronika', label: 'Elektronika', defaultDepreciationRate: 25, warningMonths: null },
  { id: 'namjestaj', label: 'Namještaj', defaultDepreciationRate: 10, warningMonths: null },
  { id: 'nakit', label: 'Nakit (osobna uporaba)', defaultDepreciationRate: 5, warningMonths: null },
  { id: 'plovilo', label: 'Plovilo / motor / prikolica', defaultDepreciationRate: 12, warningMonths: null },
  { id: 'ostalo', label: 'Ostalo', defaultDepreciationRate: 10, warningMonths: null },
];
const findConsumptionType = (id) => CONSUMPTION_TYPES.find((t) => t.id === id) || CONSUMPTION_TYPES[CONSUMPTION_TYPES.length - 1];

const monthsBetween = (fromYYYYMM, toDate) => {
  if (!fromYYYYMM) return 0;
  const [fy, fm] = fromYYYYMM.split('-').map(Number);
  if (!fy || !fm) return 0;
  return (toDate.getFullYear() - fy) * 12 + (toDate.getMonth() + 1 - fm);
};

// Ako je postavljen ručni "value override" (korisnik je ažurirao procjenu),
// amortizacija kreće otamo (nova nulta točka), a ne od izvorne nabavne cijene.
const computeConsumptionValue = (asset, asOf = new Date()) => {
  const hasOverride = asset.valueOverride !== null && asset.valueOverride !== undefined && asset.valueOverride !== '';
  const baseValue = hasOverride ? Number(asset.valueOverride) : Number(asset.purchaseValue);
  const baseDate = hasOverride ? asset.overrideDate : asset.purchaseDate;
  const months = Math.max(0, monthsBetween(baseDate, asOf));
  const years = months / 12;
  const rate = Number(asset.depreciationRate) || 0;
  const currentValue = rate > 0 ? baseValue * Math.pow(1 - rate / 100, years) : baseValue;
  return { currentValue: Math.max(0, currentValue), monthsSinceBase: months, baseDate, baseValue };
};

const DEFAULT_CATEGORIES = [
  { id: 'tekuci', label: 'Tekući (OTP)', group: 'liquid' },
  { id: 'revolut', label: 'Revolut (dionice)', group: 'liquid' },
  { id: 'trading212', label: 'Trading212 (dionice)', group: 'liquid' },
  { id: 'btc', label: 'BTC', group: 'liquid' },
  { id: 'zlato', label: 'Zlato', group: 'liquid' },
  { id: 'srebro', label: 'Srebro', group: 'liquid' },
  { id: 'mmdp', label: 'MMDP', group: 'liquid' },
  { id: 'strc', label: 'STRC', group: 'liquid' },
  { id: 'mirovinski2', label: '2. mirovinski stup', group: 'offbalance' },
  { id: 'treciStup', label: '3. stup', group: 'pension' },
  { id: 'pepp', label: 'PEPP', group: 'pension' },
  { id: 'kredit', label: 'Kredit (stambeni)', group: 'liability' },
  { id: 'kreditnaKartica', label: 'Kreditna kartica', group: 'liability' },
  { id: 'poljica', label: 'Poljica (zemljište)', group: 'realestate' },
];

const MONTHS_HR = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
const MONTHS_HR_FULL = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];

const uid = () => Math.random().toString(36).slice(2, 9);
const fmt0 = (n) => new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const fmt = (n) => fmt0(n) + ' €';
const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmt(n);
const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS_HR[mo - 1]} ${String(y).slice(2)}`; };
const monthLabelFull = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS_HR_FULL[mo - 1]} ${y}`; };
const thisMonthStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const PIE_TEAL = ['#52a29d', '#7ec0bb', '#3c7c78', '#9ad4d0', '#2b615d'];
const PIE_BLUE = ['#6f93cc', '#93b1de', '#4f74ad'];

const computeTotals = (snap, categories) => {
  if (!snap) return { liquid: 0, pension: 0, liability: 0, realestate: 0, offbalance: 0, netLiquid: 0, netTotal: 0, income: 0, expense: 0 };
  let liquid = 0, pension = 0, liability = 0, realestate = 0, offbalance = 0;
  categories.forEach((c) => {
    const v = Number(snap.values?.[c.id] || 0);
    if (c.group === 'liquid') liquid += v;
    else if (c.group === 'pension') pension += v;
    else if (c.group === 'liability') liability += v;
    else if (c.group === 'realestate') realestate += v;
    else if (c.group === 'offbalance') offbalance += v;
  });
  // namjerno: offbalance NIJE dio netLiquid/netTotal
  const netLiquid = liquid + pension - liability;
  const netTotal = netLiquid + realestate;
  const income = (snap.income || []).reduce((s, i) => s + Number(i.amount || 0), 0);
  const expense = (snap.expenses || []).reduce((s, i) => s + Number(i.amount || 0), 0);
  return { liquid, pension, liability, realestate, offbalance, netLiquid, netTotal, income, expense };
};

/* =========================================================================
   Sve komponente ispod žive na razini modula (izvan App-a) namjerno.
   Kad bi bile definirane unutar App() tijela, svaki render App-a bi ih
   iznova "stvorio" kao novi tip komponente, pa bi React na svaki keystroke
   uništio i ponovno montirao <input> polja -> gubitak fokusa nakon
   svakog slova. Ovime je taj bug otklonjen.
   ========================================================================= */

function Card({ children, style, className = '' }) {
  return (
    <div className={`rounded-lg ${className}`} style={{ background: C.panel, border: `1px solid ${C.border}`, ...style }}>{children}</div>
  );
}

function TabButton({ id, label, icon: Icon, activeTab, onSelect }) {
  return (
    <button
      onClick={() => onSelect(id)}
      className="flex items-center gap-2 px-3.5 py-2 text-sm rounded-md transition-colors"
      style={{
        color: activeTab === id ? C.bg : C.textMuted,
        background: activeTab === id ? C.goldSoft : 'transparent',
        fontWeight: activeTab === id ? 600 : 500,
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}

function LineRow({ keyName, placeholder, draft, setDraft }) {
  return (
    <div className="space-y-2">
      {(draft[keyName] || []).map((row) => (
        <div key={row.id} className="flex gap-2 items-center">
          <input
            value={row.label}
            onChange={(e) => setDraft({ ...draft, [keyName]: draft[keyName].map((r) => r.id === row.id ? { ...r, label: e.target.value } : r) })}
            placeholder={placeholder} className="flex-1 text-sm rounded-md px-2.5 py-1.5"
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}
          />
          <input
            type="number"
            value={row.amount}
            onChange={(e) => setDraft({ ...draft, [keyName]: draft[keyName].map((r) => r.id === row.id ? { ...r, amount: e.target.value } : r) })}
            placeholder="0" className="w-28 text-sm rounded-md px-2.5 py-1.5 text-right"
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontVariantNumeric: 'tabular-nums' }}
          />
          <button onClick={() => setDraft({ ...draft, [keyName]: draft[keyName].filter((r) => r.id !== row.id) })} style={{ color: C.textFaint }}><Trash2 size={15} /></button>
        </div>
      ))}
      <button
        onClick={() => setDraft({ ...draft, [keyName]: [...(draft[keyName] || []), { id: uid(), label: '', amount: '' }] })}
        className="text-xs inline-flex items-center gap-1 mt-1" style={{ color: C.textMuted }}
      >
        <Plus size={13} /> Dodaj stavku
      </button>
    </div>
  );
}

function Overview({ latest, latestT, previous, momChange, momPct, chartData, liquidPie, totalPie, onStartDraft }) {
  return (
    <div className="space-y-6">
      {!latest ? (
        <Card style={{ padding: '48px 32px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 22, color: C.text, marginBottom: 8 }}>Knjiga je još prazna.</p>
          <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 20 }}>Unesi svoj prvi mjesečni presjek stanja i krećemo pratiti napredak.</p>
          <button onClick={() => onStartDraft()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold" style={{ background: C.goldSoft, color: C.bg }}>
            <Plus size={16} /> Unesi prvi mjesec
          </button>
        </Card>
      ) : (
        <>
          <Card style={{ padding: '28px 28px' }}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint, letterSpacing: '0.08em' }}>Neto vrijednost · {monthLabelFull(latest.month)}</div>
                <div style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 44, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                  {fmt(latestT.netTotal)}
                </div>
                <div className="text-sm mt-1" style={{ color: C.textMuted }}>
                  od čega likvidno (bez nekretnina): <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(latestT.netLiquid)}</span>
                </div>
              </div>
              {momChange !== null && (
                <div className="rounded-md px-3.5 py-2.5 flex items-center gap-2" style={{ background: momChange >= 0 ? 'rgba(82,162,157,0.12)' : 'rgba(193,106,72,0.12)', border: `1px solid ${momChange >= 0 ? C.teal : C.rust}55` }}>
                  {momChange >= 0 ? <TrendingUp size={16} color={C.teal} /> : <TrendingDown size={16} color={C.rust} />}
                  <div>
                    <div style={{ color: momChange >= 0 ? C.tealSoft : C.rust, fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(momChange)}</div>
                    <div style={{ color: C.textFaint, fontSize: 11 }}>u odnosu na {monthLabel(previous.month)}{momPct !== null ? ` · ${momPct >= 0 ? '+' : ''}${momPct.toFixed(1)}%` : ''}</div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Likvidna imovina', value: latestT.liquid + latestT.pension, color: C.teal },
              { label: 'Obaveze', value: -latestT.liability, color: C.rust },
              { label: 'Nekretnine', value: latestT.realestate, color: C.gold },
              { label: 'Prihod − rashod', value: latestT.income - latestT.expense, color: (latestT.income - latestT.expense) >= 0 ? C.teal : C.rust },
            ].map((s) => (
              <Card key={s.label} style={{ padding: '14px 16px', borderLeft: `3px solid ${s.color}` }}>
                <div className="text-xs" style={{ color: C.textFaint }}>{s.label}</div>
                <div style={{ color: C.text, fontSize: 19, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmt(s.value)}</div>
              </Card>
            ))}
          </div>

          {latestT.offbalance > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-md text-sm" style={{ border: `1px dashed ${C.violet}66`, color: C.violet }}>
              <Landmark size={14} />
              <span>Vanbilanca: <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(latestT.offbalance)}</span></span>
              <span style={{ color: C.textFaint, fontSize: 12 }}>· {OFFBALANCE_NOTE}</span>
            </div>
          )}

          <Card style={{ padding: '20px 20px 8px' }}>
            <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Neto vrijednost kroz vrijeme</div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ left: -10, right: 10 }}>
                <defs>
                  <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.gold} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.gold} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLiquid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.teal} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.borderSoft} vertical={false} />
                <XAxis dataKey="month" stroke={C.textFaint} tick={{ fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis stroke={C.textFaint} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
                <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.text }} formatter={(v, n) => [fmt(v), n === 'total' ? 'Ukupno' : 'Likvidno']} />
                <Area type="monotone" dataKey="total" stroke={C.goldSoft} fill="url(#gTotal)" strokeWidth={2} name="total" />
                <Area type="monotone" dataKey="liquid" stroke={C.tealSoft} fill="url(#gLiquid)" strokeWidth={2} name="liquid" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card style={{ padding: '20px' }}>
              <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>Likvidna imovina</div>
              <div className="text-xs mb-2" style={{ color: C.textFaint }}>bez nekretnina · sastav portfelja</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={liquidPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82} paddingAngle={2}>
                    {liquidPie.map((e, i) => <Cell key={i} fill={e.color} stroke={C.panel} strokeWidth={2} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center -mt-1" style={{ color: C.tealSoft, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(latestT.netLiquid)}</div>
            </Card>
            <Card style={{ padding: '20px' }}>
              <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>Ukupna neto vrijednost</div>
              <div className="text-xs mb-2" style={{ color: C.textFaint }}>uključujući nekretnine</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={totalPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82} paddingAngle={2}>
                    {totalPie.map((e, i) => <Cell key={i} fill={e.color} stroke={C.panel} strokeWidth={2} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center -mt-1" style={{ color: C.goldSoft, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(latestT.netTotal)}</div>
              {latestT.liability > 0 && <div className="text-center text-xs mt-1" style={{ color: C.rust }}>uključene obaveze: −{fmt(latestT.liability)}</div>}
            </Card>
          </div>

          {chartData.length > 1 && (
            <Card style={{ padding: '20px 20px 8px' }}>
              <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Prihodi i rashodi po mjesecu</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid stroke={C.borderSoft} vertical={false} />
                  <XAxis dataKey="month" stroke={C.textFaint} tick={{ fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis stroke={C.textFaint} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), n === 'income' ? 'Prihod' : 'Rashod']} />
                  <Bar dataKey="income" fill={C.teal} radius={[3, 3, 0, 0]} name="income" />
                  <Bar dataKey="expense" fill={C.rust} radius={[3, 3, 0, 0]} name="expense" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Entry({ draft, setDraft, categories, previous, sorted, onSave, onStartDraft }) {
  if (!draft) {
    return (
      <Card style={{ padding: '40px 28px', textAlign: 'center' }}>
        <p style={{ color: C.textMuted, fontSize: 14, marginBottom: 16 }}>Odaberi mjesec za unos ili uređivanje.</p>
        <button onClick={() => onStartDraft()} className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold" style={{ background: C.goldSoft, color: C.bg }}>
          <Plus size={16} /> Novi mjesečni unos
        </button>
      </Card>
    );
  }

  const [y, mo] = draft.month.split('-').map(Number);
  const setMonth = (yy, mm) => setDraft({ ...draft, month: `${yy}-${String(mm).padStart(2, '0')}` });
  const setVal = (id, v) => setDraft({ ...draft, values: { ...draft.values, [id]: v } });
  const t = computeTotals(draft, categories);

  return (
    <div className="space-y-6">
      <Card style={{ padding: '20px' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select value={mo} onChange={(e) => setMonth(y, Number(e.target.value))} className="text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}>
              {MONTHS_HR_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={y} onChange={(e) => setMonth(Number(e.target.value), mo)} className="text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}>
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 2 + i).map((yy) => <option key={yy} value={yy}>{yy}</option>)}
            </select>
            {previous && (
              <button onClick={() => { const src = sorted[sorted.length - 1]; setDraft({ ...draft, values: { ...src.values } }); }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
                <Copy size={13} /> Kopiraj iz {monthLabel(sorted[sorted.length - 1].month)}
              </button>
            )}
          </div>
          <button onClick={() => onSave(draft)} className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold" style={{ background: C.goldSoft, color: C.bg }}>
            <Save size={15} /> Spremi mjesec
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {GROUP_ORDER.map((g) => {
          const meta = GROUP_META[g]; const Icon = meta.icon;
          const cats = categories.filter((c) => c.group === g);
          const subtotal = cats.reduce((s, c) => s + Number(draft.values[c.id] || 0), 0);
          return (
            <Card key={g} style={{ padding: '16px 18px', borderLeft: `3px solid ${meta.color}` }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}><Icon size={15} color={meta.color} /> {meta.label}</div>
                <div className="text-sm" style={{ color: meta.color, fontVariantNumeric: 'tabular-nums' }}>{fmt(subtotal)}</div>
              </div>
              {g === 'offbalance' && <div className="text-xs mb-2" style={{ color: C.textFaint }}>{OFFBALANCE_NOTE}</div>}
              <div className="space-y-2 mt-2">
                {cats.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: `1px dashed ${C.borderSoft}` }}>
                    <span className="text-sm" style={{ color: C.textMuted }}>{c.label}</span>
                    <input type="number" value={draft.values[c.id] ?? ''} onChange={(e) => setVal(c.id, e.target.value)} placeholder="0"
                      className="w-28 text-sm rounded-md px-2.5 py-1 text-right" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontVariantNumeric: 'tabular-nums' }} />
                  </div>
                ))}
                {cats.length === 0 && <div className="text-xs" style={{ color: C.textFaint }}>Nema stavki u ovoj grupi — dodaj ih u Kategorijama.</div>}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card style={{ padding: '16px 18px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.tealSoft }}>Prihodi</div>
          <LineRow keyName="income" placeholder="npr. Plaća" draft={draft} setDraft={setDraft} />
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.rust }}>Rashodi</div>
          <LineRow keyName="expenses" placeholder="npr. Stanovanje" draft={draft} setDraft={setDraft} />
        </Card>
      </div>

      <Card style={{ padding: '16px 20px' }}>
        <div className="flex flex-wrap gap-6 text-sm">
          <div><span style={{ color: C.textFaint }}>Likvidno neto: </span><span style={{ color: C.tealSoft, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.netLiquid)}</span></div>
          <div><span style={{ color: C.textFaint }}>Ukupno neto: </span><span style={{ color: C.goldSoft, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.netTotal)}</span></div>
          <div><span style={{ color: C.textFaint }}>Prihod − rashod: </span><span style={{ color: (t.income - t.expense) >= 0 ? C.tealSoft : C.rust, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(t.income - t.expense)}</span></div>
        </div>
      </Card>
    </div>
  );
}

function HistoryTab({ sorted, categories, onEdit, onDelete }) {
  const rows = [...sorted].reverse();
  if (!rows.length) return <Card style={{ padding: 40, textAlign: 'center' }}><p style={{ color: C.textMuted }}>Još nema spremljenih mjeseci.</p></Card>;
  return (
    <Card style={{ overflow: 'hidden' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.textFaint, textAlign: 'left' }}>
              <th className="px-4 py-3 font-medium">Mjesec</th>
              <th className="px-4 py-3 font-medium text-right">Likvidno neto</th>
              <th className="px-4 py-3 font-medium text-right">Ukupno neto</th>
              <th className="px-4 py-3 font-medium text-right">Prihod</th>
              <th className="px-4 py-3 font-medium text-right">Rashod</th>
              <th className="px-4 py-3 font-medium text-right">Razlika</th>
              <th className="px-4 py-3 font-medium text-right">Vanbilanca</th>
              <th className="px-4 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const t = computeTotals(s, categories);
              return (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                  <td className="px-4 py-2.5" style={{ color: C.text }}>{monthLabelFull(s.month)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.tealSoft, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.netLiquid)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.goldSoft, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.netTotal)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.income)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(t.expense)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: (t.income - t.expense) >= 0 ? C.tealSoft : C.rust, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(t.income - t.expense)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.violet, fontVariantNumeric: 'tabular-nums' }}>{t.offbalance > 0 ? fmt(t.offbalance) : '—'}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onEdit(s)} className="p-1.5 rounded" style={{ color: C.textMuted }}><PencilLine size={14} /></button>
                    <button onClick={() => onDelete(s.id, s.month)} className="p-1.5 rounded" style={{ color: C.textFaint }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CategoriesTab({ categories, setCategories }) {
  const [newLabel, setNewLabel] = useState({});
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {GROUP_ORDER.map((g) => {
        const meta = GROUP_META[g]; const Icon = meta.icon;
        const cats = categories.filter((c) => c.group === g);
        return (
          <Card key={g} style={{ padding: '16px 18px', borderLeft: `3px solid ${meta.color}` }}>
            <div className="flex items-center gap-2 text-sm font-semibold mb-3" style={{ color: C.text }}><Icon size={15} color={meta.color} /> {meta.label}</div>
            <div className="space-y-2 mb-3">
              {cats.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <input value={c.label} onChange={(e) => setCategories((prev) => prev.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x))}
                    className="flex-1 text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
                  <button
                    onClick={() => {
                      const ok = window.confirm(`Ukloniti kategoriju "${c.label}"? Njeni povijesni iznosi u svim mjesecima postat će nevidljivi/izgubljeni u prikazu, i ova radnja se ne može poništiti.`);
                      if (ok) setCategories((prev) => prev.filter((x) => x.id !== c.id));
                    }}
                    style={{ color: C.textFaint }}
                  ><Trash2 size={14} /></button>
                </div>
              ))}
              {cats.length === 0 && <div className="text-xs" style={{ color: C.textFaint }}>Nema stavki.</div>}
            </div>
            <div className="flex items-center gap-2">
              <input value={newLabel[g] || ''} onChange={(e) => setNewLabel({ ...newLabel, [g]: e.target.value })} placeholder="Nova stavka…"
                className="flex-1 text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
              <button onClick={() => { if (!newLabel[g]?.trim()) return; setCategories((prev) => [...prev, { id: uid(), label: newLabel[g].trim(), group: g }]); setNewLabel({ ...newLabel, [g]: '' }); }}
                className="p-1.5 rounded-md" style={{ background: C.goldSoft, color: C.bg }}><Plus size={14} /></button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Diversification({ latest, sorted, categories }) {
  if (!latest) {
    return (
      <Card style={{ padding: '48px 32px', textAlign: 'center' }}>
        <p style={{ color: C.textMuted, fontSize: 14 }}>Unesi barem jedan mjesec da vidiš raspodjelu portfelja.</p>
      </Card>
    );
  }

  const breakdown = computeAssetBreakdown(latest, categories);
  const total = breakdown.reduce((s, b) => s + b.value, 0);
  const pieData = breakdown.filter((b) => b.value > 0).sort((a, b) => b.value - a.value);

  const trendData = sorted.map((s) => {
    const b = computeAssetBreakdown(s, categories);
    const row = { month: monthLabel(s.month) };
    b.forEach((x) => { row[x.id] = Math.round(x.value); });
    return row;
  });

  return (
    <div className="space-y-6">
      <Card style={{ padding: '20px 24px' }}>
        <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint, letterSpacing: '0.08em' }}>Bruto imovina · {monthLabelFull(latest.month)}</div>
        <div style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 34, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{fmt(total)}</div>
        <div className="text-xs mt-1" style={{ color: C.textFaint }}>bez obaveza — svrha ovog prikaza je raspodjela po klasi imovine, ne neto vrijednost</div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card style={{ padding: '20px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Raspodjela portfelja</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2}>
                {pieData.map((e, i) => <Cell key={i} fill={e.color} stroke={C.panel} strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), n]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card style={{ padding: '20px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Po klasi imovine</div>
          <div className="space-y-2.5">
            {pieData.map((b) => (
              <div key={b.id} className="flex items-center gap-3">
                <span style={{ width: 10, height: 10, borderRadius: 999, background: b.color, flexShrink: 0 }} />
                <span className="text-sm flex-1" style={{ color: C.textMuted }}>{b.label}</span>
                <span className="text-sm" style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(b.value)}</span>
                <span className="text-xs w-12 text-right" style={{ color: C.textFaint, fontVariantNumeric: 'tabular-nums' }}>{total ? ((b.value / total) * 100).toFixed(1) : '0.0'}%</span>
              </div>
            ))}
            {pieData.length === 0 && <div className="text-xs" style={{ color: C.textFaint }}>Nema unesenih vrijednosti u mapiranim kategorijama za ovaj mjesec.</div>}
          </div>
        </Card>
      </div>

      {sorted.length > 1 && (
        <Card style={{ padding: '20px 20px 8px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Raspodjela kroz vrijeme</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendData} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="month" stroke={C.textFaint} tick={{ fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis stroke={C.textFaint} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), ASSET_CLASSES.find((a) => a.id === n)?.label || n]} />
              {ASSET_CLASSES.map((ac) => (
                <Bar key={ac.id} dataKey={ac.id} stackId="a" fill={ac.color} name={ac.id} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="text-xs" style={{ color: C.textFaint }}>
        Napomena: prikazane su samo kategorije mapirane u klase imovine (obaveze namjerno izostavljene; 2. mirovinski stup iz Vanbilance je uključen pod "Mirovinski"). Ako dodaš novu kategoriju u Kategorijama, javi da je uključim ovdje.
      </div>
    </div>
  );
}

function WealthType({ latest, sorted, categories, consumptionAssets }) {
  if (!latest) {
    return (
      <Card style={{ padding: '48px 32px', textAlign: 'center' }}>
        <p style={{ color: C.textMuted, fontSize: 14 }}>Unesi barem jedan mjesec da vidiš raspodjelu na novac, proizvodnu i potrošnu imovinu.</p>
      </Card>
    );
  }

  const consumptionTotal = (consumptionAssets || []).reduce((s, a) => s + computeConsumptionValue(a).currentValue, 0);

  const breakdown = computeWealthBreakdown(latest, categories).map((b) => (
    b.id === 'consumption' ? { ...b, value: b.value + consumptionTotal } : b
  ));
  const total = breakdown.reduce((s, b) => s + b.value, 0);

  const trendData = sorted.map((s) => {
    const b = computeWealthBreakdown(s, categories);
    const row = { month: monthLabel(s.month) };
    b.forEach((x) => { row[x.id] = Math.round(x.value); });
    // potrošna imovina se prati odvojeno (bez mjesečne povijesti), pa se u
    // trendu kroz vrijeme prikazuje trenutna procjena na svaki mjesec -
    // otprilike točno za novije mjesece, manje precizno unatrag u prošlost
    row.consumption = Math.round(row.consumption + consumptionTotal);
    return row;
  });

  return (
    <div className="space-y-6">
      <Card style={{ padding: '20px 24px' }}>
        <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint, letterSpacing: '0.08em' }}>Bruto imovina po vrsti · {monthLabelFull(latest.month)}</div>
        <div style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 34, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{fmt(total)}</div>
        <div className="text-xs mt-1" style={{ color: C.textFaint }}>bez obaveza — Novac / Proizvodna imovina / Potrošna imovina</div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {breakdown.map((b) => (
          <Card key={b.id} style={{ padding: '16px 18px', borderLeft: `3px solid ${b.color}` }}>
            <div className="text-xs" style={{ color: C.textFaint }}>{b.label}</div>
            <div style={{ color: C.text, fontSize: 22, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmt(b.value)}</div>
            <div className="text-xs mt-1" style={{ color: C.textFaint }}>{total ? ((b.value / total) * 100).toFixed(1) : '0.0'}% ukupne bruto imovine</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card style={{ padding: '20px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Raspodjela</div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={breakdown.filter((b) => b.value > 0)} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2}>
                {breakdown.filter((b) => b.value > 0).map((e, i) => <Cell key={i} fill={e.color} stroke={C.panel} strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), n]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card style={{ padding: '20px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Kategorije po vrsti</div>
          <div className="space-y-4">
            {WEALTH_TYPES.map((wt) => {
              const cats = categories.filter((c) => findWealthType(c)?.id === wt.id && Number(latest.values?.[c.id] || 0) > 0);
              const assets = wt.id === 'consumption' ? (consumptionAssets || []) : [];
              return (
                <div key={wt.id}>
                  <div className="flex items-center gap-2 text-xs font-semibold mb-1.5" style={{ color: wt.color }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: wt.color, display: 'inline-block' }} />
                    {wt.label}
                  </div>
                  {cats.length === 0 && assets.length === 0 && <div className="text-xs mb-2" style={{ color: C.textFaint }}>—</div>}
                  {cats.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm py-0.5">
                      <span style={{ color: C.textMuted }}>{c.label}</span>
                      <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(latest.values[c.id]))}</span>
                    </div>
                  ))}
                  {assets.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-sm py-0.5">
                      <span style={{ color: C.textMuted }}>{a.label}</span>
                      <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(computeConsumptionValue(a).currentValue)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {trendData.length > 1 && (
        <Card style={{ padding: '20px 20px 8px' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Raspodjela kroz vrijeme</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendData} margin={{ left: -10, right: 10 }}>
              <CartesianGrid stroke={C.borderSoft} vertical={false} />
              <XAxis dataKey="month" stroke={C.textFaint} tick={{ fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis stroke={C.textFaint} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
              <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v, n) => [fmt(v), WEALTH_TYPES.find((w) => w.id === n)?.label || n]} />
              {WEALTH_TYPES.map((wt) => (
                <Bar key={wt.id} dataKey={wt.id} stackId="a" fill={wt.color} name={wt.id} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="text-xs" style={{ color: C.textFaint }}>
        Napomena: prikazane su samo kategorije mapirane u ovu podjelu (obaveze namjerno izostavljene, isto kao u Diverzifikaciji). Potrošna imovina dolazi iz posebne stranice "Potrošna imovina" (procijenjena trenutna vrijednost, ne mjesečna povijest). Ako dodaš novu kategoriju u Kategorijama, javi da je uključim ovdje.
      </div>
    </div>
  );
}

function ConsumptionAssetForm({ initial, onSave, onCancel }) {
  const [type, setType] = useState(initial?.type || 'auto');
  const [label, setLabel] = useState(initial?.label || '');
  const [purchaseValue, setPurchaseValue] = useState(initial?.purchaseValue ?? '');
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate || thisMonthStr());
  const [depreciationRate, setDepreciationRate] = useState(initial?.depreciationRate ?? findConsumptionType('auto').defaultDepreciationRate);
  const [notes, setNotes] = useState(initial?.notes || '');

  const handleTypeChange = (t) => {
    setType(t);
    // stopu amortizacije popuni default vrijednošću tipa SAMO ako uređujemo
    // novu stavku (kod postojeće ne diramo vec eventualno ručno prilagođenu stopu)
    if (!initial) setDepreciationRate(findConsumptionType(t).defaultDepreciationRate);
  };

  const canSave = label.trim() && purchaseValue !== '' && !Number.isNaN(Number(purchaseValue)) && purchaseDate;

  return (
    <Card style={{ padding: '18px 20px' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>{initial ? 'Uredi stavku' : 'Nova stavka potrošne imovine'}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Naziv</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="npr. VW Golf 2019"
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Vrsta</div>
          <select value={type} onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}>
            {CONSUMPTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Nabavna vrijednost (€)</div>
          <input type="number" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} placeholder="0"
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Datum nabave</div>
          <input type="month" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Godišnja amortizacija (%)</div>
          <input type="number" value={depreciationRate} onChange={(e) => setDepreciationRate(e.target.value)} placeholder="0"
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
          <div className="text-xs mt-1" style={{ color: C.textFaint }}>0 = ne amortizira se automatski (npr. nekretnina gdje živiš)</div>
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: C.textFaint }}>Napomena (opcionalno)</div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="npr. redovni servis, lokacija..."
            className="w-full text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3.5 py-1.5 rounded-md" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>Odustani</button>
        <button
          disabled={!canSave}
          onClick={() => onSave({
            id: initial?.id || uid(),
            label: label.trim(), type, purchaseValue: Number(purchaseValue), purchaseDate,
            depreciationRate: Number(depreciationRate) || 0,
            valueOverride: initial?.valueOverride ?? null, overrideDate: initial?.overrideDate ?? null,
            notes: notes.trim(),
          })}
          className="text-sm px-4 py-1.5 rounded-md font-semibold"
          style={{ background: canSave ? C.goldSoft : C.borderSoft, color: canSave ? C.bg : C.textFaint, cursor: canSave ? 'pointer' : 'not-allowed' }}
        >
          Spremi
        </button>
      </div>
    </Card>
  );
}

function ConsumptionAssetCard({ asset, onEdit, onDelete, onUpdateValuation }) {
  const [revaluing, setRevaluing] = useState(false);
  const [newValue, setNewValue] = useState('');
  const t = findConsumptionType(asset.type);
  const { currentValue, monthsSinceBase } = computeConsumptionValue(asset);
  const hasOverride = asset.valueOverride !== null && asset.valueOverride !== undefined;
  const stale = t.warningMonths != null && monthsSinceBase > t.warningMonths;
  const changeFromPurchase = currentValue - Number(asset.purchaseValue);

  return (
    <Card style={{ padding: '16px 18px', borderLeft: `3px solid ${stale ? C.rust : C.borderSoft}` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: C.text }}>{asset.label}</div>
          <div className="text-xs mt-0.5" style={{ color: C.textFaint }}>
            {t.label} · nabavljeno {monthLabel(asset.purchaseDate)} za {fmt(asset.purchaseValue)}
            {hasOverride && <> · zadnja procjena {monthLabel(asset.overrideDate)}: {fmt(asset.valueOverride)}</>}
          </div>
          {asset.notes && <div className="text-xs mt-0.5" style={{ color: C.textFaint }}>{asset.notes}</div>}
        </div>
        <div className="text-right">
          <div style={{ color: C.text, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmt(currentValue)}</div>
          <div className="text-xs" style={{ color: changeFromPurchase < 0 ? C.rust : C.tealSoft, fontVariantNumeric: 'tabular-nums' }}>
            {fmtSigned(changeFromPurchase)} od nabave
          </div>
        </div>
      </div>

      {asset.depreciationRate > 0 && (
        <div className="text-xs mt-2" style={{ color: C.textFaint }}>Automatska amortizacija: −{asset.depreciationRate}%/god (opadajući saldo)</div>
      )}

      {stale && (
        <div className="text-xs mt-2 px-2.5 py-1.5 rounded-md" style={{ background: 'rgba(193,106,72,0.12)', color: C.rust, border: `1px solid ${C.rust}55` }}>
          Zadnja procjena vrijednosti prije {monthsSinceBase} mj. — preporučamo ručnu reviziju (održavanje, tržišne promjene) svakih {t.warningMonths} mj.
        </div>
      )}

      {revaluing ? (
        <div className="flex items-center gap-2 mt-3">
          <input type="number" autoFocus value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Nova procijenjena vrijednost (€)"
            className="flex-1 text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }} />
          <button
            disabled={newValue === '' || Number.isNaN(Number(newValue))}
            onClick={() => { onUpdateValuation(asset.id, Number(newValue)); setRevaluing(false); setNewValue(''); }}
            className="text-xs px-3 py-1.5 rounded-md font-semibold" style={{ background: C.goldSoft, color: C.bg }}
          >Spremi</button>
          <button onClick={() => { setRevaluing(false); setNewValue(''); }} className="text-xs px-3 py-1.5 rounded-md" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>Odustani</button>
        </div>
      ) : (
        <div className="flex items-center gap-3 mt-3">
          <button onClick={() => setRevaluing(true)} className="text-xs" style={{ color: C.tealSoft }}>Ažuriraj procjenu</button>
          <button onClick={() => onEdit(asset)} className="text-xs" style={{ color: C.textMuted }}>Uredi</button>
          <button onClick={() => onDelete(asset.id)} className="text-xs" style={{ color: C.textFaint }}>Obriši</button>
        </div>
      )}
    </Card>
  );
}

function ConsumptionAssets({ consumptionAssets, setConsumptionAssets }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const total = consumptionAssets.reduce((s, a) => s + computeConsumptionValue(a).currentValue, 0);
  const staleCount = consumptionAssets.filter((a) => {
    const t = findConsumptionType(a.type);
    const { monthsSinceBase } = computeConsumptionValue(a);
    return t.warningMonths != null && monthsSinceBase > t.warningMonths;
  }).length;

  const handleSave = (asset) => {
    setConsumptionAssets((prev) => {
      const exists = prev.some((a) => a.id === asset.id);
      return exists ? prev.map((a) => (a.id === asset.id ? asset : a)) : [...prev, asset];
    });
    setAdding(false);
    setEditingId(null);
  };

  const handleDelete = (id) => {
    const a = consumptionAssets.find((x) => x.id === id);
    const ok = window.confirm(`Obrisati "${a?.label}"? Ova radnja se ne može poništiti.`);
    if (ok) setConsumptionAssets((prev) => prev.filter((x) => x.id !== id));
  };

  const handleUpdateValuation = (id, value) => {
    setConsumptionAssets((prev) => prev.map((a) => (
      a.id === id ? { ...a, valueOverride: value, overrideDate: thisMonthStr() } : a
    )));
  };

  const editingAsset = editingId ? consumptionAssets.find((a) => a.id === editingId) : null;

  return (
    <div className="space-y-4">
      <Card style={{ padding: '20px 24px' }}>
        <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint, letterSpacing: '0.08em' }}>Potrošna imovina · procijenjena trenutna vrijednost</div>
        <div style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 34, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{fmt(total)}</div>
        <div className="text-xs mt-1" style={{ color: C.textFaint }}>
          Imovina koja se troši osobnom uporabom ili gubi vrijednost s vremenom — nije dio Neto vrijednosti (Pregled), prati se ovdje odvojeno.
          {staleCount > 0 && <span style={{ color: C.rust }}> {staleCount} {staleCount === 1 ? 'stavka čeka' : 'stavke čekaju'} reviziju procjene.</span>}
        </div>
      </Card>

      {!adding && !editingId && (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md" style={{ color: C.bg, background: C.goldSoft }}>
          <Plus size={13} /> Dodaj stavku
        </button>
      )}

      {adding && <ConsumptionAssetForm onSave={handleSave} onCancel={() => setAdding(false)} />}
      {editingAsset && <ConsumptionAssetForm initial={editingAsset} onSave={handleSave} onCancel={() => setEditingId(null)} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {consumptionAssets.map((a) => (
          <ConsumptionAssetCard key={a.id} asset={a} onEdit={(x) => setEditingId(x.id)} onDelete={handleDelete} onUpdateValuation={handleUpdateValuation} />
        ))}
      </div>

      {consumptionAssets.length === 0 && !adding && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <p className="text-sm" style={{ color: C.textMuted }}>Nema unesenih stavki. Dodaj auto, nekretninu gdje živiš, elektroniku i sl. — vrijednost se dalje prati automatski.</p>
        </Card>
      )}
    </div>
  );
}

function MonthPickerModal({ existingMonths, onConfirm, onCancel }) {
  const now = new Date();
  const [y, setY] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth() + 1);
  const monthStr = `${y}-${String(mo).padStart(2, '0')}`;
  const exists = existingMonths.includes(monthStr);

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: '100%' }}>
        <Card style={{ padding: '22px' }}>
          <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>Za koji mjesec unosiš?</div>
          <div className="text-xs mb-4" style={{ color: C.textFaint }}>Odaberi mjesec za novi unos.</div>
          <div className="flex items-center gap-2 mb-3">
            <select value={mo} onChange={(e) => setMo(Number(e.target.value))} className="text-sm rounded-md px-2.5 py-1.5 flex-1" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}>
              {MONTHS_HR_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={y} onChange={(e) => setY(Number(e.target.value))} className="text-sm rounded-md px-2.5 py-1.5" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text }}>
              {Array.from({ length: 7 }, (_, i) => now.getFullYear() - 2 + i).map((yy) => <option key={yy} value={yy}>{yy}</option>)}
            </select>
          </div>
          {exists && (
            <div className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: 'rgba(193,106,72,0.12)', color: C.rust, border: `1px solid ${C.rust}55` }}>
              {monthLabelFull(monthStr)} je već unesen. Za izmjenu koristi olovčicu u Povijesti.
            </div>
          )}
          <div className="flex items-center justify-end gap-2 mt-2">
            <button onClick={onCancel} className="text-sm px-3.5 py-2 rounded-md" style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>Odustani</button>
            <button
              onClick={() => { if (!exists) onConfirm(monthStr); }}
              disabled={exists}
              className="text-sm px-4 py-2 rounded-md font-semibold"
              style={{ background: exists ? C.borderSoft : C.goldSoft, color: exists ? C.textFaint : C.bg, cursor: exists ? 'not-allowed' : 'pointer' }}
            >
              Kreiraj mjesec
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- glavna aplikacija ---------- */
export default function App() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [snapshots, setSnapshots] = useState([]);
  const [consumptionAssets, setConsumptionAssets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('pregled');
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState('');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // KRITIČNO: 'loaded' se postavlja na true SAMO nakon uspješnog čitanja baze.
    // Ako bi se postavio i nakon neuspjeha, autosave efekt ispod bi odmah
    // prebrisao bazu praznim stanjem - to je uzrokovalo nestajanje mjeseci
    // kad backend nije stigao pokrenuti bazu prije nego se sučelje učitalo.
    const load = async (attempt = 0) => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('bad status');
        const parsed = await res.json();
        if (cancelled) return;
        if (parsed.categories && parsed.categories.length) setCategories(parsed.categories);
        if (parsed.snapshots) setSnapshots(parsed.snapshots);
        if (parsed.consumptionAssets) setConsumptionAssets(parsed.consumptionAssets);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        if (attempt < 6) {
          setTimeout(() => load(attempt + 1), 500);
        } else {
          setNotice('Ne mogu se spojiti na bazu (backend). Podaci se NEĆE spremati dok se ovo ne riješi — provjeri je li "npm run dev" pokrenut, pa napravi refresh stranice.');
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        const res = await fetch('/api/state', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Sigurno je poslati ovo jer se save efekt aktivira samo nakon
            // uspješnog početnog čitanja (vidi 'loaded' gore) - prazno stanje
            // ovdje je uvijek namjerno (korisnik je stvarno obrisao sve).
            'X-Confirm-Wipe': snapshots.length === 0 ? 'true' : 'false',
          },
          body: JSON.stringify({ categories, snapshots, consumptionAssets }),
        });
        if (!res.ok) throw new Error('save failed');
      } catch (e) {
        setNotice('Spremanje u bazu trenutno nije uspjelo — provjeri je li pokrenut server (npm run dev).');
        setTimeout(() => setNotice(''), 4500);
      }
    })();
  }, [categories, snapshots, consumptionAssets, loaded]);

  const sorted = useMemo(() => [...snapshots].sort((a, b) => a.month.localeCompare(b.month)), [snapshots]);

  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const latestT = useMemo(() => computeTotals(latest, categories), [latest, categories]);
  const prevT = useMemo(() => computeTotals(previous, categories), [previous, categories]);
  const momChange = latest && previous ? latestT.netTotal - prevT.netTotal : null;
  const momPct = previous && prevT.netTotal ? (momChange / Math.abs(prevT.netTotal)) * 100 : null;

  const chartData = useMemo(() => sorted.map((s) => {
    const t = computeTotals(s, categories);
    return {
      month: monthLabel(s.month), full: s.month,
      liquid: Math.round(t.netLiquid), total: Math.round(t.netTotal),
      income: Math.round(t.income), expense: Math.round(t.expense),
    };
  }), [sorted, categories]);

  const liquidPie = useMemo(() => latest ? categories
    .filter((c) => (c.group === 'liquid' || c.group === 'pension') && Number(latest.values?.[c.id] || 0) > 0)
    .map((c, i) => ({ name: c.label, value: Number(latest.values[c.id]), color: c.group === 'pension' ? PIE_BLUE[i % PIE_BLUE.length] : PIE_TEAL[i % PIE_TEAL.length] }))
    : [], [latest, categories]);

  const totalPie = useMemo(() => latest ? [
    { name: 'Likvidno', value: latestT.liquid, color: C.teal },
    { name: 'Mirovine', value: latestT.pension, color: C.blue },
    { name: 'Nekretnine', value: latestT.realestate, color: C.gold },
  ].filter((d) => d.value > 0) : [], [latest, latestT]);

  // "Novi mjesečni unos" sad uvijek prvo otvara popup za odabir mjeseca -
  // korisnik bira mjesec eksplicitno, a mjeseci koji već postoje su blokirani
  // u tom popupu (za njih se koristi olovčica/uređivanje iz Povijesti umjesto).
  const startDraft = () => setMonthPickerOpen(true);

  const createMonthDraft = (month) => {
    setDraft({ id: uid(), month, values: {}, income: [], expenses: [] });
    setMonthPickerOpen(false);
    setTab('unos');
  };

  const editSnapshot = (snap) => { setDraft(JSON.parse(JSON.stringify(snap))); setTab('unos'); };

  const saveDraft = (currentDraft) => {
    const sameId = snapshots.find((s) => s.id === currentDraft.id);
    const sameMonth = snapshots.find((s) => s.month === currentDraft.month && s.id !== currentDraft.id);
    if (sameId || sameMonth) {
      const ok = window.confirm(`Za ${monthLabelFull(currentDraft.month)} već postoji spremljen unos. Prebrisati postojeće podatke za taj mjesec?`);
      if (!ok) return;
    }
    setSnapshots((prev) => {
      if (sameMonth) return prev.map((s) => (s.month === currentDraft.month ? { ...currentDraft, id: sameMonth.id } : s));
      if (sameId) return prev.map((s) => (s.id === currentDraft.id ? currentDraft : s));
      return [...prev, currentDraft];
    });
    setDraft(null);
    setTab('povijest');
  };

  const deleteSnapshot = (id, month) => {
    const ok = window.confirm(`Obrisati cijeli mjesec ${month ? monthLabelFull(month) : ''}? Svi iznosi, prihodi i rashodi za taj mjesec bit će trajno izgubljeni.`);
    if (!ok) return;
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  };


  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {monthPickerOpen && (
        <MonthPickerModal
          existingMonths={sorted.map((s) => s.month)}
          onConfirm={createMonthDraft}
          onCancel={() => setMonthPickerOpen(false)}
        />
      )}
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '28px 20px 64px' }}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <div style={{ fontFamily: 'Georgia, "Iowan Old Style", serif', fontSize: 24, letterSpacing: '0.01em' }}>Moj Kompić</div>
            <div className="text-xs" style={{ color: C.textFaint }}>Osobna knjiga imovine, mjesec po mjesec</div>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <TabButton id="pregled" label="Pregled" icon={LayoutGrid} activeTab={tab} onSelect={setTab} />
            <TabButton id="unos" label="Unos" icon={PencilLine} activeTab={tab} onSelect={setTab} />
            <TabButton id="povijest" label="Povijest" icon={HistoryIcon} activeTab={tab} onSelect={setTab} />
            <TabButton id="kategorije" label="Kategorije" icon={Settings2} activeTab={tab} onSelect={setTab} />
            <TabButton id="diverzifikacija" label="Diverzifikacija" icon={PieChartIcon} activeTab={tab} onSelect={setTab} />
            <TabButton id="vrstaImovine" label="Vrsta imovine" icon={Layers} activeTab={tab} onSelect={setTab} />
            <TabButton id="potrosnaImovina" label="Potrošna imovina" icon={Car} activeTab={tab} onSelect={setTab} />
          </div>
        </div>

        {latest && tab !== 'unos' && (
          <div className="mb-5">
            <button onClick={() => startDraft()} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md" style={{ color: C.bg, background: C.goldSoft }}>
              <Plus size={13} /> Unesi novi mjesec <ArrowRight size={12} />
            </button>
          </div>
        )}

        {notice && <div className="mb-4 text-sm px-3 py-2 rounded-md" style={{ background: 'rgba(193,106,72,0.12)', color: C.rust, border: `1px solid ${C.rust}55` }}>{notice}</div>}

        {tab === 'pregled' && (
          <Overview
            latest={latest} latestT={latestT} previous={previous}
            momChange={momChange} momPct={momPct}
            chartData={chartData} liquidPie={liquidPie} totalPie={totalPie}
            onStartDraft={startDraft}
          />
        )}
        {tab === 'unos' && (
          <Entry
            draft={draft} setDraft={setDraft} categories={categories}
            previous={previous} sorted={sorted}
            onSave={saveDraft} onStartDraft={startDraft}
          />
        )}
        {tab === 'povijest' && (
          <HistoryTab sorted={sorted} categories={categories} onEdit={editSnapshot} onDelete={deleteSnapshot} />
        )}
        {tab === 'kategorije' && (
          <CategoriesTab categories={categories} setCategories={setCategories} />
        )}
        {tab === 'diverzifikacija' && (
          <Diversification latest={latest} sorted={sorted} categories={categories} />
        )}
        {tab === 'vrstaImovine' && (
          <WealthType latest={latest} sorted={sorted} categories={categories} consumptionAssets={consumptionAssets} />
        )}
        {tab === 'potrosnaImovina' && (
          <ConsumptionAssets consumptionAssets={consumptionAssets} setConsumptionAssets={setConsumptionAssets} />
        )}
      </div>
    </div>
  );
}
