// App UI localization for the 10 most-spoken languages (incl. French). AI
// *results* translate via the `language` setting; this localizes the app chrome.
// Missing keys fall back to English, so coverage is easy to extend.

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
  { code: "fr", name: "French", native: "Français" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "ja", name: "Japanese", native: "日本語" },
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
  "nav.scan": "Scan", "nav.search": "Search", "nav.bulk": "Bulk", "nav.trade": "Trade",
  "nav.binder": "Binder", "nav.wishlist": "Wishlist", "nav.awards": "Awards", "nav.settings": "Settings",
  "chat.ask": "Ask a question",
  "scan.title": "Scan a card", "search.title": "Search cards", "bulk.title": "Bulk scan",
  "trade.title": "Trade tool", "binder.title": "Your binder", "wishlist.title": "Wishlist",
  "awards.title": "Achievements", "settings.title": "Settings & filters",
  "btn.save": "★ Save to binder", "btn.saved": "✓ Saved to binder",
  "btn.analyze": "Analyze card", "btn.search": "Search", "btn.refresh": "Refresh prices", "btn.add": "Add",
};

const dict: Record<string, Dict> = {
  en,
  es: {
    "nav.scan": "Escanear", "nav.search": "Buscar", "nav.bulk": "Lote", "nav.trade": "Cambio",
    "nav.binder": "Carpeta", "nav.wishlist": "Deseos", "nav.awards": "Logros", "nav.settings": "Ajustes",
    "chat.ask": "Hacer una pregunta",
    "scan.title": "Escanear una carta", "search.title": "Buscar cartas", "bulk.title": "Escaneo por lote",
    "trade.title": "Herramienta de cambios", "binder.title": "Tu carpeta", "wishlist.title": "Lista de deseos",
    "awards.title": "Logros", "settings.title": "Ajustes y filtros",
    "btn.save": "★ Guardar en la carpeta", "btn.saved": "✓ Guardada",
    "btn.analyze": "Analizar carta", "btn.search": "Buscar", "btn.refresh": "Actualizar precios", "btn.add": "Añadir",
  },
  fr: {
    "nav.scan": "Scanner", "nav.search": "Rechercher", "nav.bulk": "En lot", "nav.trade": "Échange",
    "nav.binder": "Classeur", "nav.wishlist": "Souhaits", "nav.awards": "Trophées", "nav.settings": "Réglages",
    "chat.ask": "Poser une question",
    "scan.title": "Scanner une carte", "search.title": "Rechercher des cartes", "bulk.title": "Scan en lot",
    "trade.title": "Outil d'échange", "binder.title": "Votre classeur", "wishlist.title": "Liste de souhaits",
    "awards.title": "Succès", "settings.title": "Réglages et filtres",
    "btn.save": "★ Ajouter au classeur", "btn.saved": "✓ Ajoutée",
    "btn.analyze": "Analyser la carte", "btn.search": "Rechercher", "btn.refresh": "Actualiser les prix", "btn.add": "Ajouter",
  },
  pt: {
    "nav.scan": "Escanear", "nav.search": "Buscar", "nav.bulk": "Em lote", "nav.trade": "Troca",
    "nav.binder": "Álbum", "nav.wishlist": "Desejos", "nav.awards": "Conquistas", "nav.settings": "Configurações",
    "chat.ask": "Fazer uma pergunta",
    "scan.title": "Escanear uma carta", "search.title": "Buscar cartas", "bulk.title": "Escaneamento em lote",
    "trade.title": "Ferramenta de trocas", "binder.title": "Seu álbum", "wishlist.title": "Lista de desejos",
    "awards.title": "Conquistas", "settings.title": "Configurações e filtros",
    "btn.save": "★ Salvar no álbum", "btn.saved": "✓ Salva",
    "btn.analyze": "Analisar carta", "btn.search": "Buscar", "btn.refresh": "Atualizar preços", "btn.add": "Adicionar",
  },
  ru: {
    "nav.scan": "Скан", "nav.search": "Поиск", "nav.bulk": "Партия", "nav.trade": "Обмен",
    "nav.binder": "Альбом", "nav.wishlist": "Желания", "nav.awards": "Награды", "nav.settings": "Настройки",
    "chat.ask": "Задать вопрос",
    "scan.title": "Сканировать карту", "search.title": "Поиск карт", "bulk.title": "Пакетное сканирование",
    "trade.title": "Инструмент обмена", "binder.title": "Ваш альбом", "wishlist.title": "Список желаний",
    "awards.title": "Достижения", "settings.title": "Настройки и фильтры",
    "btn.save": "★ Сохранить в альбом", "btn.saved": "✓ Сохранено",
    "btn.analyze": "Анализировать", "btn.search": "Поиск", "btn.refresh": "Обновить цены", "btn.add": "Добавить",
  },
  ja: {
    "nav.scan": "スキャン", "nav.search": "検索", "nav.bulk": "一括", "nav.trade": "トレード",
    "nav.binder": "バインダー", "nav.wishlist": "ほしい物", "nav.awards": "実績", "nav.settings": "設定",
    "chat.ask": "質問する",
    "scan.title": "カードをスキャン", "search.title": "カードを検索", "bulk.title": "一括スキャン",
    "trade.title": "トレードツール", "binder.title": "あなたのバインダー", "wishlist.title": "ほしい物リスト",
    "awards.title": "実績", "settings.title": "設定とフィルター",
    "btn.save": "★ バインダーに保存", "btn.saved": "✓ 保存済み",
    "btn.analyze": "カードを分析", "btn.search": "検索", "btn.refresh": "価格を更新", "btn.add": "追加",
  },
  zh: {
    "nav.scan": "扫描", "nav.search": "搜索", "nav.bulk": "批量", "nav.trade": "交易",
    "nav.binder": "收藏册", "nav.wishlist": "心愿单", "nav.awards": "成就", "nav.settings": "设置",
    "chat.ask": "提问",
    "scan.title": "扫描卡片", "search.title": "搜索卡片", "bulk.title": "批量扫描",
    "trade.title": "交易工具", "binder.title": "你的收藏册", "wishlist.title": "心愿单",
    "awards.title": "成就", "settings.title": "设置与筛选",
    "btn.save": "★ 保存到收藏册", "btn.saved": "✓ 已保存",
    "btn.analyze": "分析卡片", "btn.search": "搜索", "btn.refresh": "刷新价格", "btn.add": "添加",
  },
  hi: {
    "nav.scan": "स्कैन", "nav.search": "खोजें", "nav.bulk": "बल्क", "nav.trade": "ट्रेड",
    "nav.binder": "बाइंडर", "nav.wishlist": "इच्छा-सूची", "nav.awards": "उपलब्धियाँ", "nav.settings": "सेटिंग्स",
    "chat.ask": "सवाल पूछें",
    "scan.title": "कार्ड स्कैन करें", "search.title": "कार्ड खोजें", "bulk.title": "बल्क स्कैन",
    "trade.title": "ट्रेड टूल", "binder.title": "आपका बाइंडर", "wishlist.title": "इच्छा-सूची",
    "awards.title": "उपलब्धियाँ", "settings.title": "सेटिंग्स और फ़िल्टर",
    "btn.save": "★ बाइंडर में सहेजें", "btn.saved": "✓ सहेजा गया",
    "btn.analyze": "कार्ड विश्लेषण करें", "btn.search": "खोजें", "btn.refresh": "कीमतें रिफ्रेश करें", "btn.add": "जोड़ें",
  },
  ar: {
    "nav.scan": "مسح", "nav.search": "بحث", "nav.bulk": "دفعة", "nav.trade": "مقايضة",
    "nav.binder": "مجلد", "nav.wishlist": "الرغبات", "nav.awards": "الإنجازات", "nav.settings": "الإعدادات",
    "chat.ask": "اطرح سؤالاً",
    "scan.title": "امسح بطاقة", "search.title": "ابحث عن بطاقات", "bulk.title": "مسح بالدفعة",
    "trade.title": "أداة المقايضة", "binder.title": "مجلدك", "wishlist.title": "قائمة الرغبات",
    "awards.title": "الإنجازات", "settings.title": "الإعدادات والمرشحات",
    "btn.save": "★ احفظ في المجلد", "btn.saved": "✓ تم الحفظ",
    "btn.analyze": "تحليل البطاقة", "btn.search": "بحث", "btn.refresh": "تحديث الأسعار", "btn.add": "إضافة",
  },
  bn: {
    "nav.scan": "স্ক্যান", "nav.search": "অনুসন্ধান", "nav.bulk": "বাল্ক", "nav.trade": "বিনিময়",
    "nav.binder": "বাইন্ডার", "nav.wishlist": "ইচ্ছেতালিকা", "nav.awards": "অর্জন", "nav.settings": "সেটিংস",
    "chat.ask": "প্রশ্ন করুন",
    "scan.title": "একটি কার্ড স্ক্যান করুন", "search.title": "কার্ড খুঁজুন", "bulk.title": "বাল্ক স্ক্যান",
    "trade.title": "বিনিময় টুল", "binder.title": "আপনার বাইন্ডার", "wishlist.title": "ইচ্ছেতালিকা",
    "awards.title": "অর্জন", "settings.title": "সেটিংস ও ফিল্টার",
    "btn.save": "★ বাইন্ডারে সংরক্ষণ", "btn.saved": "✓ সংরক্ষিত",
    "btn.analyze": "কার্ড বিশ্লেষণ", "btn.search": "অনুসন্ধান", "btn.refresh": "দাম রিফ্রেশ", "btn.add": "যোগ করুন",
  },
};

/** Returns a translator bound to the given language NAME (e.g. "Spanish"). */
export function makeT(languageName: string) {
  const code = langByName(languageName).code;
  const table = dict[code] || en;
  return (key: string): string => table[key] ?? en[key] ?? key;
}
