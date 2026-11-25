import { LanguageCode } from '../types';

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  am: 'አማርኛ',
  om: 'Afaan Oromo',
  ti: 'ትግርኛ',
  so: 'Soomaali',
};

export interface TranslationBundle {
  appName: string;
  slogan: string;
  navPharmacies: string;
  navPrescriptions: string;
  navMessages: string;
  navPharmacyPortal: string;
  navAdmin: string;
  signIn: string;
  signOut: string;
  heroTitle: string;
  heroSubtitle: string;
  uploadPrescriptionBtn: string;
  uploadMedicineImageBtn: string;
  searchPharmacyPlaceholder: string;
  allCities: string;
  nearMeBtn: string;
  verifiedPharmaciesTitle: string;
  getDirections: string;
  contactPharmacy: string;
  audioCall: string;
  videoCall: string;
  subscriptionTitle: string;
  subscriptionPriceLine: string;
  subscriptionActive: string;
  subscriptionExpired: string;
  renewSubscription: string;
  payWithChapa: string;
  payWithTelebirr: string;
  payWithCbeBirr: string;
  allowNotifications: string;
  blockNotifications: string;
  prescriptionConsentText: string;
  pharmacistReviewNotice: string;
  noFakeDiagnosisNotice: string;
  reportIncorrectInfo: string;
  distanceKm: string;
  loading: string;
  errorGeneric: string;
  registerCustomer: string;
  registerPharmacy: string;
}

export const TRANSLATIONS: Record<LanguageCode, TranslationBundle> = {
  en: {
    appName: 'Aplus Drug Finder',
    slogan: 'Connect With Verified Pharmacies.',
    navPharmacies: 'Pharmacies',
    navPrescriptions: 'Prescriptions',
    navMessages: 'Messages',
    navPharmacyPortal: 'Pharmacy Hub',
    navAdmin: 'Admin',
    signIn: 'Sign In',
    signOut: 'Sign Out',
    heroTitle: 'Connect With Verified Ethiopian Pharmacies',
    heroSubtitle:
      'Find nearby EFDA-verified pharmacies, upload prescriptions securely, get directions, and speak directly with licensed pharmacists. Registration fee: 50 Birr for 1 month.',
    uploadPrescriptionBtn: 'Upload Prescription',
    uploadMedicineImageBtn: 'Upload Packaging Photo',
    searchPharmacyPlaceholder: 'Search verified pharmacies by name, city, sub-city, or street...',
    allCities: 'All Cities',
    nearMeBtn: 'Use My GPS',
    verifiedPharmaciesTitle: 'Verified Ethiopian Pharmacies',
    getDirections: 'Get Directions',
    contactPharmacy: 'Message Pharmacy',
    audioCall: 'Audio Call',
    videoCall: 'Video Call',
    subscriptionTitle: 'Registration Fee — 50 Birr for 1 Month',
    subscriptionPriceLine: '50 Birr (50 ETB) · 1 Month (30 Days) Access',
    subscriptionActive: '1-Month Registration Fee Active',
    subscriptionExpired: '50 Birr Registration Fee Required (1 Month Access)',
    renewSubscription: 'Pay 50 Birr Registration Fee (1 Month)',
    payWithChapa: 'Pay with Chapa',
    payWithTelebirr: 'Pay with Telebirr',
    payWithCbeBirr: 'Pay with CBE Birr',
    allowNotifications: 'Allow Notifications',
    blockNotifications: 'Block Notifications',
    prescriptionConsentText:
      'I consent to securely sharing these medical files exclusively with the verified pharmacies I selected.',
    pharmacistReviewNotice:
      'Uploaded images and prescriptions are reviewed directly by a licensed pharmacist. Automated diagnosis is never performed.',
    noFakeDiagnosisNotice:
      'Aplus Drug Finder connects users with EFDA-verified pharmacies and does not replace professional medical advice.',
    reportIncorrectInfo: 'Report incorrect info',
    distanceKm: 'Distance',
    loading: 'Loading...',
    errorGeneric: 'Unable to complete request. Please try again.',
    registerCustomer: 'Register as Patient / User',
    registerPharmacy: 'Register a Pharmacy',
  },
  am: {
    appName: 'Aplus Drug Finder',
    slogan: 'ከተረጋገጡ ፋርማሲዎች ጋር ይገናኙ።',
    navPharmacies: 'ፋርማሲዎች',
    navPrescriptions: 'ማዘዣዎች',
    navMessages: 'መልዕክቶች',
    navPharmacyPortal: 'የፋርማሲ ዳሽቦርድ',
    navAdmin: 'አስተዳዳሪ',
    signIn: 'ይግቡ',
    signOut: 'ይውጡ',
    heroTitle: 'በመላው ኢትዮጵያ ከተረጋገጡ ፋርማሲዎች ጋር ይገናኙ',
    heroSubtitle:
      'በአቅራቢያዎ ያሉ የተረጋገጡ ፋርማሲዎችን ያግኙ፣ የሐኪም ማዘዣ በደህና ይላኩ፣ አቅጣጫ ያግኙ እና ከፋርማሲስቶች ጋር በቀጥታ ይነጋገሩ። የምዝገባ ክፍያ፡ ለ1 ወር 50 ብር።',
    uploadPrescriptionBtn: 'የሐኪም ማዘዣ ይጫኑ',
    uploadMedicineImageBtn: 'የማሸጊያ ምስል ይጫኑ',
    searchPharmacyPlaceholder: 'ፋርማሲዎችን በስም፣ በከተማ ወይም በመንገድ ይፈልጉ...',
    allCities: 'ሁሉም ከተሞች',
    nearMeBtn: 'GPS ይጠቀሙ',
    verifiedPharmaciesTitle: 'የተረጋገጡ የኢትዮጵያ ፋርማሲዎች',
    getDirections: 'አቅጣጫ ያግኙ',
    contactPharmacy: 'ፋርማሲውን ያነጋግሩ',
    audioCall: 'የድምፅ ጥሪ',
    videoCall: 'የቪዲዮ ጥሪ',
    subscriptionTitle: 'የምዝገባ ክፍያ — ለ1 ወር 50 ብር',
    subscriptionPriceLine: '50 ብር · ለ1 ወር (30 ቀናት) ሙሉ አገልግሎት',
    subscriptionActive: 'የ1 ወር የምዝገባ ክፍያ ንቁ ነው',
    subscriptionExpired: 'የ50 ብር የ1 ወር የምዝገባ ክፍያ ያስፈልጋል',
    renewSubscription: 'የ50 ብር የምዝገባ ክፍያ ይክፈሉ (ለ1 ወር)',
    payWithChapa: 'በቻፓ (Chapa) ይክፈሉ',
    payWithTelebirr: 'በቴሌብር (Telebirr) ይክፈሉ',
    payWithCbeBirr: 'በሲቢኢ ብር (CBE Birr) ይክፈሉ',
    allowNotifications: 'ማሳወቂያዎችን ይፍቀዱ',
    blockNotifications: 'ማሳወቂያዎችን ይዝጉ',
    prescriptionConsentText:
      'ይህን የሐኪም ማዘዣ ሰነድ ለመረጥኳቸው የተረጋገጡ ፋርማሲዎች ብቻ በደህንነት እንዲደርስ እፈቅዳለሁ።',
    pharmacistReviewNotice:
      'የተጫኑ ምስሎች በተፈቀደለት ፋርማሲስት ብቻ ይታያሉ። አውቶማቲክ ምርመራ አይደረግም።',
    noFakeDiagnosisNotice:
      'Aplus Drug Finder ከተረጋገጡ ፋርማሲዎች ጋር ያገናኛል፤ የሐኪም ምክርን አይተካም።',
    reportIncorrectInfo: 'የተሳሳተ መረጃ ሪፖርት ያድርጉ',
    distanceKm: 'ርቀት',
    loading: 'በመጫን ላይ...',
    errorGeneric: 'ጥያቄውን ማጠናቀቅ አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
    registerCustomer: 'እንደ ተጠቃሚ ይመዝገቡ',
    registerPharmacy: 'ፋርማሲ ይመዝግቡ',
  },
  om: {
    appName: 'Aplus Drug Finder',
    slogan: 'Faarmaasota Mirkanaa’an Waliin Wal Qunnamaa.',
    navPharmacies: 'Faarmaasota',
    navPrescriptions: 'Ajaja Hakimii',
    navMessages: 'Ergaawwan',
    navPharmacyPortal: 'Wiirtuu Faarmaasii',
    navAdmin: 'Bulchaa',
    signIn: 'Seeni',
    signOut: 'Ba’i',
    heroTitle: 'Faarmaasota Itoophiyaa Mirkanaa’an Waliin Wal Qunnamaa',
    heroSubtitle:
      'Faarmaasota dhihoo jiran argadhaa, ajaja hakimii nageenyaan ergaa, kallattii argadhaa. Kaffaltiin galmee ji’a 1f Birrii 50 dha.',
    uploadPrescriptionBtn: 'Ajaja Hakimii Olkaa’aa',
    uploadMedicineImageBtn: 'Suuraa Olkaa’aa',
    searchPharmacyPlaceholder: 'Maqaa faarmaasii, magaalaa ykn naannoodhaan barbaadaa...',
    allCities: 'Magaalota Hunda',
    nearMeBtn: 'GPS Koo Fayyadami',
    verifiedPharmaciesTitle: 'Faarmaasota Itoophiyaa Mirkanaa’an',
    getDirections: 'Kallattii Argadhu',
    contactPharmacy: 'Faarmaasii Quunnami',
    audioCall: 'Bilbila Sagalee',
    videoCall: 'Bilbila Viidiyoo',
    subscriptionTitle: 'Kaffaltii Galmee — Ji’a 1f Birrii 50',
    subscriptionPriceLine: 'Birrii 50 · Ji’a 1 (Guyyoota 30)',
    subscriptionActive: 'Kaffaltiin Galmee Ji’a 1 Hojii Irra Jira',
    subscriptionExpired: 'Kaffaltiin Galmee Birrii 50 (Ji’a 1f) Barbaachisa',
    renewSubscription: 'Kaffaltii Galmee Birrii 50 Kaffali (Ji’a 1)',
    payWithChapa: 'Chapa’n Kaffali',
    payWithTelebirr: 'Telebirr’n Kaffali',
    payWithCbeBirr: 'CBE Birr’n Kaffali',
    allowNotifications: 'Beeksisa Eeyyami',
    blockNotifications: 'Beeksisa Dhorki',
    prescriptionConsentText:
      'Sanadoota ajaja hakimii kana faarmaasota mirkanaa’an ani filadhe qofaaf nageenyaan qooduuf eeyyama kenneera.',
    pharmacistReviewNotice:
      'Suuraan olkaa’ame ogeessa faarmaasii hayyama qabuun qofa ilaalama.',
    noFakeDiagnosisNotice:
      'Aplus Drug Finder faarmaasota mirkanaa’an waliin isin qunnamsiisa; gorsa ogeessa fayyaa hin bakka bu’u.',
    reportIncorrectInfo: 'Odeeffannoo dogoggoraa gabaasi',
    distanceKm: 'Fageenya',
    loading: 'Fe’amaa jira...',
    errorGeneric: 'Gaaffiin hin milkoofne. Irra deebi’aa yaalaa.',
    registerCustomer: 'Akka Fayyadamaatti Galmaa’i',
    registerPharmacy: 'Faarmaasii Galmeessi',
  },
  ti: {
    appName: 'Aplus Drug Finder',
    slogan: 'ምስ ዝተረጋገጻ ፋርማሲታት ተራኸቡ።',
    navPharmacies: 'ፋርማሲታት',
    navPrescriptions: 'ትእዛዝ ሓኪም',
    navMessages: 'መልእኽትታት',
    navPharmacyPortal: 'ዳሽቦርድ ፋርማሲ',
    navAdmin: 'ኣመሓዳሪ',
    signIn: 'እቶ',
    signOut: 'ውጻእ',
    heroTitle: 'ኣብ መላእ ኢትዮጵያ ምስ ዝተረጋገጻ ፋርማሲታት ተራኸቡ',
    heroSubtitle:
      'ኣብ ቀረባኹም ዘለዋ ፋርማሲታት ርኸቡ፣ ትእዛዝ ሓኪም ብደሕንነት ስደዱ፣ ምስ ፋርማሲስታት ተዘራረቡ። ክፍሊት ምዝገባ፡ ን1 ወርሒ 50 ብር።',
    uploadPrescriptionBtn: 'ትእዛዝ ሓኪም ጽዓኑ',
    uploadMedicineImageBtn: 'ስእሊ ጽዓኑ',
    searchPharmacyPlaceholder: 'ፋርማሲ ብስም፣ ከተማ ወይ ከባቢ ድለዩ...',
    allCities: 'ኩለን ከተማታት',
    nearMeBtn: 'GPS ተጠቐም',
    verifiedPharmaciesTitle: 'ዝተረጋገጻ ፋርማሲታት ኢትዮጵያ',
    getDirections: 'ኣንፈት ርኸብ',
    contactPharmacy: 'ፋርማሲ ተወከስ',
    audioCall: 'ናይ ድምጺ ጻውዒት',
    videoCall: 'ናይ ቪድዮ ጻውዒት',
    subscriptionTitle: 'ክፍሊት ምዝገባ — ን1 ወርሒ 50 ብር',
    subscriptionPriceLine: '50 ብር · ን1 ወርሒ (30 መዓልታት)',
    subscriptionActive: 'ናይ 1 ወርሒ ክፍሊት ምዝገባ ንጡፍ እዩ',
    subscriptionExpired: 'ናይ 1 ወርሒ 50 ብር ክፍሊት ምዝገባ የድሊ',
    renewSubscription: '50 ብር ክፍሊት ምዝገባ ክፈል (ን1 ወርሒ)',
    payWithChapa: 'ብቻፓ ክፈል',
    payWithTelebirr: 'ብቴሌብር ክፈል',
    payWithCbeBirr: 'ብሲቢኢ ብር ክፈል',
    allowNotifications: 'መፍለጢ ፍቐድ',
    blockNotifications: 'መፍለጢ ኣግድ',
    prescriptionConsentText:
      'እዚ ትእዛዝ ሓኪም ንዝመረጽክወን ዝተረጋገጻ ፋርማሲታት ጥራይ ብምስጢር ክበጽሕ ፈቒደ ኣለኹ።',
    pharmacistReviewNotice:
      'ዝተጻዕኑ ስእልታት ብፍቓድ ዘለዎ ፋርማሲስት ጥራይ ይምርመሩ።',
    noFakeDiagnosisNotice:
      'Aplus Drug Finder ምስ ዝተረጋገጻ ፋርማሲታት የራኽብ፤ ምኽሪ ሓኪም ኣይትክእን።',
    reportIncorrectInfo: 'ጌጋ ሓበሬታ ኣፍልጥ',
    distanceKm: 'ርሕቀት',
    loading: 'ይጽዓን ኣሎ...',
    errorGeneric: 'ሕቶ ክፍጸም ኣይከኣለን። በጃኹም እንደገና ፈትኑ።',
    registerCustomer: 'ከም ተጠቃሚ ተመዝገብ',
    registerPharmacy: 'ፋርማሲ መዝግብ',
  },
  so: {
    appName: 'Aplus Drug Finder',
    slogan: 'La Xiriir Farmashiyada La Xaqiijiyay.',
    navPharmacies: 'Farmashiyada',
    navPrescriptions: 'Warqadaha Dhakhtarka',
    navMessages: 'Fariimaha',
    navPharmacyPortal: 'Xarunta Farmashiga',
    navAdmin: 'Maamulka',
    signIn: 'Soo Gal',
    signOut: 'Ka Bax',
    heroTitle: 'La Xiriir Farmashiyada La Xaqiijiyay Ee Itoobiya',
    heroSubtitle:
      'Hel farmashiyada kuu dhow, si ammaan ah u dir warqadda dhakhtarka, lana hadal farmashiiste shati leh. Khidmada diiwaangelinta: 50 Birr bishii.',
    uploadPrescriptionBtn: 'Soo Geli Warqadda Dhakhtarka',
    uploadMedicineImageBtn: 'Soo Geli Sawirka',
    searchPharmacyPlaceholder: 'Ka raadi farmashiye magac, magaalo, ama waddo...',
    allCities: 'Dhammaan Magaalooyinka',
    nearMeBtn: 'Adeegso GPS',
    verifiedPharmaciesTitle: 'Farmashiyada Itoobiya Ee La Xaqiijiyay',
    getDirections: 'Hel Tilmaanta Waddada',
    contactPharmacy: 'La Xiriir Farmashiga',
    audioCall: 'Wicitaan Cod',
    videoCall: 'Wicitaan Muuqaal',
    subscriptionTitle: 'Khidmada Diiwaangelinta — 50 Birr 1 Bil',
    subscriptionPriceLine: '50 Birr (50 ETB) · 1 Bil (30 Maalmood)',
    subscriptionActive: 'Khidmada Diiwaangelinta 1 Bil Way Shaqeyneysaa',
    subscriptionExpired: 'Waxaa Loo Baahan Yahay 50 Birr Khidmada Diiwaangelinta (1 Bil)',
    renewSubscription: 'Bixi 50 Birr Khidmada Diiwaangelinta (1 Bil)',
    payWithChapa: 'Ku Bixi Chapa',
    payWithTelebirr: 'Ku Bixi Telebirr',
    payWithCbeBirr: 'Ku Bixi CBE Birr',
    allowNotifications: 'Oggolow Ogeysiisyada',
    blockNotifications: 'Xannib Ogeysiisyada',
    prescriptionConsentText:
      'Waxaan oggolahay in warqaddan dhakhtarka si qarsoodi ah loola wadaago oo keliya farmashiyada la xaqiijiyay ee aan doortay.',
    pharmacistReviewNotice:
      'Sawirrada la soo geliyay waxaa eega farmashiiste shati leh oo keliya.',
    noFakeDiagnosisNotice:
      'Aplus Drug Finder waxa uu kugu xiraa farmashiyada la xaqiijiyay, ma beddelo talada dhakhtarka.',
    reportIncorrectInfo: 'Ka warbixi xog khaldan',
    distanceKm: 'Masaafada',
    loading: 'Waa la soo rarayaa...',
    errorGeneric: 'Codsiga lama dhammaystiri karin. Fadlan mar kale isku day.',
    registerCustomer: 'Isku Diiwaangeli Sida Isticmaale',
    registerPharmacy: 'Diiwaangeli Farmashi',
  },
};
