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
    saleSendFailedUnknown:
      'It did not complete — we cannot tell whether the sale went through. Do not send it again; call a supervisor to check.',
    errCreditLimit: 'Customer has reached their credit limit',
    errCustomerInvalid: 'This customer cannot buy on credit here',
    // No errAlreadySent — deleted with the row that produced it; see the
    // Swahili catalog below and the note in pos-errors.ts.
    errInsufficientStock: 'Not enough stock for this product',
    errProductUnavailable: 'This product is not available on this terminal',
    // Stock-count rejections (spec-inventory §4 pattern additions)
    errNotStockItem: 'This product is not kept in stock',
    errProductNotInBranch: 'This product is not available at this branch',
    errDuplicateLine: 'This product is listed twice',
    errNoBuyingPrice:
      '{name} has no buying price — remove it from the count; the office must set one first.',
    errCountTooLong: 'One count carries {count} products — send the rest as a second count.',
    errCountTooOld:
      'This count was taken more than {hours} hours ago — it can no longer be sent from this phone. Count the shelf again.',
    errCountTooOldRecorded:
      'This count was taken more than {hours} hours ago — it cannot be sent from this phone. Count the shelf again, or ask the office to approve the one already recorded.',
    errStillSending: 'This is still being sent — wait a moment, then try again.',
    errSlipAlreadyReceived:
      'The earlier slip for this delivery was already received — check with the office before sending it again.',
    errCountAlreadySent:
      'This count was already sent with different numbers — check with the office before sending it again.',
    // Purchase rejections (spec-purchases §7/§8 cases 3-5)
    supplierNotAvailable: 'This supplier is not available for this branch — choose another.',
    errNoPurchaseCost: '{name} has no buying price — type it on that line.',
    errOneCostPerProduct: 'One product takes one buying price — fix the repeated line.',
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
    // Kaunta Stoo (Phase 4): stock screen — 22 keys, spec-inventory §4
    // (stockRetry is consolidated into the shared tryAgain above).
    stockTab: 'Stock',
    stockAll: 'All',
    stockLowChip: 'Low',
    stockOutChip: 'Out',
    stockInStock: 'In stock',
    stockLow: 'Running low',
    stockOut: 'Out of stock',
    stockOversold: 'More than recorded',
    stockSearchPlaceholder: 'Search stock',
    stockEmpty: 'No stock items yet',
    stockFilterEmpty: 'Nothing matches this filter',
    stockLoadError: 'Could not load stock',
    stockFreshNow: 'Just now',
    stockFreshMinutes: '{count} min ago',
    stockFreshHours: '{count} hr ago',
    stockLastSeen: 'Last seen {time}',
    stockStaleHidden: 'Data is old — quantities hidden',
    stockPrice: 'Price',
    stockNoPrice: 'No price set',
    stockOnHand: 'On hand',
    stockReserved: 'Reserved',
    stockThreshold: 'Reorder at: {count}',
    // Kaunta Hesabu (Phase 5): count mode — spec-inventory §4 (+ the §3
    // success-screen secondary), translated from the Swahili below.
    countStart: 'START COUNT',
    countTitle: 'Stock count',
    countReview: 'REVIEW COUNT',
    countSubmit: 'SEND COUNT',
    countSubmitting: 'Sending…',
    countNotCounted: 'Not counted',
    countProgress: '{count} counted',
    countVariance: 'Variance',
    countPreviewNote: 'Estimate — exact records are read when you send',
    countCapturedAt: 'Counted at {time}',
    countConfirmBody: 'This count updates stock records immediately.',
    countBigVariance: 'The variance is large — check again before sending.',
    countConfirmAnyway: 'Yes, send the count',
    countDone: 'COUNT COMPLETE',
    countPendingApproval: 'Waiting for office approval',
    countNeedsNetwork: 'Sending a count needs a network connection',
    countResumeDraft: 'Continue earlier count',
    countDiscardDraft: 'Discard draft',
    countDraftSaved: 'Draft saved on this phone',
    countDraftSaveFailed:
      'This count is not saved on this phone — it cannot be sent until it is. Try again.',
    countStartNew: 'Start a new count',
    countStartNewBody:
      'The count in hand will be cleared from this phone and you will start again. The numbers you counted will not be kept.',
    countStartNewConfirm: 'Yes, start a new count',
    countQueueGate: 'Sales are still waiting to send — send them before counting.',
    countBackToStoo: 'BACK TO STOCK',
    countLinesGone: 'Counted products that are no longer in stock — remove them to send the count.',
    countStockNotLoaded:
      'The stock list has not loaded — your count is safe on this phone. Try again to continue.',
    countStockRetrying: 'Trying…',
    countStockRetryFailed: 'It did not load this time either — try again when the network holds.',
    countLimitNear: 'Close to the limit — one count takes {count} products.',
    countLimitReached:
      'One count cannot exceed {count} products. Remove the extra lines, send this count, then count the rest.',
    countRejectedFinal:
      'This count cannot be sent as it stands — go back and fix it before sending again.',
    countSendFailedRetry:
      'It did not go through — your count is safe on this phone. Wait a moment, then send it again.',
    // Kaunta kikaratasi (Phase 5): the purchase draft — spec-purchases §7,
    // active set only (the slip* reconnect keys are DEFERRED with critique D3).
    slabSaveSlip: 'SAVE SLIP',
    slipSaved: 'Slip saved on this phone.',
    slipSaveFailed: 'The slip was not saved on this phone — try again.',
    slipSendBlocked:
      'This slip is not saved on this phone — the delivery cannot be received until it is. Try again.',
    slipBadge: 'Slip',
    purchaseOfflineNote: 'No network — fill the form; the slip will be saved on this phone.',
    purchaseSendFailedRetry:
      'It did not go through — the network dropped. The form is still here; wait a moment, then tap RECEIVE again.',
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
    // A live sale whose answer never arrived (a 5xx, a gateway that gave up, an
    // unreadable shape). It may have committed, and the sale path is the ONE
    // send surface with no frozen key — completeSale mints a fresh key per
    // attempt — so "jaribu tena" would be an instruction that books the sale
    // twice, and "haikukubaliwa" would state a refusal that never happened.
    // The copy says what is known, names the one move that is safe, and blocks
    // the one that is not.
    saleSendFailedUnknown:
      'Haikukamilika — hatujui kama mauzo yameingia. Usitume tena; mwite msimamizi ahakiki.',
    errCreditLimit: 'Mteja amefikia kikomo cha mkopo',
    errCustomerInvalid: 'Mteja huyu hakubaliki kwa mkopo hapa',
    // No errAlreadySent. It said "Mauzo haya yameshatumwa" to a manager whose
    // send had just been REJECTED; pos-errors.ts deleted the row that produced
    // it (nothing on the sale path emits that copy — the replay is silent), and
    // posErrorKey is the only producer of these keys, so the entries went with
    // the row rather than sitting here as copy no path can show.
    // No errCountClosed either (round 5, same rule): the sentence it translated
    // came from assertStockCountNotRetired, deleted in round 4, on a route that
    // has never been deployed — so no server that can answer this phone emits
    // it and no code path could reach these two entries. The row went with
    // them; pos-errors.ts records why.
    errInsufficientStock: 'Stoo haitoshi kwa bidhaa hii',
    errProductUnavailable: 'Bidhaa hii haipatikani kwenye kituo hiki',
    // Stock-count rejections (spec-inventory §4 pattern additions)
    errNotStockItem: 'Bidhaa hii haihifadhiwi stoo',
    errProductNotInBranch: 'Bidhaa haipatikani kwenye tawi hili',
    errDuplicateLine: 'Bidhaa imeandikwa mara mbili',
    // The count-up cost rejection (round 2): one unpriced line rejects the
    // whole sheet, and she cannot price it from the phone — so the copy names
    // the line to drop and sends the price question to the office.
    errNoBuyingPrice: '{name} haina bei ya kununua — iondoe kwenye hesabu; ofisi iweke bei kwanza.',
    // The cap and the recovery both come from the server's own sentence, so the
    // Swahili quotes its number instead of repeating a constant that can drift.
    errCountTooLong:
      'Hesabu moja inachukua bidhaa {count} — zilizobaki zitume kama hesabu ya pili.',
    // The capture's life, both sides of the freeze. This is the only permanent
    // refusal the shelf itself can answer, so the copy names the count rather
    // than the office — and the rejection card carries ANZA HESABU MPYA under
    // it, because an instruction with no button behind it is what round 2
    // deleted. The window is the server's own number, quoted, not a constant
    // repeated here.
    errCountTooOld:
      'Hesabu hii ilihesabiwa zaidi ya saa {hours} zilizopita — haiwezi kutumwa tena kutoka kwenye simu hii. Hesabu stoo upya.',
    // …and the resume side, where a sheet WAS recorded and left alive. The
    // second clause exists only here: telling her to ask the office about a
    // count that was never created would send her to a desk with nothing to
    // look at.
    errCountTooOldRecorded:
      'Hesabu hii ilihesabiwa zaidi ya saa {hours} zilizopita — haiwezi kutumwa kutoka kwenye simu hii. Hesabu stoo upya, au ulizia ofisi iidhinishe ile iliyorekodiwa.',
    errStillSending: 'Bado inatumwa — subiri kidogo, kisha jaribu tena.',
    // The one place "already received" is the truth and not the lie the deleted
    // errAlreadySent used to tell: this delivery really did land once.
    errSlipAlreadyReceived:
      'Mzigo huu ulishapokelewa kwa kikaratasi cha awali — ulizia ofisi kabla ya kutuma tena.',
    // …and the count's half of it (round 4): the sheet behind this key really
    // was recorded, with DIFFERENT numbers from the ones she just sent. Neither
    // side of that can be settled on the phone — replaying posts the numbers she
    // came to correct, re-sending posts the shelf twice — so the copy states the
    // fact and names the only place both sheets are visible. It must never read
    // as "sent successfully": what she is holding was not sent.
    errCountAlreadySent:
      'Hesabu hii ilishatumwa na namba tofauti — ulizia ofisi kabla ya kutuma tena.',
    // Manunuzi rejections (spec-purchases §7/§8 cases 3-5). Each one names the
    // ONE field she has to touch: the supplier chip, or the buying-price box on
    // the named line. All three were English on the shelf until round 3.
    supplierNotAvailable: 'Muuzaji huyu hapatikani kwa tawi hili — chagua mwingine.',
    errNoPurchaseCost: '{name} haina bei ya kununua — andika bei kwenye mstari wake.',
    errOneCostPerProduct:
      'Bidhaa moja inahitaji bei moja ya kununua — sahihisha mstari uliojirudia.',
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
    // Kaunta Stoo (Phase 4): stock screen — 22 keys, spec-inventory §4,
    // Swahili first-class (stockRetry is consolidated into tryAgain above).
    stockTab: 'Stoo',
    stockAll: 'Zote',
    stockLowChip: 'Kidogo',
    stockOutChip: 'Imeisha',
    stockInStock: 'Ipo',
    stockLow: 'Inakwisha',
    stockOut: 'Imeisha',
    stockOversold: 'Zaidi ya rekodi',
    stockSearchPlaceholder: 'Tafuta bidhaa stoo',
    stockEmpty: 'Hakuna bidhaa za stoo bado',
    stockFilterEmpty: 'Hakuna bidhaa kwenye kichujio hiki',
    stockLoadError: 'Imeshindikana kupakua stoo',
    stockFreshNow: 'Sasa hivi',
    stockFreshMinutes: 'Dakika {count} zilizopita',
    stockFreshHours: 'Saa {count} zilizopita',
    stockLastSeen: 'Mwisho kuonekana {time}',
    stockStaleHidden: 'Taarifa za zamani — idadi zimefichwa',
    stockPrice: 'Bei',
    stockNoPrice: 'Haina bei',
    stockOnHand: 'Kiasi',
    stockReserved: 'Zilizowekwa',
    stockThreshold: 'Kikomo: {count}',
    // Kaunta Hesabu (Phase 5): count mode — the 20 keys of spec-inventory §4,
    // Swahili first-class. countBackToStoo is the §3 success-screen secondary
    // (its copy is named in the prose, not in the §4 table).
    countStart: 'ANZA KUHESABU',
    countTitle: 'Hesabu',
    countReview: 'KAGUA HESABU',
    countSubmit: 'TUMA HESABU',
    countSubmitting: 'Inatuma…',
    countNotCounted: 'Haijahesabiwa',
    countProgress: 'Umehesabu {count}',
    countVariance: 'Tofauti',
    countPreviewNote: 'Makadirio — rekodi kamili itasomwa wakati wa kutuma',
    countCapturedAt: 'Ilihesabiwa {time}',
    countConfirmBody: 'Hesabu hii itabadilisha rekodi za stoo mara moja.',
    countBigVariance: 'Tofauti ni kubwa — hakiki tena kabla ya kutuma.',
    countConfirmAnyway: 'Ndiyo, tuma hesabu',
    countDone: 'HESABU IMEKAMILIKA',
    countPendingApproval: 'Inasubiri idhini ya ofisi',
    countNeedsNetwork: 'Kutuma hesabu kunahitaji mtandao',
    countResumeDraft: 'Endeleza hesabu ya awali',
    countDiscardDraft: 'Futa rasimu',
    countDraftSaved: 'Rasimu imehifadhiwa kwenye simu hii',
    // Not in §4: the spec assumed the phone always accepts the write. When
    // storage refuses (quota, private mode) the line above becomes a lie about
    // work she walked a storeroom to collect — and the same refused write is
    // what drops the idempotency key, so the send is refused with it. One
    // sentence for both, because they are the same fact.
    countDraftSaveFailed:
      'Hesabu hii haijahifadhiwa kwenye simu hii — haiwezi kutumwa hadi ihifadhiwe. Jaribu tena.',
    // ANZA HESABU MPYA — the control the retired-chain copy has been naming
    // since round 2 with nothing behind it. It ENDS the sheet, so it asks
    // first, and the question says plainly what goes.
    countStartNew: 'Anza hesabu mpya',
    countStartNewBody:
      'Hesabu iliyopo itafutwa kwenye simu hii na utaanza upya. Namba ulizohesabu hazitabaki.',
    countStartNewConfirm: 'Ndiyo, anza hesabu mpya',
    countQueueGate: 'Kuna mauzo yanasubiri kutumwa — Tuma Sasa kabla ya kuhesabu.',
    countBackToStoo: 'RUDI STOO',
    // §7 case 5 ("the rep removes the line and resubmits") needs a place to
    // say WHICH line, so the counted-but-vanished block carries this header.
    // It is claimed ONLY when a snapshot loaded and the product is not in it:
    // "hazipo tena stoo" is a statement about the products, and stating it
    // over a stoo that merely failed to load is a lie whose only offered
    // remedy deletes the count.
    countLinesGone: 'Bidhaa zilizohesabiwa lakini hazipo tena stoo — ziondoe ili kutuma hesabu.',
    // …and the honest copy for the other case: the stoo did not load. The
    // count is untouched, the retry is the fix, and nothing here invites a
    // delete.
    countStockNotLoaded:
      'Orodha ya stoo haijapakiwa — hesabu yako ipo salama kwenye simu hii. Jaribu tena ili kuendelea.',
    // …and the retry on that card answers, in words: its own flight, then its
    // own result. A verb whose failure repaints nothing reads as a frozen app.
    countStockRetrying: 'Inajaribu…',
    countStockRetryFailed: 'Bado haijapakiwa — jaribu tena mtandao ukiimarika.',
    // The line ceiling (mirrors the backend DTO cap): named while she can
    // still act on it, then stated with the way out once it is passed.
    countLimitNear: 'Umekaribia kikomo — hesabu moja inachukua bidhaa {count}.',
    countLimitReached:
      'Hesabu moja haiwezi kuzidi bidhaa {count}. Ondoa zilizozidi, tuma hesabu hii, kisha hesabu zilizobaki.',
    // Said ONLY when the server proved the body is what is wrong AND an edit
    // is a real remedy (`PosCountRefusal === 'sheet'`). The same sheet sent
    // again earns the same answer, so the copy points at the edit that changes
    // it. It is deliberately NOT said over a capture too old to send
    // (`'recount'`), where no edit to any line can help and the sentence
    // directly above it says the opposite ("hesabu stoo upya") — two adjacent
    // instructions pointing opposite ways, with the actionable one unbuttoned,
    // is the failure this pairing exists to avoid.
    countRejectedFinal:
      'Hesabu hii haiwezi kutumwa ilivyo — rudi na urekebishe kabla ya kutuma tena.',
    // …and the honest copy for everything the phone cannot prove — a 5xx, a
    // gateway timeout, an unreadable failure. Nothing is known to be wrong with
    // the count, so it must not be called refused ("mwite msimamizi" answers a
    // question nobody at the shelf can act on) and she must not be sent to edit
    // a sheet whose request may have landed. The frozen key makes the plain
    // retry the right move, so that is what it names.
    countSendFailedRetry:
      'Haikukamilika — hesabu yako ipo salama kwenye simu hii. Subiri kidogo, kisha ituma tena.',
    // Kaunta kikaratasi (Phase 5): the purchase draft — the 4 active keys of
    // spec-purchases §7, verbatim (the slip* reconnect keys are DEFERRED).
    slabSaveSlip: 'HIFADHI KIKARATASI',
    slipSaved: 'Kikaratasi kimehifadhiwa kwenye simu hii.',
    // Not in §7: the spec assumed the phone always accepts the write. When
    // storage refuses (quota, private mode) the affirmation above would be a
    // lie, and a slip lost in silence is what the kikaratasi exists to prevent
    // — so the failure gets words of its own, mirroring the saved copy.
    slipSaveFailed: 'Kikaratasi hakijahifadhiwa kwenye simu hii — jaribu tena.',
    // The same refusal met at POKEA rather than at the save verb, and it has to
    // answer a different question: she tapped RECEIVE, so what she needs told is
    // that the DELIVERY did not go — the phone would not keep the key the send
    // rides under, so the send was refused with it (usePosSlip.sendKey). The
    // sentence above would leave her wondering whether the lorry registered
    // anyway, which is the ambiguity that gets a delivery received twice. Built
    // to the count's line for the identical case (`countDraftSaveFailed`), so
    // the two surfaces refuse in the same words.
    slipSendBlocked:
      'Kikaratasi hiki hakijahifadhiwa kwenye simu hii — mzigo hauwezi kupokelewa hadi kihifadhiwe. Jaribu tena.',
    slipBadge: 'Kikaratasi',
    purchaseOfflineNote: 'Hakuna mtandao — jaza fomu; kikaratasi kitahifadhiwa kwenye simu.',
    // A POKEA whose answer never arrived (§3.1 "Error handling"). Nothing is
    // known to be wrong with the delivery — the request may even have landed —
    // so the copy must not read as a refusal, and it claims no custody either
    // (the phone may have refused the slip write too). The frozen key is what
    // makes the identical retry safe, so that is what it names. "Fomu ipo hapa"
    // is the only promise that is always true.
    purchaseSendFailedRetry:
      'Haikukamilika — mtandao umekatika. Fomu ipo hapa; subiri kidogo, kisha gonga POKEA tena.',
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
