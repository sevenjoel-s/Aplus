export interface EthiopiaLocationSeed {
  id: string;
  region: string;
  city: string;
  subCity?: string;
  woreda?: string;
  neighborhood?: string;
  lat: number;
  lng: number;
}

export const ETHIOPIA_LOCATIONS: EthiopiaLocationSeed[] = [
  { id: 'loc_addis_bole', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Bole', woreda: 'Woreda 03', neighborhood: 'Bole Medhanialem', lat: 8.9974, lng: 38.7868 },
  { id: 'loc_addis_kirkos', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Kirkos', woreda: 'Woreda 02', neighborhood: 'Kazanchis', lat: 9.0165, lng: 38.7659 },
  { id: 'loc_addis_arada', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Arada', woreda: 'Woreda 01', neighborhood: 'Piassa', lat: 9.0355, lng: 38.7524 },
  { id: 'loc_addis_yeka', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Yeka', woreda: 'Woreda 07', neighborhood: 'Megenagna', lat: 9.0205, lng: 38.8012 },
  { id: 'loc_addis_lideta', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Lideta', woreda: 'Woreda 08', neighborhood: 'Mexico Square', lat: 9.0104, lng: 38.7445 },
  { id: 'loc_addis_nifas_silk', region: 'Addis Ababa', city: 'Addis Ababa', subCity: 'Nifas Silk-Lafto', woreda: 'Woreda 05', neighborhood: 'Sarbet', lat: 8.9942, lng: 38.7386 },
  { id: 'loc_dire_dawa', region: 'Dire Dawa', city: 'Dire Dawa', subCity: 'Sabian', woreda: 'Kebele 02', neighborhood: 'Kezira', lat: 9.5931, lng: 41.8661 },
  { id: 'loc_oromia_adama', region: 'Oromia', city: 'Adama', subCity: 'Bole', woreda: 'Kebele 04', neighborhood: 'Adama Center', lat: 8.54, lng: 39.27 },
  { id: 'loc_oromia_jimma', region: 'Oromia', city: 'Jimma', subCity: 'Hermata', woreda: 'Kebele 01', neighborhood: 'Jimma Town', lat: 7.6734, lng: 36.8344 },
  { id: 'loc_oromia_shashamane', region: 'Oromia', city: 'Shashamane', subCity: 'Arada', woreda: 'Kebele 01', neighborhood: 'Central', lat: 7.2, lng: 38.6 },
  { id: 'loc_amhara_bahir_dar', region: 'Amhara', city: 'Bahir Dar', subCity: 'Belay Zeleke', woreda: 'Kebele 05', neighborhood: 'Lake Tana Shore', lat: 11.5742, lng: 37.3614 },
  { id: 'loc_amhara_gondar', region: 'Amhara', city: 'Gondar', subCity: 'Maraki', woreda: 'Kebele 18', neighborhood: 'Fasil Ghebbi', lat: 12.6, lng: 37.4667 },
  { id: 'loc_amhara_dessie', region: 'Amhara', city: 'Dessie', subCity: 'Buanbua Wuha', woreda: 'Kebele 03', neighborhood: 'Piazza', lat: 11.1333, lng: 39.6333 },
  { id: 'loc_sidama_hawassa', region: 'Sidama', city: 'Hawassa', subCity: 'Tabor', woreda: 'Hiteta', neighborhood: 'Hawassa Piassa', lat: 7.0621, lng: 38.4763 },
  { id: 'loc_tigray_mekelle', region: 'Tigray', city: 'Mekelle', subCity: 'Hawelti', woreda: 'Adi Haki', neighborhood: 'Romanat', lat: 13.4967, lng: 39.4753 },
  { id: 'loc_somali_jigjiga', region: 'Somali', city: 'Jigjiga', subCity: 'Kebele 04', woreda: 'Central', neighborhood: 'Taiwan Market', lat: 9.35, lng: 42.8 },
  { id: 'loc_harari_harar', region: 'Harari', city: 'Harar', subCity: 'Jugol', woreda: 'Abadir', neighborhood: 'Feres Magala', lat: 9.3139, lng: 42.1182 },
  { id: 'loc_south_arbaminch', region: 'South Ethiopia', city: 'Arba Minch', subCity: 'Sikela', woreda: 'Kebele 01', neighborhood: 'Sikela Center', lat: 6.0333, lng: 37.55 },
  { id: 'loc_benishangul_asosa', region: 'Benishangul-Gumuz', city: 'Asosa', subCity: 'Kebele 01', woreda: 'Asosa', neighborhood: 'Central', lat: 10.0667, lng: 34.5333 },
  { id: 'loc_afar_semera', region: 'Afar', city: 'Semera', subCity: 'Kebele 01', woreda: 'Dubti', neighborhood: 'Semera University Road', lat: 11.7924, lng: 41.0091 },
  { id: 'loc_gambella_gambella', region: 'Gambella', city: 'Gambella', subCity: 'Kebele 03', woreda: 'Gambella', neighborhood: 'Baro Bridge', lat: 8.25, lng: 34.5833 },
  { id: 'loc_central_hosanna', region: 'Central Ethiopia', city: 'Hosanna', subCity: 'Sech Duna', woreda: 'Kebele 01', neighborhood: 'Hospital Road', lat: 7.55, lng: 37.85 },
  { id: 'loc_swe_bonga', region: 'South West Ethiopia Peoples', city: 'Bonga', subCity: 'Kebele 01', woreda: 'Gimbo', neighborhood: 'Bonga Center', lat: 7.2667, lng: 36.2333 },
];
