'use client';

import { useCallback, useEffect, useState } from 'react';
import { safeLocalStorageSet } from '@/lib/safe-storage';

/**
 * Itemba POS is Swahili-first: reps see Swahili by default with an English
 * toggle. This tiny catalog is deliberately POS-only — the back office stays
 * English and needs no i18n framework.
 */
export type PosLang = 'sw' | 'en';

const STORAGE_KEY = 'itemba-pos-lang';
const DEFAULT_LANG: PosLang = 'sw';

const STRINGS = {
  en: {
    opening: 'Opening Itemba POS...',
    setupAgain: 'Set up this phone again',
    terminalUnavailable: 'This terminal is not available.',
    newSale: 'New Sale',
    waitingCount: '{count} waiting to send',
    saleComplete: 'Sale complete',
    savedOffline: 'Saved on this phone. It will be sent when the network returns.',
    home: 'Home',
    payment: 'Payment',
    backToSale: 'Back to sale',
    items: '{count} items',
    customer: 'Customer',
    customerOptional: 'Customer (optional)',
    change: 'Change',
    customerSearchPlaceholder: 'Name, phone or customer code',
    typeTwoLetters: 'Type two letters to search.',
    reference: 'Reference',
    optional: '(optional)',
    referencePlaceholder: 'Reference number',
    completeSale: 'Complete Sale',
    completing: 'Completing...',
    selectCreditCustomer: 'Select the customer for this credit sale.',
    cancelSale: 'Cancel sale',
    online: 'Online',
    offline: 'No network',
    addProducts: 'Add products',
    productSearchPlaceholder: 'Search or scan product',
    typeTwoOrScan: 'Type two letters or scan a barcode.',
    noMatch: 'No matching product.',
    saleItems: 'Sale items',
    stock: 'Stock {count}',
    pay: 'Pay',
    ready: 'Ready',
    sending: 'Sending...',
    logOut: 'Log out',
    couldNotComplete: 'The sale could not be completed.',
    cashOnlyOffline: 'Without network, only cash sales work.',
    offlineCanSell: 'No network. You can still sell for cash.',
    quantityOf: 'Quantity of {name}',
    reduceItem: 'Reduce {name}',
    addItem: 'Add {name}',
    removeItem: 'Remove {name}',
    bestSellers: 'Frequent products',
    allProducts: 'Type to search all products',
    shareReceipt: 'Share Receipt',
    preparingReceipt: 'Preparing receipt…',
    receiptDownloaded: 'Receipt PDF downloaded — attach it to any message.',
    receiptCopied: 'Receipt copied — paste it into any message.',
    receiptThanks: 'Thank you for your business!',
    totalLabel: 'TOTAL',
    received: 'Amount received',
    exactAmount: 'Exact',
    changeDue: 'Change',
    stillOwed: 'Still owed',
    mySalesToday: 'My Sales Today',
    salesCountLabel: 'Sales',
    noSalesToday: 'No sales yet today.',
    needsNetwork: 'This needs a network connection.',
    purchases: 'Receive Stock',
    supplier: 'Supplier',
    supplierSearchPlaceholder: 'Supplier name or code',
    buyingPrice: 'Buying price',
    purchaseItems: 'Items received',
    recordPurchase: 'Record Purchase',
    recording: 'Recording...',
    purchaseComplete: 'Purchase recorded',
    purchaseStockNote: 'Stock and valuation update now; the invoice is handled by the office.',
    selectSupplierFirst: 'Select the supplier first.',
    queueTitle: 'Sales waiting to send',
    queueEmpty: 'Nothing is waiting. All sales are sent.',
    queueWaiting: 'Waiting for network',
    queueFailed: 'Not accepted — tell your supervisor',
    sendNow: 'Send now',
    remove: 'Remove',
    removeConfirmTitle: 'Remove this sale?',
    removeConfirmBody: 'Only a supervisor should do this. The sale will be deleted and never sent.',
    confirmRemove: 'Yes, remove it',
    keepIt: 'Keep it',
    back: 'Back',
    // Kaunta shell (Phase 2b): rail, slab, sync token, Mipangilio
    railMauzo: 'Sales',
    railLeo: 'Today',
    railManunuzi: 'Purchases',
    mipangilio: 'Settings',
    slabLipa: 'PAY',
    slabKamilisha: 'COMPLETE SALE',
    slabPokea: 'RECEIVE',
    syncCleanAria: 'All sales sent',
    syncQueuedAria: '{count} sales waiting to send — open the queue',
    syncOfflineAria: 'No network — open the queue',
    settingsRep: 'Rep',
    settingsTerminal: 'Terminal',
    settingsBranch: 'Branch',
    settingsLanguage: 'Language',
    settingsVersion: 'App version',
    // Kaunta ritual (Phase 3): MUHURI stamp, ribbon, rejected-sale ritual
    stampImelipwa: 'PAID',
    stampImehifadhiwa: 'HELD ON PHONE',
    stampMzigo: 'STOCK RECEIVED',
    custodyNote: 'Written in the day book — it will be sent when the network returns',
    ribbonOffline: 'No network — cash sales only',
    ribbonSending: 'Sending…',
    retryThisSale: 'Try again',
    callSupervisor: 'Call a supervisor',
    callSupervisorNote: 'Only a supervisor can decide what happens to this sale.',
    technicalDetails: 'Technical details',
    errorFallback: 'Not accepted — call a supervisor',
    errCreditLimit: 'Customer has reached their credit limit',
    errCustomerInvalid: 'This customer cannot buy on credit here',
    errAlreadySent: 'This sale was already sent',
    errInsufficientStock: 'Not enough stock for this product',
    errProductUnavailable: 'This product is not available on this terminal',
    // Kaunta Leo day book (Phase 3)
    leoTitle: "Today's Book",
    leoDayTotal: "Today's total",
    leoSent: 'Sent {count}',
    leoHeld: 'In hand {count}',
    leoTallyAria: '{count} jobs finished today',
    leoLastKnown: 'Last known at {time}',
    leoOfflineNote: 'No network — sent sales will appear when the network returns.',
    leoLoadError: "Could not load today's sales",
    tryAgain: 'Try again',
    // Kaunta Mipangilio (Phase 3): haptics toggle, catalog re-sync
    settingsHaptics: 'Vibration',
    settingsHapticsNote: 'A small buzz when a job finishes.',
    settingsResync: 'Re-download products',
    settingsResyncDone: 'Products re-downloaded',
    // Activation
    setupTitle: 'Set up this POS',
    setupSubtitle: 'Use the code issued by your supervisor.',
    terminalCodeLabel: 'Terminal code',
    setupCodeLabel: 'Setup code',
    connectPhone: 'Connect this phone',
    connecting: 'Connecting...',
    enterBothCodes: 'Enter the terminal code and setup code.',
    notActivated: 'This phone could not be connected.',
    phoneReady: 'This phone is ready',
    alreadyConnected: 'Terminal {code} is already connected on this phone.',
    openSales: 'Open Sales',
  },
  sw: {
    opening: 'Inafungua Itemba POS...',
    setupAgain: 'Sajili simu hii upya',
    terminalUnavailable: 'Kituo hiki hakipatikani.',
    newSale: 'Mauzo Mapya',
    waitingCount: '{count} yanasubiri kutumwa',
    saleComplete: 'Mauzo yamekamilika',
    savedOffline: 'Imehifadhiwa kwenye simu hii. Itatumwa mtandao ukirudi.',
    home: 'Mwanzo',
    payment: 'Malipo',
    backToSale: 'Rudi kwenye mauzo',
    items: 'Bidhaa {count}',
    customer: 'Mteja',
    customerOptional: 'Mteja (si lazima)',
    change: 'Badilisha',
    customerSearchPlaceholder: 'Jina, simu au namba ya mteja',
    typeTwoLetters: 'Andika herufi mbili kutafuta.',
    reference: 'Kumbukumbu',
    optional: '(si lazima)',
    referencePlaceholder: 'Namba ya kumbukumbu',
    completeSale: 'Maliza Mauzo',
    completing: 'Inamaliza...',
    selectCreditCustomer: 'Chagua mteja wa mauzo haya ya mkopo.',
    cancelSale: 'Futa mauzo',
    online: 'Mtandaoni',
    offline: 'Hakuna mtandao',
    addProducts: 'Ongeza bidhaa',
    productSearchPlaceholder: 'Tafuta au skani bidhaa',
    typeTwoOrScan: 'Andika herufi mbili au skani barcode.',
    noMatch: 'Hakuna bidhaa iliyopatikana.',
    saleItems: 'Bidhaa za mauzo',
    stock: 'Stoo {count}',
    pay: 'Lipa',
    ready: 'Tayari',
    sending: 'Inatuma...',
    logOut: 'Toka',
    couldNotComplete: 'Mauzo hayakukamilika.',
    cashOnlyOffline: 'Bila mtandao, mauzo ya fedha taslimu tu.',
    offlineCanSell: 'Hakuna mtandao. Bado unaweza kuuza kwa fedha taslimu.',
    quantityOf: 'Idadi ya {name}',
    reduceItem: 'Punguza {name}',
    addItem: 'Ongeza {name}',
    removeItem: 'Ondoa {name}',
    bestSellers: 'Bidhaa za mara kwa mara',
    allProducts: 'Andika kutafuta bidhaa zote',
    shareReceipt: 'Tuma Risiti',
    preparingReceipt: 'Inaandaa risiti…',
    receiptDownloaded: 'Risiti PDF imepakuliwa — iambatishe kwenye ujumbe wowote.',
    receiptCopied: 'Risiti imenakiliwa — ibandike kwenye ujumbe wowote.',
    receiptThanks: 'Asante kwa biashara yako!',
    totalLabel: 'JUMLA',
    received: 'Amepokea',
    exactAmount: 'Kamili',
    changeDue: 'Chenji',
    stillOwed: 'Bado',
    mySalesToday: 'Mauzo Yangu Leo',
    salesCountLabel: 'Mauzo',
    noSalesToday: 'Hakuna mauzo bado leo.',
    needsNetwork: 'Hii inahitaji mtandao.',
    purchases: 'Pokea Mzigo',
    supplier: 'Muuzaji',
    supplierSearchPlaceholder: 'Jina au namba ya muuzaji',
    buyingPrice: 'Bei ya kununua',
    purchaseItems: 'Bidhaa zilizopokelewa',
    recordPurchase: 'Hifadhi Manunuzi',
    recording: 'Inahifadhi...',
    purchaseComplete: 'Manunuzi yamehifadhiwa',
    purchaseStockNote: 'Stoo na thamani vinasasishwa sasa; ankara inashughulikiwa na ofisi.',
    selectSupplierFirst: 'Chagua muuzaji kwanza.',
    queueTitle: 'Mauzo yanayosubiri kutumwa',
    queueEmpty: 'Hakuna kinachosubiri. Mauzo yote yametumwa.',
    queueWaiting: 'Inasubiri mtandao',
    queueFailed: 'Hayakukubaliwa — mwambie msimamizi',
    sendNow: 'Tuma sasa',
    remove: 'Ondoa',
    removeConfirmTitle: 'Uondoe mauzo haya?',
    removeConfirmBody: 'Msimamizi pekee ndiye afanye hivi. Mauzo haya yatafutwa na hayatatumwa.',
    confirmRemove: 'Ndiyo, ondoa',
    keepIt: 'Yaache',
    back: 'Rudi',
    // Kaunta shell (Phase 2b): rail, slab, sync token, Mipangilio
    railMauzo: 'Mauzo',
    railLeo: 'Leo',
    railManunuzi: 'Manunuzi',
    mipangilio: 'Mipangilio',
    slabLipa: 'LIPA',
    slabKamilisha: 'KAMILISHA MAUZO',
    slabPokea: 'POKEA',
    syncCleanAria: 'Mauzo yote yametumwa',
    syncQueuedAria: 'Mauzo {count} yanasubiri kutumwa — fungua foleni',
    syncOfflineAria: 'Hakuna mtandao — fungua foleni',
    settingsRep: 'Mhudumu',
    settingsTerminal: 'Kituo',
    settingsBranch: 'Tawi',
    settingsLanguage: 'Lugha',
    settingsVersion: 'Toleo la programu',
    // Kaunta ritual (Phase 3): MUHURI stamp, ribbon, rejected-sale ritual
    stampImelipwa: 'IMELIPWA',
    stampImehifadhiwa: 'IMEHIFADHIWA',
    stampMzigo: 'MZIGO UMEPOKELEWA',
    custodyNote: 'Imeandikwa kwenye daftari — itatumwa mtandao ukirudi',
    ribbonOffline: 'Hakuna mtandao — mauzo ya pesa taslimu tu',
    ribbonSending: 'Inatuma…',
    retryThisSale: 'Jaribu tena',
    callSupervisor: 'Mwite msimamizi',
    callSupervisorNote: 'Msimamizi pekee ndiye anaweza kuamua kuhusu mauzo haya.',
    technicalDetails: 'Maelezo ya kiufundi',
    errorFallback: 'Haikukubaliwa — mwite msimamizi',
    errCreditLimit: 'Mteja amefikia kikomo cha mkopo',
    errCustomerInvalid: 'Mteja huyu hakubaliki kwa mkopo hapa',
    errAlreadySent: 'Mauzo haya yameshatumwa',
    errInsufficientStock: 'Stoo haitoshi kwa bidhaa hii',
    errProductUnavailable: 'Bidhaa hii haipatikani kwenye kituo hiki',
    // Kaunta Leo day book (Phase 3)
    leoTitle: 'Daftari la Leo',
    leoDayTotal: 'Jumla ya leo',
    leoSent: 'Zimetumwa {count}',
    leoHeld: 'Mkononi {count}',
    leoTallyAria: 'Kazi {count} zimekamilika leo',
    leoLastKnown: 'Mwisho kuonekana {time}',
    leoOfflineNote: 'Hakuna mtandao — zilizotumwa zitaonekana mtandao ukirudi.',
    leoLoadError: 'Imeshindikana kupakua mauzo ya leo',
    tryAgain: 'Jaribu tena',
    // Kaunta Mipangilio (Phase 3): haptics toggle, catalog re-sync
    settingsHaptics: 'Mtetemo',
    settingsHapticsNote: 'Simu itatetema kidogo kazi ikikamilika.',
    settingsResync: 'Pakua bidhaa upya',
    settingsResyncDone: 'Bidhaa zimepakuliwa upya',
    // Activation
    setupTitle: 'Sajili POS hii',
    setupSubtitle: 'Tumia namba uliyopewa na msimamizi wako.',
    terminalCodeLabel: 'Namba ya kituo',
    setupCodeLabel: 'Namba ya kusajili',
    connectPhone: 'Unganisha simu hii',
    connecting: 'Inaunganisha...',
    enterBothCodes: 'Andika namba ya kituo na namba ya kusajili.',
    notActivated: 'Simu hii haikuweza kuunganishwa.',
    phoneReady: 'Simu hii iko tayari',
    alreadyConnected: 'Kituo {code} tayari kimeunganishwa kwenye simu hii.',
    openSales: 'Fungua Mauzo',
  },
} as const satisfies Record<PosLang, Record<string, string>>;

export type PosStringKey = keyof (typeof STRINGS)['en'];

function readStoredLang(): PosLang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'sw' ? stored : DEFAULT_LANG;
}

export function usePosLang(): {
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  t: (key: PosStringKey, vars?: Record<string, string | number>) => string;
} {
  const [lang, setLangState] = useState<PosLang>(readStoredLang);

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  const setLang = useCallback((next: PosLang) => {
    setLangState(next);
    // Best-effort persist (private mode etc.) — language just won't stick.
    safeLocalStorageSet(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: PosStringKey, vars?: Record<string, string | number>) => {
      let text: string = STRINGS[lang][key] ?? STRINGS.en[key];
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [lang],
  );

  return { lang, setLang, t };
}
