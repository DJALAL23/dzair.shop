-- Algeria's places on the map of law 26-06 (JO n° 25, 5 April 2026): 69
-- wilayas and 1541 communes, numbered 59–69 by decree 26-206 (JO n° 40).
--
-- Migration 0000 seeded the 1984 map: the communes of the 2019 wilayas were
-- still under the wilayas they were taken from, each 2019 wilaya held one
-- placeholder copy of its capital, and many names were misspelt or carried
-- another town's Arabic name. Every store holds exactly those rows (Wocart
-- never writes them), so this migration moves them to the list in
-- cod-shared/places/algeria.ts, which a test holds D1 to:
--
--   1. the 11 wilayas of 2026;
--   2. each commune's wilaya, name and Arabic name (same place, same id);
--   3. the 10 placeholder copies merged into their commune: every address,
--      price override and carrier name that pointed at a copy points at the
--      commune, then the copy goes;
--   4. every address takes its commune's wilaya;
--   5. each new wilaya's shipping prices and drivers' fees start as those of
--      the wilaya it was taken from, and a commune's price override follows
--      the commune to its wilaya's rule;
--   6. the carrier name maps (carrier_wilayas, carrier_communes) give way to
--      one map per delivery company, carrier_places, filled from the carrier's
--      own list (the next sync fills it; until then a parcel is refused, never
--      sent under a guessed name).
--
-- data-safety: communes — same places and ids; wilaya, name and Arabic name corrected to laws 19-12 and 26-06, and the 10 placeholder copies merged into the communes they copied
-- data-safety: customers — an address on a placeholder copy points at its commune, and every address takes its commune's wilaya and names
-- data-safety: orders — an address on a placeholder copy points at its commune, and every address takes its commune's wilaya
-- data-safety: abandoned_orders — an address on a placeholder copy points at its commune, and every address takes its commune's wilaya and names
-- data-safety: shipping_rule_communes — an override follows its commune: from a placeholder copy to the commune, and to the rule of the commune's wilaya; an override the commune already has in that rule wins
-- data-safety: communes.postal_code — not a postal code (a statistics code with the 1984 wilaya), and the one thing that read it sent it to Meta as the shopper's postal code
-- data-safety: carrier_communes — a cache of carrier spellings rebuilt from the carrier's list as carrier_places
-- data-safety: carrier_wilayas — a cache of carrier spellings rebuilt from the carrier's list as carrier_places

-- 1. The 11 wilayas of law 26-06.
INSERT INTO wilayas (id, name, name_ar) VALUES (59, 'Aflou', 'أفلو');
INSERT INTO wilayas (id, name, name_ar) VALUES (60, 'Barika', 'بريكة');
INSERT INTO wilayas (id, name, name_ar) VALUES (61, 'El Kantara', 'القنطرة');
INSERT INTO wilayas (id, name, name_ar) VALUES (62, 'Bir El Ater', 'بئر العاتر');
INSERT INTO wilayas (id, name, name_ar) VALUES (63, 'El Aricha', 'العريشة');
INSERT INTO wilayas (id, name, name_ar) VALUES (64, 'Ksar Chellala', 'قصر الشلالة');
INSERT INTO wilayas (id, name, name_ar) VALUES (65, 'Aïn Oussera', 'عين وسارة');
INSERT INTO wilayas (id, name, name_ar) VALUES (66, 'Messaad', 'مسعد');
INSERT INTO wilayas (id, name, name_ar) VALUES (67, 'Ksar El Boukhari', 'قصر البخاري');
INSERT INTO wilayas (id, name, name_ar) VALUES (68, 'Bou Saâda', 'بوسعادة');
INSERT INTO wilayas (id, name, name_ar) VALUES (69, 'El Abiodh Sidi Cheikh', 'الأبيض سيدي الشيخ');

-- 2. Each commune's wilaya, name and Arabic name.
UPDATE communes SET name_ar = 'اقبلي' WHERE id = 'c-01-019';
UPDATE communes SET name = 'Fenoghil' WHERE id = 'c-01-015';
UPDATE communes SET name_ar = 'إن زغمير' WHERE id = 'c-01-005';
UPDATE communes SET name = 'Ouled Ahmed Timmi', name_ar = 'أولاد أحمد تيمي' WHERE id = 'c-01-021';
UPDATE communes SET name_ar = 'رقان' WHERE id = 'c-01-004';
UPDATE communes SET name_ar = 'سالي' WHERE id = 'c-01-018';
UPDATE communes SET name = 'Sebaa' WHERE id = 'c-01-026';
UPDATE communes SET name = 'Tamantit', name_ar = 'تامنطيط' WHERE id = 'c-01-014';
UPDATE communes SET name_ar = 'تامست' WHERE id = 'c-01-002';
UPDATE communes SET name = 'Timekten' WHERE id = 'c-01-013';
UPDATE communes SET name_ar = 'تيت' WHERE id = 'c-01-006';
UPDATE communes SET name_ar = 'بوقادير' WHERE id = 'c-02-012';
UPDATE communes SET name = 'Bouzeghaia' WHERE id = 'c-02-031';
UPDATE communes SET name_ar = 'المرسى' WHERE id = 'c-02-023';
UPDATE communes SET name_ar = 'الهرانفة' WHERE id = 'c-02-015';
UPDATE communes SET name_ar = 'وادي الفضة' WHERE id = 'c-02-029';
UPDATE communes SET name_ar = 'وادي قوسين' WHERE id = 'c-02-016';
UPDATE communes SET name_ar = 'وادي سلي' WHERE id = 'c-02-021';
UPDATE communes SET name_ar = 'أم الدروع' WHERE id = 'c-02-033';
UPDATE communes SET name_ar = 'سيدي عبد الرحمن' WHERE id = 'c-02-025';
UPDATE communes SET name = 'Sidi Akkacha' WHERE id = 'c-02-011';
UPDATE communes SET name_ar = 'الصبحة' WHERE id = 'c-02-008';
UPDATE communes SET name = 'Tadjena' WHERE id = 'c-02-005';
UPDATE communes SET name = 'Aïn Madhi', name_ar = 'عين ماضي' WHERE id = 'c-03-007';
UPDATE communes SET name = 'Benacer Benchohra' WHERE id = 'c-03-003';
UPDATE communes SET name = 'El Haouita', name_ar = 'الحويطة' WHERE id = 'c-03-023';
UPDATE communes SET name_ar = 'حاسي الدلاعة' WHERE id = 'c-03-005';
UPDATE communes SET name = 'Kheneg' WHERE id = 'c-03-009';
UPDATE communes SET name = 'Tadjemout' WHERE id = 'c-03-008';
UPDATE communes SET name_ar = 'عين ببوش' WHERE id = 'c-04-008';
UPDATE communes SET name_ar = 'بحير الشرقي' WHERE id = 'c-04-004';
UPDATE communes SET name = 'Dhalaa' WHERE id = 'c-04-011';
UPDATE communes SET name_ar = 'الجازية' WHERE id = 'c-04-014';
UPDATE communes SET name_ar = 'الفجوج بوغرارة سعودي' WHERE id = 'c-04-019';
UPDATE communes SET name_ar = 'فكيرينة' WHERE id = 'c-04-016';
UPDATE communes SET name_ar = 'قصر الصباحي' WHERE id = 'c-04-022';
UPDATE communes SET name_ar = 'أولاد قاسم' WHERE id = 'c-04-028';
UPDATE communes SET name_ar = 'الرحية' WHERE id = 'c-04-026';
UPDATE communes SET name_ar = 'الزرق' WHERE id = 'c-04-018';
UPDATE communes SET name = 'Aïn Touta' WHERE id = 'c-05-045';
UPDATE communes SET name_ar = 'أريس' WHERE id = 'c-05-016';
UPDATE communes SET name = 'Béni Fedhala El Hakania', name_ar = 'بني فضالة الحقانية' WHERE id = 'c-05-032';
UPDATE communes SET name_ar = 'بومقر' WHERE id = 'c-05-041';
UPDATE communes SET name = 'Elmadher' WHERE id = 'c-05-007';
UPDATE communes SET name_ar = 'القيقبة' WHERE id = 'c-05-010';
UPDATE communes SET name_ar = 'إشمول' WHERE id = 'c-05-030';
UPDATE communes SET name = 'Inoughissene' WHERE id = 'c-05-011';
UPDATE communes SET name_ar = 'قصر بلزمة' WHERE id = 'c-05-028';
UPDATE communes SET name_ar = 'لارباع' WHERE id = 'c-05-061';
UPDATE communes SET name = 'N''Gaous', name_ar = 'نقاوس' WHERE id = 'c-05-009';
UPDATE communes SET name_ar = 'وادي الشعبة' WHERE id = 'c-05-037';
UPDATE communes SET name_ar = 'وادي الماء' WHERE id = 'c-05-033';
UPDATE communes SET name = 'Ouled Sellem' WHERE id = 'c-05-020';
UPDATE communes SET name = 'Ras El Aïoun' WHERE id = 'c-05-051';
UPDATE communes SET name_ar = 'ثنية العابد' WHERE id = 'c-05-047';
UPDATE communes SET name_ar = 'تغرغار' WHERE id = 'c-05-021';
UPDATE communes SET name = 'T''Kout' WHERE id = 'c-05-044';
UPDATE communes SET name = 'Zana El Beïda' WHERE id = 'c-05-054';
UPDATE communes SET name_ar = 'أدكار' WHERE id = 'c-06-024';
UPDATE communes SET name_ar = 'أيت رزين' WHERE id = 'c-06-028';
UPDATE communes SET name_ar = 'أيت إسماعيل' WHERE id = 'c-06-047';
UPDATE communes SET name_ar = 'أكفادو' WHERE id = 'c-06-042';
UPDATE communes SET name_ar = 'أمالو' WHERE id = 'c-06-016';
UPDATE communes SET name_ar = 'أميزور' WHERE id = 'c-06-002';
UPDATE communes SET name = 'Beni Djellil', name_ar = 'بني جليل' WHERE id = 'c-06-023';
UPDATE communes SET name = 'Beni K''sila', name_ar = 'بني كسيلة' WHERE id = 'c-06-035';
UPDATE communes SET name_ar = 'بني مليكش' WHERE id = 'c-06-038';
UPDATE communes SET name_ar = 'بو جليل' WHERE id = 'c-06-052';
UPDATE communes SET name = 'Chellata' WHERE id = 'c-06-005';
UPDATE communes SET name = 'Fenaia Il Maten', name_ar = 'فناية الماثن' WHERE id = 'c-06-018';
UPDATE communes SET name_ar = 'إغيل علي' WHERE id = 'c-06-017';
UPDATE communes SET name_ar = 'اغرم' WHERE id = 'c-06-015';
UPDATE communes SET name_ar = 'الفلاي' WHERE id = 'c-06-043';
UPDATE communes SET name_ar = 'مالبو' WHERE id = 'c-06-041';
UPDATE communes SET name = 'Ouzellaguen' WHERE id = 'c-06-036';
UPDATE communes SET name = 'Souk El Tenine', name_ar = 'سوق لإثنين' WHERE id = 'c-06-008';
UPDATE communes SET name_ar = 'سوق اوفلا' WHERE id = 'c-06-030';
UPDATE communes SET name_ar = 'تالة حمزة' WHERE id = 'c-06-033';
UPDATE communes SET name_ar = 'تاوريرت إغيل' WHERE id = 'c-06-004';
UPDATE communes SET name_ar = 'تاسكريوت' WHERE id = 'c-06-031';
UPDATE communes SET name_ar = 'تينبدار' WHERE id = 'c-06-010';
UPDATE communes SET name = 'Tichy' WHERE id = 'c-06-011';
UPDATE communes SET name = 'Timezrit' WHERE id = 'c-06-007';
UPDATE communes SET name = 'Tizi-N''berber', name_ar = 'تيزي نبربر' WHERE id = 'c-06-049';
UPDATE communes SET name = 'Aïn Naga' WHERE id = 'c-07-014';
UPDATE communes SET name = 'El Feïdh' WHERE id = 'c-07-016';
UPDATE communes SET name = 'El Hadjeb' WHERE id = 'c-07-032';
UPDATE communes SET name = 'Khangat Sidi Nadji', name_ar = 'خنقة سيدي ناجي' WHERE id = 'c-07-033';
UPDATE communes SET name_ar = 'ليشانة' WHERE id = 'c-07-023';
UPDATE communes SET name_ar = 'ليوة' WHERE id = 'c-07-022';
UPDATE communes SET name = 'M''Chounèche' WHERE id = 'c-07-012';
UPDATE communes SET name = 'Meziraa', name_ar = 'المزيرعة' WHERE id = 'c-07-028';
UPDATE communes SET name = 'M''Lili' WHERE id = 'c-07-025';
UPDATE communes SET name = 'Béchar' WHERE id = 'c-08-001';
UPDATE communes SET name = 'Béni Ounif' WHERE id = 'c-08-021';
UPDATE communes SET name = 'Boukaïs' WHERE id = 'c-08-015';
UPDATE communes SET name = 'Kenadsa' WHERE id = 'c-08-010';
UPDATE communes SET name = 'Mechraa Houari Boumediène', name_ar = 'مشرع هواري بومدين' WHERE id = 'c-08-009';
UPDATE communes SET name_ar = 'المريجة' WHERE id = 'c-08-004';
UPDATE communes SET name_ar = 'تاغيت' WHERE id = 'c-08-013';
UPDATE communes SET name = 'Benkhelil', name_ar = 'بن خليل' WHERE id = 'c-09-010';
UPDATE communes SET name_ar = 'البليدة' WHERE id = 'c-09-001';
UPDATE communes SET name_ar = 'بوقرة' WHERE id = 'c-09-022';
UPDATE communes SET name_ar = 'قرواو' WHERE id = 'c-09-023';
UPDATE communes SET name_ar = 'الأربعاء' WHERE id = 'c-09-017';
UPDATE communes SET name_ar = 'وادي جر' WHERE id = 'c-09-018';
UPDATE communes SET name_ar = 'وادي العلايق' WHERE id = 'c-09-004';
UPDATE communes SET name = 'Ouled Slama', name_ar = 'اولاد سلامة' WHERE id = 'c-09-015';
UPDATE communes SET name_ar = 'أولاد يعيش' WHERE id = 'c-09-005';
UPDATE communes SET name_ar = 'الصومعة' WHERE id = 'c-09-011';
UPDATE communes SET name_ar = 'أهل القصر' WHERE id = 'c-10-022';
UPDATE communes SET name = 'Ain-Bessem' WHERE id = 'c-10-035';
UPDATE communes SET name_ar = 'أيت لعزيز' WHERE id = 'c-10-008';
UPDATE communes SET name = 'Bordj Okhriss' WHERE id = 'c-10-018';
UPDATE communes SET name_ar = 'بوكرم' WHERE id = 'c-10-034';
UPDATE communes SET name_ar = 'شرفة' WHERE id = 'c-10-017';
UPDATE communes SET name_ar = 'ديرة' WHERE id = 'c-10-007';
UPDATE communes SET name_ar = 'جباحية' WHERE id = 'c-10-026';
UPDATE communes SET name_ar = 'الأسنام' WHERE id = 'c-10-002';
UPDATE communes SET name_ar = 'الهاشمية' WHERE id = 'c-10-015';
UPDATE communes SET name = 'El Khabouzia' WHERE id = 'c-10-021';
UPDATE communes SET name_ar = 'حنيف' WHERE id = 'c-10-006';
UPDATE communes SET name_ar = 'معلة' WHERE id = 'c-10-014';
UPDATE communes SET name = 'M Chedallah', name_ar = 'أمشدالة' WHERE id = 'c-10-037';
UPDATE communes SET name_ar = 'مزدور' WHERE id = 'c-10-011';
UPDATE communes SET name_ar = 'وادي البردي' WHERE id = 'c-10-045';
UPDATE communes SET name_ar = 'روراوة' WHERE id = 'c-10-010';
UPDATE communes SET name_ar = 'سحاريج' WHERE id = 'c-10-030';
UPDATE communes SET name_ar = 'تاقديت' WHERE id = 'c-10-028';
UPDATE communes SET name_ar = 'ابلسة' WHERE id = 'c-11-002';
UPDATE communes SET name = 'Idlès', name_ar = 'أدلس' WHERE id = 'c-11-005';
UPDATE communes SET name_ar = 'عين امقل' WHERE id = 'c-11-009';
UPDATE communes SET name = 'Tamenghasset' WHERE id = 'c-11-001';
UPDATE communes SET name = 'Tazrouk' WHERE id = 'c-11-006';
UPDATE communes SET name = 'Bir Dheheb', name_ar = 'بئر الذهب' WHERE id = 'c-12-014';
UPDATE communes SET name = 'Bir Mokkadem', name_ar = 'بئر مقدم' WHERE id = 'c-12-010';
UPDATE communes SET name_ar = 'الشريعة' WHERE id = 'c-12-003';
UPDATE communes SET name = 'El Ma Labiod', name_ar = 'الماء الابيض' WHERE id = 'c-12-020';
UPDATE communes SET name = 'El Mezeraa' WHERE id = 'c-12-027';
UPDATE communes SET name = 'Gourrigueur', name_ar = 'قريقر' WHERE id = 'c-12-016';
UPDATE communes SET name_ar = 'أم علي' WHERE id = 'c-12-021';
UPDATE communes SET name_ar = 'صفصاف الوسرى' WHERE id = 'c-12-007';
UPDATE communes SET name = 'Tébessa' WHERE id = 'c-12-001';
UPDATE communes SET name = 'Thlidjene' WHERE id = 'c-12-022';
UPDATE communes SET name = 'Aïn Fetah' WHERE id = 'c-13-031';
UPDATE communes SET name_ar = 'عين فزة' WHERE id = 'c-13-012';
UPDATE communes SET name = 'Aïn Ghoraba' WHERE id = 'c-13-049';
UPDATE communes SET name_ar = 'عين النحالة' WHERE id = 'c-13-025';
UPDATE communes SET name = 'Aïn Tallout' WHERE id = 'c-13-003';
UPDATE communes SET name = 'Azaïls' WHERE id = 'c-13-021';
UPDATE communes SET name = 'Béni Bahdel' WHERE id = 'c-13-042';
UPDATE communes SET name = 'Béni Boussaïd' WHERE id = 'c-13-038';
UPDATE communes SET name = 'Béni Khellad', name_ar = 'بني خلاد' WHERE id = 'c-13-048';
UPDATE communes SET name = 'Béni Mester', name_ar = 'بني مستر' WHERE id = 'c-13-002';
UPDATE communes SET name = 'Béni Ouarsous', name_ar = 'بني وارسوس' WHERE id = 'c-13-036';
UPDATE communes SET name = 'Béni Semiel', name_ar = 'بني صميل' WHERE id = 'c-13-052';
UPDATE communes SET name = 'Béni Snous', name_ar = 'بني سنوس' WHERE id = 'c-13-017';
UPDATE communes SET name = 'Dar Yaghmouracène' WHERE id = 'c-13-019';
UPDATE communes SET name = 'Fellaoucène' WHERE id = 'c-13-020';
UPDATE communes SET name = 'Honaïne' WHERE id = 'c-13-044';
UPDATE communes SET name_ar = 'منصورة' WHERE id = 'c-13-051';
UPDATE communes SET name = 'Marsa Ben M''Hidi', name_ar = 'مرسى بن مهيدي' WHERE id = 'c-13-039';
UPDATE communes SET name = 'Nédroma' WHERE id = 'c-13-040';
UPDATE communes SET name = 'Oued Lakhdar', name_ar = 'وادي الخضر' WHERE id = 'c-13-011';
UPDATE communes SET name = 'Sebaa Chioukh' WHERE id = 'c-13-022';
UPDATE communes SET name_ar = 'السواحلية' WHERE id = 'c-13-029';
UPDATE communes SET name = 'Tirni Béni Hediel' WHERE id = 'c-13-023';
UPDATE communes SET name = 'Aïn Bouchekif', name_ar = 'عين بوشقيف' WHERE id = 'c-14-003';
UPDATE communes SET name = 'Aïn Deheb' WHERE id = 'c-14-006';
UPDATE communes SET name = 'Aïn Dzarit', name_ar = 'عين دزاريت' WHERE id = 'c-14-005';
UPDATE communes SET name = 'Aïn El Hadid' WHERE id = 'c-14-018';
UPDATE communes SET name = 'Aïn Kermes' WHERE id = 'c-14-028';
UPDATE communes SET name = 'Chehaïma' WHERE id = 'c-14-036';
UPDATE communes SET name = 'Djebilet Rosfa', name_ar = 'جبيلات الرصفاء' WHERE id = 'c-14-019';
UPDATE communes SET name = 'Djileli Ben Amar' WHERE id = 'c-14-024';
UPDATE communes SET name = 'Faïdja' WHERE id = 'c-14-041';
UPDATE communes SET name_ar = 'مهدية' WHERE id = 'c-14-015';
UPDATE communes SET name = 'Mechraa Sfa', name_ar = 'مشرع الصفا' WHERE id = 'c-14-034';
UPDATE communes SET name = 'Médrissa' WHERE id = 'c-14-008';
UPDATE communes SET name_ar = 'الناظورة' WHERE id = 'c-14-031';
UPDATE communes SET name = 'Naïma', name_ar = 'النعيمة' WHERE id = 'c-14-020';
UPDATE communes SET name = 'Oued Lili', name_ar = 'وادي ليلي' WHERE id = 'c-14-033';
UPDATE communes SET name_ar = 'الرحوية' WHERE id = 'c-14-014';
UPDATE communes SET name = 'Sebaïne', name_ar = 'السبعين' WHERE id = 'c-14-025';
UPDATE communes SET name_ar = 'سي عبد الغني' WHERE id = 'c-14-017';
UPDATE communes SET name_ar = 'سيدي عبد الرحمن' WHERE id = 'c-14-038';
UPDATE communes SET name_ar = 'السوقر' WHERE id = 'c-14-016';
UPDATE communes SET name_ar = 'تخمرت' WHERE id = 'c-14-037';
UPDATE communes SET name_ar = 'تيارت' WHERE id = 'c-14-001';
UPDATE communes SET name = 'Aghribs' WHERE id = 'c-15-053';
UPDATE communes SET name_ar = 'أقني قغران' WHERE id = 'c-15-061';
UPDATE communes SET name_ar = 'أيت عقواشة' WHERE id = 'c-15-035';
UPDATE communes SET name_ar = 'أيت عيسى ميمون' WHERE id = 'c-15-039';
UPDATE communes SET name = 'Ait Bouaddou', name_ar = 'أيت بوادو' WHERE id = 'c-15-065';
UPDATE communes SET name = 'Ait Boumahdi', name_ar = 'أيت بومهدي' WHERE id = 'c-15-030';
UPDATE communes SET name_ar = 'أيت شافع' WHERE id = 'c-15-013';
UPDATE communes SET name = 'Ait Khellili' WHERE id = 'c-15-058';
UPDATE communes SET name_ar = 'أيت أومالو' WHERE id = 'c-15-042';
UPDATE communes SET name_ar = 'أيت يحيى' WHERE id = 'c-15-027';
UPDATE communes SET name_ar = 'اقبيل' WHERE id = 'c-15-003';
UPDATE communes SET name = 'Azeffoun' WHERE id = 'c-15-037';
UPDATE communes SET name_ar = 'بني زيكي' WHERE id = 'c-15-046';
UPDATE communes SET name_ar = 'بني زمنزار' WHERE id = 'c-15-016';
UPDATE communes SET name_ar = 'إبودرارن' WHERE id = 'c-15-060';
UPDATE communes SET name_ar = 'إيجار' WHERE id = 'c-15-049';
UPDATE communes SET name_ar = 'إفرحونان' WHERE id = 'c-15-017';
UPDATE communes SET name_ar = 'إيفيغاء' WHERE id = 'c-15-041';
UPDATE communes SET name_ar = 'إيليلتن' WHERE id = 'c-15-033';
UPDATE communes SET name = 'Illoula Oumalou', name_ar = 'إيلولة أومالو' WHERE id = 'c-15-019';
UPDATE communes SET name_ar = 'إيرجن' WHERE id = 'c-15-007';
UPDATE communes SET name = 'Larbaa Nath Irathen', name_ar = 'الأربعاء ناث إيراثن' WHERE id = 'c-15-021';
UPDATE communes SET name = 'Maatkas', name_ar = 'معاتقة' WHERE id = 'c-15-029';
UPDATE communes SET name = 'Mechtras' WHERE id = 'c-15-006';
UPDATE communes SET name_ar = 'ميزرانة' WHERE id = 'c-15-062';
UPDATE communes SET name = 'M''kira' WHERE id = 'c-15-026';
UPDATE communes SET name = 'Sidi Namane' WHERE id = 'c-15-059';
UPDATE communes SET name_ar = 'تيقزيرت' WHERE id = 'c-15-038';
UPDATE communes SET name_ar = 'تيميزار' WHERE id = 'c-15-008';
UPDATE communes SET name_ar = 'تيرمتين' WHERE id = 'c-15-043';
UPDATE communes SET name = 'Tizi N''tleta' WHERE id = 'c-15-051';
UPDATE communes SET name_ar = 'إعكورن' WHERE id = 'c-15-020';
UPDATE communes SET name_ar = 'باب الوادي' WHERE id = 'c-16-005';
UPDATE communes SET name = 'Bab Ezzouar' WHERE id = 'c-16-021';
UPDATE communes SET name_ar = 'محمد بلوزداد' WHERE id = 'c-16-004';
UPDATE communes SET name_ar = 'ابن عكنون' WHERE id = 'c-16-022';
UPDATE communes SET name_ar = 'بئر مراد رايس' WHERE id = 'c-16-009';
UPDATE communes SET name_ar = 'بولوغين بن زيري' WHERE id = 'c-16-006';
UPDATE communes SET name_ar = 'الشراقة' WHERE id = 'c-16-050';
UPDATE communes SET name_ar = 'الدويرة' WHERE id = 'c-16-054';
UPDATE communes SET name_ar = 'الدرارية' WHERE id = 'c-16-053';
UPDATE communes SET name_ar = 'الابيار' WHERE id = 'c-16-010';
UPDATE communes SET name_ar = 'المغارية' WHERE id = 'c-16-031';
UPDATE communes SET name = 'El Marsa' WHERE id = 'c-16-040';
UPDATE communes SET name_ar = 'الخرايسية' WHERE id = 'c-16-056';
UPDATE communes SET name_ar = 'الكاليتوس' WHERE id = 'c-16-033';
UPDATE communes SET name_ar = 'المعالمة' WHERE id = 'c-16-047';
UPDATE communes SET name_ar = 'وادي السمار' WHERE id = 'c-16-015';
UPDATE communes SET name_ar = 'اولاد شبل' WHERE id = 'c-16-036';
UPDATE communes SET name_ar = 'اولاد فايت' WHERE id = 'c-16-051';
UPDATE communes SET name_ar = 'الرحمانية' WHERE id = 'c-16-048';
UPDATE communes SET name_ar = 'رغاية' WHERE id = 'c-16-043';
UPDATE communes SET name_ar = 'الرويبة' WHERE id = 'c-16-042';
UPDATE communes SET name = 'Sidi M''hamed' WHERE id = 'c-16-002';
UPDATE communes SET name = 'Tessala El Merdja' WHERE id = 'c-16-035';
UPDATE communes SET name = 'Aïn Chouhada' WHERE id = 'c-17-023';
UPDATE communes SET name = 'Aïn El Ibel', name_ar = 'عين الإبل' WHERE id = 'c-17-030';
UPDATE communes SET name = 'Aïn Maabed' WHERE id = 'c-17-005';
UPDATE communes SET name = 'Ben Yaagoub' WHERE id = 'c-17-027';
UPDATE communes SET name = 'Dar Chioukh' WHERE id = 'c-17-025';
UPDATE communes SET name_ar = 'دويس' WHERE id = 'c-17-015';
UPDATE communes SET name = 'El Gueddid' WHERE id = 'c-17-003';
UPDATE communes SET name_ar = 'الادريسية' WHERE id = 'c-17-014';
UPDATE communes SET name_ar = 'مليليحة' WHERE id = 'c-17-013';
UPDATE communes SET name = 'Moudjbara', name_ar = 'مجبارة' WHERE id = 'c-17-002';
UPDATE communes SET name = 'Sidi Baïzid' WHERE id = 'c-17-012';
UPDATE communes SET name_ar = 'تعظميت' WHERE id = 'c-17-036';
UPDATE communes SET name_ar = 'زعفران' WHERE id = 'c-17-028';
UPDATE communes SET name = 'Bordj T''har' WHERE id = 'c-18-026';
UPDATE communes SET name_ar = 'بودريعة بني ياجيس' WHERE id = 'c-18-022';
UPDATE communes SET name_ar = 'بوسيف أولاد عسكر' WHERE id = 'c-18-019';
UPDATE communes SET name = 'Djimla' WHERE id = 'c-18-017';
UPDATE communes SET name_ar = 'القنار نشفي' WHERE id = 'c-18-020';
UPDATE communes SET name_ar = 'أراقن سويسي' WHERE id = 'c-18-002';
UPDATE communes SET name = 'Khiri Oued Adjoul', name_ar = 'خيري واد عجول' WHERE id = 'c-18-023';
UPDATE communes SET name_ar = 'أولاد رابح' WHERE id = 'c-18-027';
UPDATE communes SET name_ar = 'أولاد يحيى خدروش' WHERE id = 'c-18-021';
UPDATE communes SET name = 'Texenna' WHERE id = 'c-18-024';
UPDATE communes SET name = 'Ziama Mansouriah' WHERE id = 'c-18-004';
UPDATE communes SET name_ar = 'عين عباسة' WHERE id = 'c-19-014';
UPDATE communes SET name_ar = 'عين أرنات' WHERE id = 'c-19-026';
UPDATE communes SET name = 'Ain Azel' WHERE id = 'c-19-040';
UPDATE communes SET name_ar = 'عين الحجر' WHERE id = 'c-19-018';
UPDATE communes SET name_ar = 'عين لقراج' WHERE id = 'c-19-013';
UPDATE communes SET name = 'Ain Oulmene' WHERE id = 'c-19-028';
UPDATE communes SET name_ar = 'أيت نوال مزادة' WHERE id = 'c-19-051';
UPDATE communes SET name_ar = 'ايت تيزي' WHERE id = 'c-19-054';
UPDATE communes SET name_ar = 'بازر سكرة' WHERE id = 'c-19-031';
UPDATE communes SET name_ar = 'بلاعة' WHERE id = 'c-19-025';
UPDATE communes SET name_ar = 'بني وسين' WHERE id = 'c-19-053';
UPDATE communes SET name_ar = 'بني موحلي' WHERE id = 'c-19-046';
UPDATE communes SET name_ar = 'بوقاعة' WHERE id = 'c-19-043';
UPDATE communes SET name_ar = 'جميلة' WHERE id = 'c-19-021';
UPDATE communes SET name_ar = 'الولجة' WHERE id = 'c-19-059';
UPDATE communes SET name_ar = 'أوريسيا' WHERE id = 'c-19-037';
UPDATE communes SET name_ar = 'قلتة زرقاء' WHERE id = 'c-19-056';
UPDATE communes SET name_ar = 'قنزات' WHERE id = 'c-19-041';
UPDATE communes SET name_ar = 'قجال' WHERE id = 'c-19-017';
UPDATE communes SET name = 'Hamam Soukhna', name_ar = 'حمام السخنة' WHERE id = 'c-19-032';
UPDATE communes SET name_ar = 'الحامة' WHERE id = 'c-19-011';
UPDATE communes SET name_ar = 'قصر الابطال' WHERE id = 'c-19-052';
UPDATE communes SET name_ar = 'معاوية' WHERE id = 'c-19-012';
UPDATE communes SET name_ar = 'ماوكلان' WHERE id = 'c-19-055';
UPDATE communes SET name_ar = 'أولاد صابر' WHERE id = 'c-19-047';
UPDATE communes SET name = 'Ouled Si Ahmed' WHERE id = 'c-19-004';
UPDATE communes SET name_ar = 'أولاد تبان' WHERE id = 'c-19-010';
UPDATE communes SET name_ar = 'صالح باي' WHERE id = 'c-19-039';
UPDATE communes SET name_ar = 'سطيف' WHERE id = 'c-19-001';
UPDATE communes SET name_ar = 'الطاية' WHERE id = 'c-19-058';
UPDATE communes SET name = 'Tizi N''bechar' WHERE id = 'c-19-038';
UPDATE communes SET name_ar = 'عين السخونة' WHERE id = 'c-20-013';
UPDATE communes SET name_ar = 'دوي ثابت' WHERE id = 'c-20-002';
UPDATE communes SET name_ar = 'الحساسنة' WHERE id = 'c-20-010';
UPDATE communes SET name_ar = 'المعمورة' WHERE id = 'c-20-011';
UPDATE communes SET name_ar = 'مولاي العربي' WHERE id = 'c-20-005';
UPDATE communes SET name_ar = 'أولاد إبراهيم' WHERE id = 'c-20-014';
UPDATE communes SET name_ar = 'سيدي احمد' WHERE id = 'c-20-012';
UPDATE communes SET name_ar = 'سيدي عمر' WHERE id = 'c-20-008';
UPDATE communes SET name = 'Ain Charchar' WHERE id = 'c-21-006';
UPDATE communes SET name = 'Beni Bechir' WHERE id = 'c-21-024';
UPDATE communes SET name_ar = 'بني ولبان' WHERE id = 'c-21-021';
UPDATE communes SET name_ar = 'بني زيد' WHERE id = 'c-21-011';
UPDATE communes SET name = 'Bin El Ouiden' WHERE id = 'c-21-029';
UPDATE communes SET name = 'Djendel Saadi Mohamed', name_ar = 'جندل سعدي محمد' WHERE id = 'c-21-005';
UPDATE communes SET name = 'El Hadaiek', name_ar = 'الحدائق' WHERE id = 'c-21-003';
UPDATE communes SET name_ar = 'الكركرة' WHERE id = 'c-21-012';
UPDATE communes SET name_ar = 'خناق مايو' WHERE id = 'c-21-036';
UPDATE communes SET name_ar = 'الولجة بولبلوط' WHERE id = 'c-21-035';
UPDATE communes SET name_ar = 'صالح بو الشعور' WHERE id = 'c-21-025';
UPDATE communes SET name_ar = 'عين أدن' WHERE id = 'c-22-030';
UPDATE communes SET name_ar = 'عين الثريد' WHERE id = 'c-22-015';
UPDATE communes SET name_ar = 'عين تندمين' WHERE id = 'c-22-024';
UPDATE communes SET name_ar = 'بضرابين المقراني' WHERE id = 'c-22-009';
UPDATE communes SET name_ar = 'بن باديس' WHERE id = 'c-22-045';
UPDATE communes SET name_ar = 'شيطوان البلايلة' WHERE id = 'c-22-047';
UPDATE communes SET name_ar = 'الضاية' WHERE id = 'c-22-032';
UPDATE communes SET name = 'M''cid' WHERE id = 'c-22-026';
UPDATE communes SET name = 'Oued Sebaa', name_ar = 'وادي السبع' WHERE id = 'c-22-037';
UPDATE communes SET name_ar = 'وادي سفيون' WHERE id = 'c-22-043';
UPDATE communes SET name_ar = 'وادي تاوريرة' WHERE id = 'c-22-031';
UPDATE communes SET name_ar = 'راس الماء' WHERE id = 'c-22-023';
UPDATE communes SET name_ar = 'السهالة الثورة' WHERE id = 'c-22-039';
UPDATE communes SET name = 'Sfisef' WHERE id = 'c-22-029';
UPDATE communes SET name = 'Sidi Dahou Zairs', name_ar = 'سيدي دحو الزاير' WHERE id = 'c-22-036';
UPDATE communes SET name = 'Berrahal' WHERE id = 'c-23-002';
UPDATE communes SET name_ar = 'واد العنب' WHERE id = 'c-23-006';
UPDATE communes SET name = 'Sidi Amar' WHERE id = 'c-23-011';
UPDATE communes SET name_ar = 'عين العربي' WHERE id = 'c-24-023';
UPDATE communes SET name = 'Ain Regada' WHERE id = 'c-24-032';
UPDATE communes SET name = 'Belkheir' WHERE id = 'c-24-010';
UPDATE communes SET name = 'Bordj Sabath' WHERE id = 'c-24-021';
UPDATE communes SET name_ar = 'جبالة الخميسي' WHERE id = 'c-24-034';
UPDATE communes SET name = 'Hammam Debagh', name_ar = 'حمام دباغ' WHERE id = 'c-24-019';
UPDATE communes SET name = 'Hammam N''bail' WHERE id = 'c-24-022';
UPDATE communes SET name_ar = 'هيليوبوليس' WHERE id = 'c-24-026';
UPDATE communes SET name = 'Houari Boumedienne' WHERE id = 'c-24-027';
UPDATE communes SET name_ar = 'لخزارة' WHERE id = 'c-24-015';
UPDATE communes SET name_ar = 'رأس العقبة' WHERE id = 'c-24-008';
UPDATE communes SET name = 'Sellaoua Announa' WHERE id = 'c-24-029';
UPDATE communes SET name_ar = 'عين السمارة' WHERE id = 'c-25-010';
UPDATE communes SET name = 'Ben Badis', name_ar = 'أبن باديس الهرية' WHERE id = 'c-25-003';
UPDATE communes SET name_ar = 'بوجريو مسعود' WHERE id = 'c-25-011';
UPDATE communes SET name = 'Aïssaouia' WHERE id = 'c-26-005';
UPDATE communes SET name = 'Al Azizia' WHERE id = 'c-26-036';
UPDATE communes SET name = 'Béni Slimane' WHERE id = 'c-26-046';
UPDATE communes SET name_ar = 'البرواقية' WHERE id = 'c-26-047';
UPDATE communes SET name = 'Bir Ben Abed', name_ar = 'بئر بن عابد' WHERE id = 'c-26-056';
UPDATE communes SET name = 'Bouaïchoune' WHERE id = 'c-26-059';
UPDATE communes SET name = 'Bouskène' WHERE id = 'c-26-019';
UPDATE communes SET name_ar = 'الحوضان' WHERE id = 'c-26-053';
UPDATE communes SET name = 'Eddouair', name_ar = 'ثلاث دوائر' WHERE id = 'c-26-045';
UPDATE communes SET name = 'El Guelb El Kebir' WHERE id = 'c-26-009';
UPDATE communes SET name = 'Khamsa Djoumaa' WHERE id = 'c-26-063';
UPDATE communes SET name = 'Médéa' WHERE id = 'c-26-001';
UPDATE communes SET name = 'Mezghenna' WHERE id = 'c-26-011';
UPDATE communes SET name = 'Ouled Deïde' WHERE id = 'c-26-006';
UPDATE communes SET name = 'Rebaïa' WHERE id = 'c-26-020';
UPDATE communes SET name = 'Sedraïa' WHERE id = 'c-26-061';
UPDATE communes SET name = 'Sidi Errabie' WHERE id = 'c-26-055';
UPDATE communes SET name_ar = 'سي المحجوب' WHERE id = 'c-26-044';
UPDATE communes SET name_ar = 'السواقي' WHERE id = 'c-26-033';
UPDATE communes SET name = 'Tamezguida', name_ar = 'تمسقيدة' WHERE id = 'c-26-015';
UPDATE communes SET name_ar = 'تيزي مهدي' WHERE id = 'c-26-013';
UPDATE communes SET name_ar = 'بن عبد المالك رمضان' WHERE id = 'c-27-013';
UPDATE communes SET name_ar = 'عين سيدي الشريف' WHERE id = 'c-27-021';
UPDATE communes SET name = 'Ain-Tedles' WHERE id = 'c-27-007';
UPDATE communes SET name_ar = 'فرناقة' WHERE id = 'c-27-003';
UPDATE communes SET name = 'Hassi Mameche', name_ar = 'حاسي ماماش' WHERE id = 'c-27-006';
UPDATE communes SET name_ar = 'خضرة' WHERE id = 'c-27-018';
UPDATE communes SET name = 'Mazagran' WHERE id = 'c-27-027';
UPDATE communes SET name_ar = 'نكمارية' WHERE id = 'c-27-015';
UPDATE communes SET name_ar = 'وادي الخير' WHERE id = 'c-27-009';
UPDATE communes SET name_ar = 'أولاد بوغالم' WHERE id = 'c-27-025';
UPDATE communes SET name_ar = 'أولاد مع الله' WHERE id = 'c-27-026';
UPDATE communes SET name = 'Sidi Belaattar', name_ar = 'سيدي بلعطار' WHERE id = 'c-27-010';
UPDATE communes SET name_ar = 'السوافلية' WHERE id = 'c-27-024';
UPDATE communes SET name_ar = 'سور' WHERE id = 'c-27-008';
UPDATE communes SET name_ar = 'الطواهرية' WHERE id = 'c-27-031';
UPDATE communes SET name = 'Aïn El Hadjel' WHERE id = 'c-28-017';
UPDATE communes SET name = 'Aïn Khadra' WHERE id = 'c-28-013';
UPDATE communes SET name = 'Belaïba' WHERE id = 'c-28-015';
UPDATE communes SET name = 'Béni Ilmane', name_ar = 'بني يلمان' WHERE id = 'c-28-045';
UPDATE communes SET name_ar = 'دهاهنة' WHERE id = 'c-28-030';
UPDATE communes SET name_ar = 'حمام الضلعة' WHERE id = 'c-28-003';
UPDATE communes SET name = 'Khetouti Sed El Djir' WHERE id = 'c-28-032';
UPDATE communes SET name_ar = 'معاريف' WHERE id = 'c-28-029';
UPDATE communes SET name = 'M''Sila' WHERE id = 'c-28-001';
UPDATE communes SET name = 'M''Tarfa', name_ar = 'المطارفة' WHERE id = 'c-28-006';
UPDATE communes SET name_ar = 'أولاد عدي لقبالة' WHERE id = 'c-28-014';
UPDATE communes SET name_ar = 'أولاد ماضي' WHERE id = 'c-28-010';
UPDATE communes SET name = 'Sidi Aïssa' WHERE id = 'c-28-016';
UPDATE communes SET name_ar = 'سيدي هجرس' WHERE id = 'c-28-018';
UPDATE communes SET name_ar = 'السوامع' WHERE id = 'c-28-040';
UPDATE communes SET name_ar = 'عين أفرص' WHERE id = 'c-29-025';
UPDATE communes SET name_ar = 'الشرفاء' WHERE id = 'c-29-043';
UPDATE communes SET name = 'El Gueitena', name_ar = 'القطنة' WHERE id = 'c-29-038';
UPDATE communes SET name_ar = 'الحشم' WHERE id = 'c-29-007';
UPDATE communes SET name_ar = 'القرط' WHERE id = 'c-29-040';
UPDATE communes SET name_ar = 'المأمونية' WHERE id = 'c-29-039';
UPDATE communes SET name_ar = 'المنور' WHERE id = 'c-29-021';
UPDATE communes SET name_ar = 'فراقيق' WHERE id = 'c-29-033';
UPDATE communes SET name = 'Guerdjoum', name_ar = 'قرجوم' WHERE id = 'c-29-042';
UPDATE communes SET name_ar = 'معسكر' WHERE id = 'c-29-001';
UPDATE communes SET name_ar = 'المطمور' WHERE id = 'c-29-014';
UPDATE communes SET name_ar = 'نسمط' WHERE id = 'c-29-045';
UPDATE communes SET name_ar = 'وادي الأبطال' WHERE id = 'c-29-010';
UPDATE communes SET name_ar = 'وادي التاغية' WHERE id = 'c-29-022';
UPDATE communes SET name_ar = 'رأس عين عميروش' WHERE id = 'c-29-044';
UPDATE communes SET name_ar = 'السهايلية' WHERE id = 'c-29-047';
UPDATE communes SET name_ar = 'سيق' WHERE id = 'c-29-026';
UPDATE communes SET name = 'Tighennif' WHERE id = 'c-29-006';
UPDATE communes SET name_ar = 'زهانة' WHERE id = 'c-29-030';
UPDATE communes SET name_ar = 'زلامطة' WHERE id = 'c-29-009';
UPDATE communes SET name = 'Aïn Beïda' WHERE id = 'c-30-002';
UPDATE communes SET name = 'Hassi Ben Abdelah', name_ar = 'حاسي بن عبد الله' WHERE id = 'c-30-012';
UPDATE communes SET name = 'N''Goussa', name_ar = 'انقوسة' WHERE id = 'c-30-003';
UPDATE communes SET name_ar = 'ورقلة' WHERE id = 'c-30-001';
UPDATE communes SET name_ar = 'عين الترك' WHERE id = 'c-31-009';
UPDATE communes SET name_ar = 'بطيوة' WHERE id = 'c-31-007';
UPDATE communes SET name_ar = 'بوفاتيس' WHERE id = 'c-31-014';
UPDATE communes SET name_ar = 'البراية' WHERE id = 'c-31-018';
UPDATE communes SET name = 'El Kerma' WHERE id = 'c-31-017';
UPDATE communes SET name_ar = 'قديل' WHERE id = 'c-31-002';
UPDATE communes SET name_ar = 'حاسي بونيف' WHERE id = 'c-31-004';
UPDATE communes SET name_ar = 'مرسى الحجاج' WHERE id = 'c-31-008';
UPDATE communes SET name_ar = 'وادي تليلات' WHERE id = 'c-31-011';
UPDATE communes SET name = 'Sidi Ben Yebka' WHERE id = 'c-31-022';
UPDATE communes SET name = 'Bougtob' WHERE id = 'c-32-010';
UPDATE communes SET name = 'Brézina' WHERE id = 'c-32-004';
UPDATE communes SET name_ar = 'البيض' WHERE id = 'c-32-001';
UPDATE communes SET name = 'El Kheïther' WHERE id = 'c-32-011';
UPDATE communes SET name_ar = 'الغاسول' WHERE id = 'c-32-005';
UPDATE communes SET name_ar = 'الكاف الأحمر' WHERE id = 'c-32-012';
UPDATE communes SET name_ar = 'رقاصة' WHERE id = 'c-32-002';
UPDATE communes SET name = 'Sidi Amar' WHERE id = 'c-32-018';
UPDATE communes SET name_ar = 'ستيتن' WHERE id = 'c-32-003';
UPDATE communes SET name_ar = 'برج عمر إدريس' WHERE id = 'c-33-004';
UPDATE communes SET name_ar = 'إيليزي' WHERE id = 'c-33-001';
UPDATE communes SET name_ar = 'إن أمناس' WHERE id = 'c-33-006';
UPDATE communes SET name_ar = 'بئر قاصد علي' WHERE id = 'c-34-031';
UPDATE communes SET name_ar = 'برج بوعريرج' WHERE id = 'c-34-001';
UPDATE communes SET name = 'Bordj Ghedir', name_ar = 'برج الغدير' WHERE id = 'c-34-009';
UPDATE communes SET name_ar = 'الياشير' WHERE id = 'c-34-007';
UPDATE communes SET name_ar = 'الماين' WHERE id = 'c-34-016';
UPDATE communes SET name = 'El M''hir', name_ar = 'المهير' WHERE id = 'c-34-005';
UPDATE communes SET name_ar = 'حرازة' WHERE id = 'c-34-034';
UPDATE communes SET name_ar = 'المنصورة' WHERE id = 'c-34-004';
UPDATE communes SET name_ar = 'أولاد أبراهم' WHERE id = 'c-34-017';
UPDATE communes SET name_ar = 'أولاد سيدي ابراهيم' WHERE id = 'c-34-023';
UPDATE communes SET name_ar = 'سيدي أمبارك' WHERE id = 'c-34-010';
UPDATE communes SET name_ar = 'تقلعيت' WHERE id = 'c-34-021';
UPDATE communes SET name = 'Tefreg', name_ar = 'تفرق' WHERE id = 'c-34-024';
UPDATE communes SET name_ar = 'تسامرت' WHERE id = 'c-34-029';
UPDATE communes SET name_ar = 'تيكستار' WHERE id = 'c-34-026';
UPDATE communes SET name_ar = 'أعفير' WHERE id = 'c-35-003';
UPDATE communes SET name_ar = 'بني عمران' WHERE id = 'c-35-025';
UPDATE communes SET name_ar = 'بودواو البحري' WHERE id = 'c-35-027';
UPDATE communes SET name_ar = 'حمادي' WHERE id = 'c-35-030';
UPDATE communes SET name_ar = 'الاربعطاش' WHERE id = 'c-35-018';
UPDATE communes SET name = 'Leghata' WHERE id = 'c-35-029';
UPDATE communes SET name_ar = 'أولاد هداج' WHERE id = 'c-35-028';
UPDATE communes SET name_ar = 'تاورقة' WHERE id = 'c-35-020';
UPDATE communes SET name_ar = 'تيمزريت' WHERE id = 'c-35-015';
UPDATE communes SET name = 'Ben M Hidi', name_ar = 'بن مهيدي' WHERE id = 'c-36-003';
UPDATE communes SET name_ar = 'بريحان' WHERE id = 'c-36-010';
UPDATE communes SET name_ar = 'شحاني' WHERE id = 'c-36-014';
UPDATE communes SET name_ar = 'حمام بني صالح' WHERE id = 'c-36-023';
UPDATE communes SET name_ar = 'وادي الزيتون' WHERE id = 'c-36-022';
UPDATE communes SET name_ar = 'رمل السوق' WHERE id = 'c-36-024';
UPDATE communes SET name_ar = 'عماري' WHERE id = 'c-38-013';
UPDATE communes SET name_ar = 'بني شعيب' WHERE id = 'c-38-005';
UPDATE communes SET name_ar = 'بني لحسن' WHERE id = 'c-38-022';
UPDATE communes SET name_ar = 'برج الأمير عبد القادر' WHERE id = 'c-38-009';
UPDATE communes SET name_ar = 'بوقائد' WHERE id = 'c-38-021';
UPDATE communes SET name_ar = 'خميستي' WHERE id = 'c-38-011';
UPDATE communes SET name_ar = 'الأربعاء' WHERE id = 'c-38-016';
UPDATE communes SET name_ar = 'لرجام' WHERE id = 'c-38-006';
UPDATE communes SET name_ar = 'الأزهرية' WHERE id = 'c-38-004';
UPDATE communes SET name = 'Maacem' WHERE id = 'c-38-017';
UPDATE communes SET name_ar = 'الملعب' WHERE id = 'c-38-007';
UPDATE communes SET name_ar = 'سيدي العنتري' WHERE id = 'c-38-008';
UPDATE communes SET name_ar = 'تملاحت' WHERE id = 'c-38-019';
UPDATE communes SET name_ar = 'تيسمسيلت' WHERE id = 'c-38-001';
UPDATE communes SET name_ar = 'بن قشة' WHERE id = 'c-39-019';
UPDATE communes SET name_ar = 'قمار' WHERE id = 'c-39-006';
UPDATE communes SET name_ar = 'حساني عبد الكريم' WHERE id = 'c-39-012';
UPDATE communes SET name_ar = 'حاسي خليفة' WHERE id = 'c-39-013';
UPDATE communes SET name_ar = 'المقرن' WHERE id = 'c-39-018';
UPDATE communes SET name_ar = 'اميه وانسة' WHERE id = 'c-39-026';
UPDATE communes SET name_ar = 'وادي العلندة' WHERE id = 'c-39-003';
UPDATE communes SET name_ar = 'ورماس' WHERE id = 'c-39-020';
UPDATE communes SET name_ar = 'الرقيبة' WHERE id = 'c-39-008';
UPDATE communes SET name_ar = 'الرباح' WHERE id = 'c-39-002';
UPDATE communes SET name_ar = 'الطالب العربي' WHERE id = 'c-39-014';
UPDATE communes SET name_ar = 'الطريفاوي' WHERE id = 'c-39-017';
UPDATE communes SET name = 'Chechar' WHERE id = 'c-40-011';
UPDATE communes SET name = 'M''sara', name_ar = 'مصارة' WHERE id = 'c-40-018';
UPDATE communes SET name = 'M''toussa' WHERE id = 'c-40-002';
UPDATE communes SET name_ar = 'طامزة' WHERE id = 'c-40-014';
UPDATE communes SET name_ar = 'عين سلطان' WHERE id = 'c-41-018';
UPDATE communes SET name_ar = 'الخضارة' WHERE id = 'c-41-011';
UPDATE communes SET name = 'M''daourouche' WHERE id = 'c-41-015';
UPDATE communes SET name_ar = 'وادي الكبريت' WHERE id = 'c-41-024';
UPDATE communes SET name = 'Ouillen' WHERE id = 'c-41-019';
UPDATE communes SET name_ar = 'أولاد إدريس' WHERE id = 'c-41-005';
UPDATE communes SET name_ar = 'أولاد مومن' WHERE id = 'c-41-013';
UPDATE communes SET name_ar = 'أم العظايم' WHERE id = 'c-41-016';
UPDATE communes SET name_ar = 'الراقوبة' WHERE id = 'c-41-022';
UPDATE communes SET name_ar = 'الزوابي' WHERE id = 'c-41-026';
UPDATE communes SET name = 'Aghbal', name_ar = 'أغبال' WHERE id = 'c-42-007';
UPDATE communes SET name_ar = 'عين تاقورايت' WHERE id = 'c-42-013';
UPDATE communes SET name_ar = 'بواسماعيل' WHERE id = 'c-42-018';
UPDATE communes SET name = 'Cherchell' WHERE id = 'c-42-014';
UPDATE communes SET name_ar = 'قوراية' WHERE id = 'c-42-010';
UPDATE communes SET name = 'Merad' WHERE id = 'c-42-016';
UPDATE communes SET name = 'Nador' WHERE id = 'c-42-011';
UPDATE communes SET name_ar = 'سيدي عامر' WHERE id = 'c-42-009';
UPDATE communes SET name_ar = 'عين البيضاء أحريش' WHERE id = 'c-43-030';
UPDATE communes SET name_ar = 'عين الملوك' WHERE id = 'c-43-005';
UPDATE communes SET name = 'Amira Arres', name_ar = 'اعميرة اراس' WHERE id = 'c-43-022';
UPDATE communes SET name_ar = 'بن يحي عبد الرحمن' WHERE id = 'c-43-009';
UPDATE communes SET name_ar = 'العياضي برباس' WHERE id = 'c-43-029';
UPDATE communes SET name_ar = 'مشيرة' WHERE id = 'c-43-026';
UPDATE communes SET name_ar = 'مينار زارزة' WHERE id = 'c-43-021';
UPDATE communes SET name_ar = 'وادي النجاء' WHERE id = 'c-43-010';
UPDATE communes SET name_ar = 'وادي سقان' WHERE id = 'c-43-007';
UPDATE communes SET name_ar = 'أولاد اخلوف' WHERE id = 'c-43-012';
UPDATE communes SET name_ar = 'الرواشد' WHERE id = 'c-43-015';
UPDATE communes SET name = 'Teleghma', name_ar = 'التلاغمة' WHERE id = 'c-43-006';
UPDATE communes SET name_ar = 'ترعي باينان' WHERE id = 'c-43-023';
UPDATE communes SET name_ar = 'تسالة لمطاعي' WHERE id = 'c-43-016';
UPDATE communes SET name_ar = 'يحي بني قشة' WHERE id = 'c-43-031';
UPDATE communes SET name_ar = 'عين بويحيى' WHERE id = 'c-44-033';
UPDATE communes SET name_ar = 'عين الدفلى' WHERE id = 'c-44-001';
UPDATE communes SET name_ar = 'عين الاشياخ' WHERE id = 'c-44-014';
UPDATE communes SET name_ar = 'عين التركي' WHERE id = 'c-44-023';
UPDATE communes SET name_ar = 'بلعاص' WHERE id = 'c-44-036';
UPDATE communes SET name = 'Birbouche' WHERE id = 'c-44-028';
UPDATE communes SET name = 'Djemaa Ouled Cheikh' WHERE id = 'c-44-029';
UPDATE communes SET name_ar = 'الحسانية' WHERE id = 'c-44-018';
UPDATE communes SET name_ar = 'الحسينية' WHERE id = 'c-44-027';
UPDATE communes SET name_ar = 'وادي الشرفاء' WHERE id = 'c-44-013';
UPDATE communes SET name_ar = 'واد الجمعة' WHERE id = 'c-44-015';
UPDATE communes SET name_ar = 'الروينة' WHERE id = 'c-44-016';
UPDATE communes SET name_ar = 'سيدي الأخضر' WHERE id = 'c-44-024';
UPDATE communes SET name = 'Djenienne Bourezg' WHERE id = 'c-45-008';
UPDATE communes SET name_ar = 'القصدير' WHERE id = 'c-45-011';
UPDATE communes SET name_ar = 'مكمن بن عمار' WHERE id = 'c-45-010';
UPDATE communes SET name = 'Mecheria', name_ar = 'المشرية' WHERE id = 'c-45-002';
UPDATE communes SET name_ar = 'النعامة' WHERE id = 'c-45-001';
UPDATE communes SET name_ar = 'سفيسيفة' WHERE id = 'c-45-005';
UPDATE communes SET name_ar = 'عين الأربعاء' WHERE id = 'c-46-009';
UPDATE communes SET name_ar = 'عين تموشنت' WHERE id = 'c-46-001';
UPDATE communes SET name = 'Bouzedjar' WHERE id = 'c-46-005';
UPDATE communes SET name_ar = 'حمام بوحجر' WHERE id = 'c-46-004';
UPDATE communes SET name_ar = 'حاسي الغلة' WHERE id = 'c-46-020';
UPDATE communes SET name_ar = 'وادي برقش' WHERE id = 'c-46-006';
UPDATE communes SET name_ar = 'وادي الصباح' WHERE id = 'c-46-016';
UPDATE communes SET name_ar = 'سيدي ورياش' WHERE id = 'c-46-026';
UPDATE communes SET name_ar = 'سيدي صافي' WHERE id = 'c-46-024';
UPDATE communes SET name_ar = 'تامزورة' WHERE id = 'c-46-010';
UPDATE communes SET name = 'El Guerrera', name_ar = 'القرارة' WHERE id = 'c-47-006';
UPDATE communes SET name = 'Ghardaïa' WHERE id = 'c-47-001';
UPDATE communes SET name_ar = 'المنصورة' WHERE id = 'c-47-013';
UPDATE communes SET name_ar = 'متليلي' WHERE id = 'c-47-005';
UPDATE communes SET name_ar = 'بني زنطيس' WHERE id = 'c-48-030';
UPDATE communes SET name_ar = 'جديوية' WHERE id = 'c-48-014';
UPDATE communes SET name_ar = 'القطار' WHERE id = 'c-48-015';
UPDATE communes SET name_ar = 'الحاسي' WHERE id = 'c-48-033';
UPDATE communes SET name_ar = 'المطمر' WHERE id = 'c-48-017';
UPDATE communes SET name_ar = 'الولجة' WHERE id = 'c-48-036';
UPDATE communes SET name_ar = 'حد الشكالة' WHERE id = 'c-48-034';
UPDATE communes SET name_ar = 'حمري' WHERE id = 'c-48-016';
UPDATE communes SET name_ar = 'القلعة' WHERE id = 'c-48-023';
UPDATE communes SET name_ar = 'منداس' WHERE id = 'c-48-028';
UPDATE communes SET name_ar = 'واريزان' WHERE id = 'c-48-021';
UPDATE communes SET name_ar = 'وادي الجمعة' WHERE id = 'c-48-026';
UPDATE communes SET name_ar = 'أولاد سيدي الميهوب' WHERE id = 'c-48-038';
UPDATE communes SET name_ar = 'الرمكة' WHERE id = 'c-48-027';
UPDATE communes SET name_ar = 'غليزان' WHERE id = 'c-48-001';
UPDATE communes SET name = 'Sidi M''hamed Benali', name_ar = 'سيدي أمحمد بن علي' WHERE id = 'c-48-008';
UPDATE communes SET name = 'Sidi M''hamed Benaouda', name_ar = 'سيدي امحمد بن عودة' WHERE id = 'c-48-018';
UPDATE communes SET name = 'Souk El Had' WHERE id = 'c-48-031';
UPDATE communes SET wilaya_id = 49 WHERE id = 'c-01-023';
UPDATE communes SET wilaya_id = 49 WHERE id = 'c-01-003';
UPDATE communes SET wilaya_id = 49, name_ar = 'دلدول' WHERE id = 'c-01-017';
UPDATE communes SET wilaya_id = 49 WHERE id = 'c-01-007';
UPDATE communes SET wilaya_id = 49 WHERE id = 'c-01-020';
UPDATE communes SET wilaya_id = 49, name = 'Ouled Aïssa' WHERE id = 'c-01-027';
UPDATE communes SET wilaya_id = 49, name = 'Ouled Saïd', name_ar = 'أولاد السعيد' WHERE id = 'c-01-010';
UPDATE communes SET wilaya_id = 49, name_ar = 'طالمين' WHERE id = 'c-01-024';
UPDATE communes SET wilaya_id = 49 WHERE id = 'c-01-009';
UPDATE communes SET wilaya_id = 49, name_ar = 'تنركوك' WHERE id = 'c-01-016';
UPDATE communes SET wilaya_id = 50 WHERE id = 'c-01-025';
UPDATE communes SET wilaya_id = 50 WHERE id = 'c-01-028';
UPDATE communes SET wilaya_id = 51, name_ar = 'بسباس' WHERE id = 'c-07-007';
UPDATE communes SET wilaya_id = 51, name = 'Chaïba', name_ar = 'الشعيبة' WHERE id = 'c-07-010';
UPDATE communes SET wilaya_id = 51 WHERE id = 'c-07-009';
UPDATE communes SET wilaya_id = 51 WHERE id = 'c-07-005';
UPDATE communes SET wilaya_id = 51, name = 'Ras El Miaâd', name_ar = 'رأس الميعاد' WHERE id = 'c-07-006';
UPDATE communes SET wilaya_id = 51 WHERE id = 'c-07-008';
UPDATE communes SET wilaya_id = 52, name = 'Béni Abbès' WHERE id = 'c-08-007';
UPDATE communes SET wilaya_id = 52, name = 'Béni Ikhlef', name_ar = 'بن يخلف' WHERE id = 'c-08-008';
UPDATE communes SET wilaya_id = 52, name_ar = 'الواتة' WHERE id = 'c-08-014';
UPDATE communes SET wilaya_id = 52 WHERE id = 'c-08-011';
UPDATE communes SET wilaya_id = 52 WHERE id = 'c-08-018';
UPDATE communes SET wilaya_id = 52, name_ar = 'القصابي' WHERE id = 'c-08-019';
UPDATE communes SET wilaya_id = 52, name = 'Ouled Khodeir', name_ar = 'أولاد خضير' WHERE id = 'c-08-003';
UPDATE communes SET wilaya_id = 52, name = 'Tabelbala' WHERE id = 'c-08-012';
UPDATE communes SET wilaya_id = 52 WHERE id = 'c-08-020';
UPDATE communes SET wilaya_id = 52, name_ar = 'تيمودي' WHERE id = 'c-08-005';
UPDATE communes SET wilaya_id = 53 WHERE id = 'c-11-010';
UPDATE communes SET wilaya_id = 53, name_ar = 'إينغر' WHERE id = 'c-11-003';
UPDATE communes SET wilaya_id = 53 WHERE id = 'c-11-008';
UPDATE communes SET wilaya_id = 54 WHERE id = 'c-11-004';
UPDATE communes SET wilaya_id = 54, name = 'Tin Zaouatine', name_ar = 'تين زواتين' WHERE id = 'c-11-007';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-017';
UPDATE communes SET wilaya_id = 55, name = 'Blidat Ameur', name_ar = 'بلدة اعمر' WHERE id = 'c-30-006';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-020';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-021';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-014';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-019';
UPDATE communes SET wilaya_id = 55, name = 'M''Naguar' WHERE id = 'c-30-018';
UPDATE communes SET wilaya_id = 55, name_ar = 'النزلة' WHERE id = 'c-30-008';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-010';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-015';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-016';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-007';
UPDATE communes SET wilaya_id = 55, name_ar = 'تقرت' WHERE id = 'c-30-013';
UPDATE communes SET wilaya_id = 55 WHERE id = 'c-30-009';
UPDATE communes SET wilaya_id = 56 WHERE id = 'c-33-005';
UPDATE communes SET wilaya_id = 56 WHERE id = 'c-33-002';
UPDATE communes SET wilaya_id = 57, name = 'Djamaâ' WHERE id = 'c-39-028';
UPDATE communes SET wilaya_id = 57, name = 'El Megaier' WHERE id = 'c-39-027';
UPDATE communes SET wilaya_id = 57, name = 'M''Rara', name_ar = 'المرارة' WHERE id = 'c-39-022';
UPDATE communes SET wilaya_id = 57 WHERE id = 'c-39-029';
UPDATE communes SET wilaya_id = 57 WHERE id = 'c-39-030';
UPDATE communes SET wilaya_id = 57, name = 'Sidi Khelil' WHERE id = 'c-39-023';
UPDATE communes SET wilaya_id = 57 WHERE id = 'c-39-021';
UPDATE communes SET wilaya_id = 57 WHERE id = 'c-39-024';
UPDATE communes SET wilaya_id = 58, name = 'El Meniaâ' WHERE id = 'c-47-002';
UPDATE communes SET wilaya_id = 58 WHERE id = 'c-47-011';
UPDATE communes SET wilaya_id = 58, name_ar = 'حاسي القارة' WHERE id = 'c-47-012';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-019';
UPDATE communes SET wilaya_id = 59, name = 'Aïn Sidi Ali' WHERE id = 'c-03-011';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-013';
UPDATE communes SET wilaya_id = 59, name = 'El Beïdha', name_ar = 'البيضاء' WHERE id = 'c-03-012';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-014';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-010';
UPDATE communes SET wilaya_id = 59, name_ar = 'الحاج مشري' WHERE id = 'c-03-015';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-021';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-022';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-016';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-024';
UPDATE communes SET wilaya_id = 59 WHERE id = 'c-03-017';
UPDATE communes SET wilaya_id = 60, name = 'Abdelkader Azil' WHERE id = 'c-05-015';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-042';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-014';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-043';
UPDATE communes SET wilaya_id = 60, name = 'M''Doukal', name_ar = 'إمدوكل' WHERE id = 'c-05-055';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-056';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-029';
UPDATE communes SET wilaya_id = 60 WHERE id = 'c-05-018';
UPDATE communes SET wilaya_id = 61, name = 'Aïn Zaatout' WHERE id = 'c-07-018';
UPDATE communes SET wilaya_id = 61, name_ar = 'برانيس' WHERE id = 'c-07-003';
UPDATE communes SET wilaya_id = 61, name = 'Djemourah' WHERE id = 'c-07-020';
UPDATE communes SET wilaya_id = 61 WHERE id = 'c-07-017';
UPDATE communes SET wilaya_id = 61, name_ar = 'الوطاية' WHERE id = 'c-07-019';
UPDATE communes SET wilaya_id = 62 WHERE id = 'c-12-002';
UPDATE communes SET wilaya_id = 62, name = 'El Ogla El Malha', name_ar = 'العقلة المالحة' WHERE id = 'c-12-015';
UPDATE communes SET wilaya_id = 62, name_ar = 'فركان' WHERE id = 'c-12-028';
UPDATE communes SET wilaya_id = 62 WHERE id = 'c-12-009';
UPDATE communes SET wilaya_id = 63 WHERE id = 'c-13-032';
UPDATE communes SET wilaya_id = 63, name_ar = 'البويهي' WHERE id = 'c-13-043';
UPDATE communes SET wilaya_id = 63, name_ar = 'القور' WHERE id = 'c-13-010';
UPDATE communes SET wilaya_id = 63 WHERE id = 'c-13-041';
UPDATE communes SET wilaya_id = 64 WHERE id = 'c-14-040';
UPDATE communes SET wilaya_id = 64, name_ar = 'حمادية' WHERE id = 'c-14-035';
UPDATE communes SET wilaya_id = 64 WHERE id = 'c-14-029';
UPDATE communes SET wilaya_id = 64 WHERE id = 'c-14-030';
UPDATE communes SET wilaya_id = 64, name = 'Serguine' WHERE id = 'c-14-039';
UPDATE communes SET wilaya_id = 64, name = 'Zmalet El Emir Abdelkader' WHERE id = 'c-14-009';
UPDATE communes SET wilaya_id = 65, name = 'Aïn Fekka', name_ar = 'عين فقه' WHERE id = 'c-17-035';
UPDATE communes SET wilaya_id = 65, name = 'Aïn Ouessara' WHERE id = 'c-17-031';
UPDATE communes SET wilaya_id = 65 WHERE id = 'c-17-032';
UPDATE communes SET wilaya_id = 65, name_ar = 'بيرين' WHERE id = 'c-17-008';
UPDATE communes SET wilaya_id = 65, name = 'Bouira Lahdab' WHERE id = 'c-17-009';
UPDATE communes SET wilaya_id = 65 WHERE id = 'c-17-011';
UPDATE communes SET wilaya_id = 65, name_ar = 'قرنيني' WHERE id = 'c-17-021';
UPDATE communes SET wilaya_id = 65 WHERE id = 'c-17-020';
UPDATE communes SET wilaya_id = 65 WHERE id = 'c-17-033';
UPDATE communes SET wilaya_id = 65 WHERE id = 'c-17-019';
UPDATE communes SET wilaya_id = 66 WHERE id = 'c-17-034';
UPDATE communes SET wilaya_id = 66 WHERE id = 'c-17-029';
UPDATE communes SET wilaya_id = 66, name = 'Faïdh El Botma' WHERE id = 'c-17-007';
UPDATE communes SET wilaya_id = 66, name_ar = 'قطارة' WHERE id = 'c-17-018';
UPDATE communes SET wilaya_id = 66 WHERE id = 'c-17-017';
UPDATE communes SET wilaya_id = 66, name_ar = 'أم العظام' WHERE id = 'c-17-024';
UPDATE communes SET wilaya_id = 66, name_ar = 'سد الرحال' WHERE id = 'c-17-006';
UPDATE communes SET wilaya_id = 66 WHERE id = 'c-17-022';
UPDATE communes SET wilaya_id = 67, name = 'Aïn Boucif' WHERE id = 'c-26-004';
UPDATE communes SET wilaya_id = 67, name = 'Aïn Ouksir', name_ar = 'عين اقصير' WHERE id = 'c-26-041';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-032';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-025';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-010';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-051';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-038';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-018';
UPDATE communes SET wilaya_id = 67, name_ar = 'شنيقل' WHERE id = 'c-26-040';
UPDATE communes SET wilaya_id = 67, name_ar = 'دراق' WHERE id = 'c-26-008';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-057';
UPDATE communes SET wilaya_id = 67, name_ar = 'الكاف الاخضر' WHERE id = 'c-26-017';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-035';
UPDATE communes SET wilaya_id = 67, name = 'M''Fatha', name_ar = 'مفاتحة' WHERE id = 'c-26-049';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-058';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-022';
UPDATE communes SET wilaya_id = 67, name_ar = 'أولاد امعرف' WHERE id = 'c-26-003';
UPDATE communes SET wilaya_id = 67, name = 'Oum El Djallil' WHERE id = 'c-26-042';
UPDATE communes SET wilaya_id = 67, name_ar = 'السانق' WHERE id = 'c-26-064';
UPDATE communes SET wilaya_id = 67 WHERE id = 'c-26-031';
UPDATE communes SET wilaya_id = 67, name_ar = 'تفراوت' WHERE id = 'c-26-023';
UPDATE communes SET wilaya_id = 68, name = 'Aïn El Meleh' WHERE id = 'c-28-041';
UPDATE communes SET wilaya_id = 68, name = 'Aïn Errich' WHERE id = 'c-28-044';
UPDATE communes SET wilaya_id = 68, name = 'Aïn Farès' WHERE id = 'c-28-037';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-024';
UPDATE communes SET wilaya_id = 68, name_ar = 'بن زوه' WHERE id = 'c-28-035';
UPDATE communes SET wilaya_id = 68, name_ar = 'بئر فضة' WHERE id = 'c-28-036';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-020';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-047';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-027';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-026';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-007';
UPDATE communes SET wilaya_id = 68, name = 'M''Cif' WHERE id = 'c-28-008';
UPDATE communes SET wilaya_id = 68, name_ar = 'امجدل' WHERE id = 'c-28-042';
UPDATE communes SET wilaya_id = 68, name = 'Menaâ', name_ar = 'مناعة' WHERE id = 'c-28-039';
UPDATE communes SET wilaya_id = 68, name = 'Mouhamed Boudiaf' WHERE id = 'c-28-034';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-021';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-025';
UPDATE communes SET wilaya_id = 68, name = 'Oultem' WHERE id = 'c-28-046';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-022';
UPDATE communes SET wilaya_id = 68, name = 'Sidi M''Hamed', name_ar = 'سيدي امحمد' WHERE id = 'c-28-038';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-043';
UPDATE communes SET wilaya_id = 68 WHERE id = 'c-28-023';
UPDATE communes SET wilaya_id = 68, name_ar = 'زرزور' WHERE id = 'c-28-033';
UPDATE communes SET wilaya_id = 69, name = 'Aïn El Orak' WHERE id = 'c-32-008';
UPDATE communes SET wilaya_id = 69, name_ar = 'اربوات' WHERE id = 'c-32-009';
UPDATE communes SET wilaya_id = 69 WHERE id = 'c-32-013';
UPDATE communes SET wilaya_id = 69 WHERE id = 'c-32-014';
UPDATE communes SET wilaya_id = 69, name_ar = 'الأبيض سيدي الشيخ' WHERE id = 'c-32-007';
UPDATE communes SET wilaya_id = 69 WHERE id = 'c-32-016';
UPDATE communes SET wilaya_id = 69, name = 'El Meharra', name_ar = 'المحرة' WHERE id = 'c-32-019';

-- 3. The placeholder copies merge into their commune.
UPDATE customers SET commune_id = 'c-01-009' WHERE commune_id = 'c-49-001';
UPDATE orders SET commune_id = 'c-01-009' WHERE commune_id = 'c-49-001';
UPDATE abandoned_orders SET commune_id = 'c-01-009' WHERE commune_id = 'c-49-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-01-009' WHERE commune_id = 'c-49-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-49-001';
UPDATE customers SET commune_id = 'c-01-025' WHERE commune_id = 'c-50-001';
UPDATE orders SET commune_id = 'c-01-025' WHERE commune_id = 'c-50-001';
UPDATE abandoned_orders SET commune_id = 'c-01-025' WHERE commune_id = 'c-50-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-01-025' WHERE commune_id = 'c-50-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-50-001';
UPDATE customers SET commune_id = 'c-07-005' WHERE commune_id = 'c-51-001';
UPDATE orders SET commune_id = 'c-07-005' WHERE commune_id = 'c-51-001';
UPDATE abandoned_orders SET commune_id = 'c-07-005' WHERE commune_id = 'c-51-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-07-005' WHERE commune_id = 'c-51-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-51-001';
UPDATE customers SET commune_id = 'c-08-007' WHERE commune_id = 'c-52-001';
UPDATE orders SET commune_id = 'c-08-007' WHERE commune_id = 'c-52-001';
UPDATE abandoned_orders SET commune_id = 'c-08-007' WHERE commune_id = 'c-52-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-08-007' WHERE commune_id = 'c-52-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-52-001';
UPDATE customers SET commune_id = 'c-11-008' WHERE commune_id = 'c-53-001';
UPDATE orders SET commune_id = 'c-11-008' WHERE commune_id = 'c-53-001';
UPDATE abandoned_orders SET commune_id = 'c-11-008' WHERE commune_id = 'c-53-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-11-008' WHERE commune_id = 'c-53-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-53-001';
UPDATE customers SET commune_id = 'c-11-004' WHERE commune_id = 'c-54-001';
UPDATE orders SET commune_id = 'c-11-004' WHERE commune_id = 'c-54-001';
UPDATE abandoned_orders SET commune_id = 'c-11-004' WHERE commune_id = 'c-54-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-11-004' WHERE commune_id = 'c-54-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-54-001';
UPDATE customers SET commune_id = 'c-30-013' WHERE commune_id = 'c-55-001';
UPDATE orders SET commune_id = 'c-30-013' WHERE commune_id = 'c-55-001';
UPDATE abandoned_orders SET commune_id = 'c-30-013' WHERE commune_id = 'c-55-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-30-013' WHERE commune_id = 'c-55-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-55-001';
UPDATE customers SET commune_id = 'c-33-002' WHERE commune_id = 'c-56-001';
UPDATE orders SET commune_id = 'c-33-002' WHERE commune_id = 'c-56-001';
UPDATE abandoned_orders SET commune_id = 'c-33-002' WHERE commune_id = 'c-56-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-33-002' WHERE commune_id = 'c-56-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-56-001';
UPDATE customers SET commune_id = 'c-39-027' WHERE commune_id = 'c-57-001';
UPDATE orders SET commune_id = 'c-39-027' WHERE commune_id = 'c-57-001';
UPDATE abandoned_orders SET commune_id = 'c-39-027' WHERE commune_id = 'c-57-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-39-027' WHERE commune_id = 'c-57-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-57-001';
UPDATE customers SET commune_id = 'c-47-002' WHERE commune_id = 'c-58-001';
UPDATE orders SET commune_id = 'c-47-002' WHERE commune_id = 'c-58-001';
UPDATE abandoned_orders SET commune_id = 'c-47-002' WHERE commune_id = 'c-58-001';
UPDATE OR IGNORE shipping_rule_communes SET commune_id = 'c-47-002' WHERE commune_id = 'c-58-001';
DELETE FROM shipping_rule_communes WHERE commune_id = 'c-58-001';
DROP TABLE carrier_communes;
DROP TABLE carrier_wilayas;
DELETE FROM communes WHERE id IN ('c-49-001', 'c-50-001', 'c-51-001', 'c-52-001', 'c-53-001', 'c-54-001', 'c-55-001', 'c-56-001', 'c-57-001', 'c-58-001');

-- 4. Every address takes its commune's wilaya (and, where the names are kept as text, its names).
UPDATE orders SET wilaya_id = (SELECT c.wilaya_id FROM communes c WHERE c.id = orders.commune_id)
  WHERE commune_id IS NOT NULL AND wilaya_id IS NOT (SELECT c.wilaya_id FROM communes c WHERE c.id = orders.commune_id);
UPDATE customers SET
  wilaya_id = (SELECT c.wilaya_id FROM communes c WHERE c.id = customers.commune_id),
  wilaya = (SELECT w.name FROM communes c JOIN wilayas w ON w.id = c.wilaya_id WHERE c.id = customers.commune_id),
  commune = (SELECT c.name FROM communes c WHERE c.id = customers.commune_id)
  WHERE commune_id IS NOT NULL AND (
    wilaya_id IS NOT (SELECT c.wilaya_id FROM communes c WHERE c.id = customers.commune_id)
    OR wilaya IS NOT (SELECT w.name FROM communes c JOIN wilayas w ON w.id = c.wilaya_id WHERE c.id = customers.commune_id)
    OR commune IS NOT (SELECT c.name FROM communes c WHERE c.id = customers.commune_id));
UPDATE abandoned_orders SET
  wilaya_id = (SELECT c.wilaya_id FROM communes c WHERE c.id = abandoned_orders.commune_id),
  wilaya_name = (SELECT w.name FROM communes c JOIN wilayas w ON w.id = c.wilaya_id WHERE c.id = abandoned_orders.commune_id),
  commune_name = (SELECT c.name FROM communes c WHERE c.id = abandoned_orders.commune_id)
  WHERE commune_id IS NOT NULL AND (
    wilaya_id IS NOT (SELECT c.wilaya_id FROM communes c WHERE c.id = abandoned_orders.commune_id)
    OR wilaya_name IS NOT (SELECT w.name FROM communes c JOIN wilayas w ON w.id = c.wilaya_id WHERE c.id = abandoned_orders.commune_id)
    OR commune_name IS NOT (SELECT c.name FROM communes c WHERE c.id = abandoned_orders.commune_id));

-- 5. A new wilaya's prices and drivers' fees start as those of the wilaya it was taken from.
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 59, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 3
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 59);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 59, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 3
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 59);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 60, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 5
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 60);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 60, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 5
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 60);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 61, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 7
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 61);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 61, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 7
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 61);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 62, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 12
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 62);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 62, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 12
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 62);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 63, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 13
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 63);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 63, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 13
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 63);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 64, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 14
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 64);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 64, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 14
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 64);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 65, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 17
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 65);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 65, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 17
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 65);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 66, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 17
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 66);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 66, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 17
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 66);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 67, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 26
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 67);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 67, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 26
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 67);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 68, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 28
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 68);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 68, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 28
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 68);
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, 69, r.home_price, r.stop_desk_price, r.home_enabled, r.stop_desk_enabled, r.created_at
  FROM shipping_rules r WHERE r.wilaya_id = 32
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = 69);
INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), d.driver_id, 69, d.fee_per_delivery, d.created_at, d.updated_at
  FROM driver_compensations d WHERE d.wilaya_id = 32
  AND NOT EXISTS (SELECT 1 FROM driver_compensations n WHERE n.driver_id = d.driver_id AND n.wilaya_id = 69);
-- A commune's override follows the commune to its wilaya's rule in the same
-- profile (the rule is copied from the one the override sat under when the
-- profile has none for that wilaya); an override the commune already has
-- there wins.
INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at)
  SELECT lower(hex(randomblob(16))), r.profile_id, c.wilaya_id, max(r.home_price), max(r.stop_desk_price), max(r.home_enabled), max(r.stop_desk_enabled), min(r.created_at)
  FROM shipping_rule_communes o
  JOIN shipping_rules r ON r.id = o.rule_id
  JOIN communes c ON c.id = o.commune_id
  WHERE r.wilaya_id <> c.wilaya_id
  AND NOT EXISTS (SELECT 1 FROM shipping_rules n WHERE n.profile_id = r.profile_id AND n.wilaya_id = c.wilaya_id)
  GROUP BY r.profile_id, c.wilaya_id;
UPDATE OR IGNORE shipping_rule_communes SET rule_id = (
    SELECT n.id FROM shipping_rules r
    JOIN communes c ON c.id = shipping_rule_communes.commune_id
    JOIN shipping_rules n ON n.profile_id = r.profile_id AND n.wilaya_id = c.wilaya_id
    WHERE r.id = shipping_rule_communes.rule_id)
  WHERE (SELECT r.wilaya_id FROM shipping_rules r WHERE r.id = shipping_rule_communes.rule_id)
     <> (SELECT c.wilaya_id FROM communes c WHERE c.id = shipping_rule_communes.commune_id);
DELETE FROM shipping_rule_communes
  WHERE (SELECT r.wilaya_id FROM shipping_rules r WHERE r.id = shipping_rule_communes.rule_id)
     <> (SELECT c.wilaya_id FROM communes c WHERE c.id = shipping_rule_communes.commune_id);

-- 6. One map of places per delivery company, from the carrier's own list.
CREATE TABLE carrier_places (
  company_id TEXT NOT NULL REFERENCES delivery_companies(id) ON DELETE CASCADE,
  commune_id TEXT NOT NULL REFERENCES communes(id),
  wilaya_ref TEXT NOT NULL,
  wilaya_number INTEGER NOT NULL,
  wilaya_name TEXT NOT NULL,
  commune_ref TEXT NOT NULL,
  commune_name TEXT NOT NULL,
  home INTEGER NOT NULL,
  PRIMARY KEY (company_id, commune_id)
);
ALTER TABLE delivery_companies ADD COLUMN places_synced_at TEXT;
ALTER TABLE delivery_companies ADD COLUMN places_unmatched TEXT;
ALTER TABLE company_stop_desks ADD COLUMN commune_id TEXT REFERENCES communes(id);

-- 7. A commune's "postal code" was the statistics office's code under the 1984 wilaya, not a postal code.
ALTER TABLE communes DROP COLUMN postal_code;
