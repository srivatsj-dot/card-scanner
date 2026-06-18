// App UI localization. AI *results* already translate via the `language` setting;
// this localizes the app chrome (nav, headings, key buttons). Native names are
// shown for all languages; strings fall back to English (then the key) when a
// translation is missing, so adding more is incremental.

export interface Lang {
  code: string;
  name: string; // English name — also sent to the model for result translation
  native: string; // endonym shown in the picker
  rtl?: boolean;
}

export const LANGS: Lang[] = [
  { code: "en", name: "English", native: "English" },
  { code: "zh", name: "Mandarin Chinese", native: "中文" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "fr", name: "French", native: "Français" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
];

export function langByName(name: string): Lang {
  return LANGS.find((l) => l.name === name) || LANGS[0];
}

/** Best-guess language NAME from the browser locale (e.g. "es-ES" -> "Spanish"). */
export function detectLanguageName(): string {
  const code = (navigator.language || "en").slice(0, 2).toLowerCase();
  return (LANGS.find((l) => l.code === code) || LANGS[0]).name;
}

type Dict = Record<string, string>;

const en: Dict = {
  "nav.scan": "Scan",
  "nav.search": "Search",
  "nav.bulk": "Bulk",
  "nav.trade": "Trade",
  "nav.binder": "Binder",
  "nav.wishlist": "Wishlist",
  "nav.settings": "Settings",
  "chat.ask": "Ask a question",
  "scan.title": "Scan a card",
  "search.title": "Search cards",
  "bulk.title": "Bulk scan",
  "trade.title": "Trade tool",
  "binder.title": "Your binder",
  "wishlist.title": "Wishlist",
  "settings.title": "Settings & filters",
  "btn.save": "★ Save to binder",
  "btn.saved": "✓ Saved to binder",
};

// Translations. Missing keys fall back to English; missing languages too.
const dict: Record<string, Dict> = {
  en,
  es: {
    "nav.scan": "Escanear", "nav.search": "Buscar", "nav.bulk": "Lote", "nav.trade": "Cambio",
    "nav.binder": "Carpeta", "nav.wishlist": "Deseos", "nav.settings": "Ajustes",
    "chat.ask": "Hacer una pregunta", "scan.title": "Escanear una carta", "search.title": "Buscar cartas",
    "bulk.title": "Escaneo por lote", "trade.title": "Herramienta de cambios", "binder.title": "Tu carpeta",
    "wishlist.title": "Lista de deseos", "settings.title": "Ajustes y filtros",
    "btn.save": "★ Guardar en la carpeta", "btn.saved": "✓ Guardada",
  },
  fr: {
    "nav.scan": "Scanner", "nav.search": "Rechercher", "nav.bulk": "En lot", "nav.trade": "Échange",
    "nav.binder": "Classeur", "nav.wishlist": "Souhaits", "nav.settings": "Réglages",
    "chat.ask": "Poser une question", "scan.title": "Scanner une carte", "search.title": "Rechercher des cartes",
    "bulk.title": "Scan en lot", "trade.title": "Outil d'échange", "binder.title": "Votre classeur",
    "wishlist.title": "Liste de souhaits", "settings.title": "Réglages et filtres",
    "btn.save": "★ Ajouter au classeur", "btn.saved": "✓ Ajoutée",
  },
  de: {
    "nav.scan": "Scannen", "nav.search": "Suchen", "nav.bulk": "Sammel", "nav.trade": "Tausch",
    "nav.binder": "Mappe", "nav.wishlist": "Wunschliste", "nav.settings": "Einstellungen",
    "chat.ask": "Frage stellen", "scan.title": "Karte scannen", "search.title": "Karten suchen",
    "bulk.title": "Sammel-Scan", "trade.title": "Tausch-Tool", "binder.title": "Deine Mappe",
    "wishlist.title": "Wunschliste", "settings.title": "Einstellungen & Filter",
    "btn.save": "★ In Mappe speichern", "btn.saved": "✓ Gespeichert",
  },
  pt: {
    "nav.scan": "Escanear", "nav.search": "Buscar", "nav.bulk": "Em lote", "nav.trade": "Troca",
    "nav.binder": "Álbum", "nav.wishlist": "Desejos", "nav.settings": "Configurações",
    "chat.ask": "Fazer uma pergunta", "scan.title": "Escanear uma carta", "search.title": "Buscar cartas",
    "bulk.title": "Escaneamento em lote", "trade.title": "Ferramenta de trocas", "binder.title": "Seu álbum",
    "wishlist.title": "Lista de desejos", "settings.title": "Configurações e filtros",
    "btn.save": "★ Salvar no álbum", "btn.saved": "✓ Salva",
  },
  it: {
    "nav.scan": "Scansiona", "nav.search": "Cerca", "nav.bulk": "In blocco", "nav.trade": "Scambio",
    "nav.binder": "Raccoglitore", "nav.wishlist": "Desideri", "nav.settings": "Impostazioni",
    "chat.ask": "Fai una domanda", "scan.title": "Scansiona una carta", "search.title": "Cerca carte",
    "bulk.title": "Scansione in blocco", "trade.title": "Strumento scambi", "binder.title": "Il tuo raccoglitore",
    "wishlist.title": "Lista dei desideri", "settings.title": "Impostazioni e filtri",
    "btn.save": "★ Salva nel raccoglitore", "btn.saved": "✓ Salvata",
  },
  nl: {
    "nav.scan": "Scannen", "nav.search": "Zoeken", "nav.bulk": "Bulk", "nav.trade": "Ruilen",
    "nav.binder": "Map", "nav.wishlist": "Verlanglijst", "nav.settings": "Instellingen",
    "chat.ask": "Stel een vraag", "scan.title": "Scan een kaart", "search.title": "Kaarten zoeken",
    "bulk.title": "Bulk scannen", "trade.title": "Ruilgereedschap", "binder.title": "Jouw map",
    "wishlist.title": "Verlanglijst", "settings.title": "Instellingen & filters",
    "btn.save": "★ In map opslaan", "btn.saved": "✓ Opgeslagen",
  },
  ru: {
    "nav.scan": "Скан", "nav.search": "Поиск", "nav.bulk": "Партия", "nav.trade": "Обмен",
    "nav.binder": "Альбом", "nav.wishlist": "Желания", "nav.settings": "Настройки",
    "chat.ask": "Задать вопрос", "scan.title": "Сканировать карту", "search.title": "Поиск карт",
    "bulk.title": "Пакетное сканирование", "trade.title": "Инструмент обмена", "binder.title": "Ваш альбом",
    "wishlist.title": "Список желаний", "settings.title": "Настройки и фильтры",
    "btn.save": "★ Сохранить в альбом", "btn.saved": "✓ Сохранено",
  },
  ja: {
    "nav.scan": "スキャン", "nav.search": "検索", "nav.bulk": "一括", "nav.trade": "トレード",
    "nav.binder": "バインダー", "nav.wishlist": "ほしい物", "nav.settings": "設定",
    "chat.ask": "質問する", "scan.title": "カードをスキャン", "search.title": "カードを検索",
    "bulk.title": "一括スキャン", "trade.title": "トレードツール", "binder.title": "あなたのバインダー",
    "wishlist.title": "ほしい物リスト", "settings.title": "設定とフィルター",
    "btn.save": "★ バインダーに保存", "btn.saved": "✓ 保存済み",
  },
  zh: {
    "nav.scan": "扫描", "nav.search": "搜索", "nav.bulk": "批量", "nav.trade": "交易",
    "nav.binder": "收藏册", "nav.wishlist": "心愿单", "nav.settings": "设置",
    "chat.ask": "提问", "scan.title": "扫描卡片", "search.title": "搜索卡片",
    "bulk.title": "批量扫描", "trade.title": "交易工具", "binder.title": "你的收藏册",
    "wishlist.title": "心愿单", "settings.title": "设置与筛选",
    "btn.save": "★ 保存到收藏册", "btn.saved": "✓ 已保存",
  },
  ko: {
    "nav.scan": "스캔", "nav.search": "검색", "nav.bulk": "일괄", "nav.trade": "거래",
    "nav.binder": "바인더", "nav.wishlist": "위시리스트", "nav.settings": "설정",
    "chat.ask": "질문하기", "scan.title": "카드 스캔", "search.title": "카드 검색",
    "bulk.title": "일괄 스캔", "trade.title": "거래 도구", "binder.title": "내 바인더",
    "wishlist.title": "위시리스트", "settings.title": "설정 및 필터",
    "btn.save": "★ 바인더에 저장", "btn.saved": "✓ 저장됨",
  },
  hi: {
    "nav.scan": "स्कैन", "nav.search": "खोजें", "nav.bulk": "बल्क", "nav.trade": "ट्रेड",
    "nav.binder": "बाइंडर", "nav.wishlist": "इच्छा-सूची", "nav.settings": "सेटिंग्स",
    "chat.ask": "सवाल पूछें", "scan.title": "कार्ड स्कैन करें", "search.title": "कार्ड खोजें",
    "bulk.title": "बल्क स्कैन", "trade.title": "ट्रेड टूल", "binder.title": "आपका बाइंडर",
    "wishlist.title": "इच्छा-सूची", "settings.title": "सेटिंग्स और फ़िल्टर",
    "btn.save": "★ बाइंडर में सहेजें", "btn.saved": "✓ सहेजा गया",
  },
  ar: {
    "nav.scan": "مسح", "nav.search": "بحث", "nav.bulk": "دفعة", "nav.trade": "مقايضة",
    "nav.binder": "مجلد", "nav.wishlist": "الرغبات", "nav.settings": "الإعدادات",
    "chat.ask": "اطرح سؤالاً", "scan.title": "امسح بطاقة", "search.title": "ابحث عن بطاقات",
    "bulk.title": "مسح بالدفعة", "trade.title": "أداة المقايضة", "binder.title": "مجلدك",
    "wishlist.title": "قائمة الرغبات", "settings.title": "الإعدادات والمرشحات",
    "btn.save": "★ احفظ في المجلد", "btn.saved": "✓ تم الحفظ",
  },
};

/** Returns a translator bound to the given language NAME (e.g. "Spanish"). */
export function makeT(languageName: string) {
  const code = langByName(languageName).code;
  const table = dict[code] || en;
  return (key: string): string => table[key] ?? en[key] ?? key;
}
