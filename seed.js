/**
 * Seeds the database with reference + demo data that mirrors the
 * AgriGuard AI frontend mockups (crops, diseases, dealers, products,
 * market prices, outbreaks, alerts, calendar tasks, loan packages).
 *
 * Run with: npm run db:seed
 */
const { pool } = require('../src/config/database');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── CROPS ────────────────────────────────────────────────────────────
    const crops = [
      ['maize', 'Maize', 'Masara', 'Agbado', 'Ọka', '🌽', 'cereal', 'Apr–Jul (wet season)', 'Nigeria\'s most widely cultivated cereal, staple in the north.'],
      ['rice', 'Rice', 'Shinkafa', 'Iresi', 'Osikapa', '🌾', 'cereal', 'May–Oct', 'Major staple grown extensively in Kano, Kebbi and the Niger Delta.'],
      ['tomato', 'Tomato', 'Tumatir', 'Tomati', 'Tomato', '🍅', 'vegetable', 'Oct–Mar (dry season)', 'High-value vegetable crop, prone to blight in humid conditions.'],
      ['cassava', 'Cassava', 'Rogo', 'Ege', 'Akpu', '🥔', 'tuber', 'Year-round', 'Drought-tolerant tuber crop, Nigeria is the world\'s largest producer.'],
      ['pepper', 'Pepper', 'Tattasai', 'Ata', 'Ose oyibo', '🌶️', 'vegetable', 'Sep–Feb', 'Widely grown for local cuisine and export.'],
      ['millet', 'Millet', 'Gero', 'Okababa', 'Achicha', '🌿', 'cereal', 'Jun–Sep', 'Drought-resistant cereal common across the Sahel belt.'],
      ['onion', 'Onion', 'Albasa', 'Alubosa', 'Yabasi', '🧅', 'vegetable', 'Nov–Mar', 'Major cash crop in Kano and Sokoto.'],
      ['sorghum', 'Sorghum', 'Dawa', 'Oka baba', 'Ọka', '🌱', 'cereal', 'May–Sep', 'Hardy cereal widely used for food and brewing.'],
    ];
    const cropIds = {};
    for (const c of crops) {
      const r = await client.query(
        `INSERT INTO crops (slug,name_en,name_ha,name_yo,name_ig,emoji,category,growing_season,description_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET name_en=EXCLUDED.name_en
         RETURNING id, slug`, c
      );
      cropIds[r.rows[0].slug] = r.rows[0].id;
    }

    // ── DISEASES ─────────────────────────────────────────────────────────
    const diseases = [
      {
        slug: 'maize-leaf-blight', crop: 'maize', name_en: 'Maize Leaf Blight', name_ha: 'Cutar Ganyen Masara',
        pathogen: 'Setosphaeria turcica', severity: 'moderate',
        description_en: 'Northern Corn Leaf Blight (NCLB) caused by fungus Setosphaeria turcica. Long tan-grey lesions visible on leaves, 2.5–15cm long. Spreads rapidly in cool, humid conditions.',
        description_ha: 'Cutar da ke addabar ganyen masara, tana haifar da tabo masu tsayi a ganyen.',
        symptoms: ['Long tan-grey lesions on leaves', 'Lesions 2.5–15cm long', 'Yellowing around lesion edges'],
        treatment: [
          'Apply Mancozeb fungicide at 2.5g/L water. Spray every 7–10 days.',
          'Remove and destroy all infected plant debris from the field.',
          'Ensure proper field drainage to reduce leaf wetness duration.',
          'Re-scout after 2 weeks to monitor disease progression.'
        ],
        prevention: [
          'Use resistant hybrid seeds (e.g. SAMMAZ 14, DKC 8033)',
          'Practice crop rotation with legumes every 2 seasons',
          'Avoid overhead irrigation; use drip or furrow methods',
          'Monitor fields regularly — especially after heavy rainfall'
        ]
      },
      {
        slug: 'tomato-early-blight', crop: 'tomato', name_en: 'Tomato Early Blight', name_ha: 'Cutar Tumatir',
        pathogen: 'Alternaria solani', severity: 'severe',
        description_en: 'Fungal disease causing dark concentric-ringed spots on lower leaves, spreading upward; can defoliate plants and reduce yield significantly.',
        description_ha: 'Cuta ce da ke kawo tabo baki a ganyen tumatir.',
        symptoms: ['Dark concentric ring spots', 'Lower leaf yellowing', 'Premature defoliation'],
        treatment: [
          'Apply copper-based or Mancozeb fungicide weekly.',
          'Prune lower infected leaves immediately.',
          'Stake plants to improve air circulation.',
          'Avoid wetting foliage when watering.'
        ],
        prevention: [
          'Rotate with non-solanaceous crops',
          'Use certified disease-free seedlings',
          'Mulch to prevent soil splash onto leaves',
          'Space plants for good airflow'
        ]
      },
      {
        slug: 'tomato-late-blight', crop: 'tomato', name_en: 'Tomato Late Blight', name_ha: 'Cutar Tumatir (Tumatir)',
        pathogen: 'Phytophthora infestans', severity: 'severe',
        description_en: 'Aggressive water-mold disease causing rapid blackening and collapse of leaves and stems, especially during cool, wet weather.',
        description_ha: '', symptoms: ['Water-soaked lesions', 'White fungal growth under leaves', 'Rapid plant collapse'],
        treatment: ['Apply Cymoxanil + Mancozeb combination fungicide.', 'Destroy infected plants immediately to stop spread.', 'Improve field drainage.'],
        prevention: ['Avoid overhead irrigation', 'Plant resistant varieties', 'Increase plant spacing']
      },
      {
        slug: 'rice-blast', crop: 'rice', name_en: 'Rice Blast', name_ha: 'Cutar Shinkafa',
        pathogen: 'Magnaporthe oryzae', severity: 'moderate',
        description_en: 'Fungal disease producing diamond-shaped lesions on leaves; can affect panicles and severely reduce grain yield.',
        description_ha: '', symptoms: ['Diamond-shaped grey lesions', 'Panicle neck rot', 'Stunted growth'],
        treatment: ['Apply Tricyclazole-based fungicide.', 'Drain and dry field briefly to reduce humidity.', 'Remove infected tillers.'],
        prevention: ['Use blast-resistant rice varieties', 'Avoid excess nitrogen fertilizer', 'Maintain balanced water management']
      },
      {
        slug: 'cassava-mosaic', crop: 'cassava', name_en: 'Cassava Mosaic Disease', name_ha: 'Cutar Rogo',
        pathogen: 'Cassava mosaic begomovirus', severity: 'severe',
        description_en: 'Viral disease spread by whiteflies causing mottled yellow-green leaf patterns and stunted, twisted growth, drastically reducing tuber yield.',
        description_ha: '', symptoms: ['Yellow-green mosaic leaf pattern', 'Leaf distortion', 'Stunted plants'],
        treatment: ['Uproot and burn infected plants — no chemical cure exists.', 'Control whitefly vectors with appropriate insecticide.'],
        prevention: ['Plant certified virus-free cuttings', 'Monitor and control whitefly populations', 'Rogue infected plants early']
      },
      {
        slug: 'armyworm', crop: 'maize', name_en: 'Fall Armyworm', name_ha: 'Tsutsa (Masara)',
        pathogen: 'Spodoptera frugiperda', severity: 'severe',
        description_en: 'Highly destructive caterpillar pest that feeds on maize leaves and whorls, capable of spreading rapidly across farms.',
        description_ha: 'Tsutsa mai cin ganyen masara da sauri yake yaduwa.',
        symptoms: ['Ragged holes in leaves', 'Sawdust-like frass in whorl', 'Damaged growing point'],
        treatment: ['Apply Cypermethrin 200EC at 1L/ha. Spray early morning or evening.', 'Hand-pick larvae in small plots.', 'Apply early before larvae enter whorl.'],
        prevention: ['Scout fields weekly', 'Use pheromone traps', 'Practice early planting to escape peak infestation']
      },
    ];
    const diseaseIds = {};
    for (const d of diseases) {
      const r = await client.query(
        `INSERT INTO diseases (crop_id,slug,name_en,name_ha,pathogen,default_severity,description_en,description_ha,symptoms,treatment_steps,prevention_tips)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (slug) DO UPDATE SET name_en=EXCLUDED.name_en
         RETURNING id, slug`,
        [cropIds[d.crop], d.slug, d.name_en, d.name_ha, d.pathogen, d.severity, d.description_en, d.description_ha,
         d.symptoms, JSON.stringify(d.treatment.map((t,i)=>({step:i+1,text:t}))), JSON.stringify(d.prevention)]
      );
      diseaseIds[r.rows[0].slug] = r.rows[0].id;
    }

    // ── DEALERS ──────────────────────────────────────────────────────────
    const dealers = [
      ['Kano Agro Supply', 'Kano', 'Kano Municipal', '12.0022', '8.5920', '+2348031110001', 4.7],
      ['ADC Dealer Network', 'Kano', 'Fagge', '12.0150', '8.5500', '+2348031110002', 4.5],
      ['AgroMall Partner Store', 'Kano', 'Nasarawa', '11.9900', '8.5300', '+2348031110003', 4.6],
    ];
    const dealerIds = [];
    for (const d of dealers) {
      const r = await client.query(
        `INSERT INTO dealers (name,state,lga,latitude,longitude,phone,rating) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, d
      );
      dealerIds.push(r.rows[0].id);
    }

    // ── PRODUCTS ─────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO products (dealer_id,name,category,price,stock_status,stock_units,description,image_emoji,delivery_note,recommended_for_disease_id) VALUES
       ($1,'Mancozeb Fungicide 1kg','fungicide',2400,'in_stock',50,'For Leaf Blight · Kano Agro · 1.2km','🧴','Deliver in 2hrs',$5),
       ($2,'Urea Fertilizer 50kg','fertilizer',18500,'in_stock',120,'46-0-0 · Dangote Brand · ADC Dealer','🌱','Pickup available',NULL),
       ($3,'Cypermethrin 200EC · 1L','pesticide',3200,'limited',6,'Armyworm control · AgroMall Partner','🐛','Same-day delivery',$6),
       ($1,'SAMMAZ 14 Hybrid Seed 5kg','seed',7800,'in_stock',80,'Disease-resistant maize · IITA certified','💧','Free delivery ₦20k+',NULL)
      `, [dealerIds[0], dealerIds[1], dealerIds[2], null, diseaseIds['maize-leaf-blight'], diseaseIds['armyworm']]
    );

    // ── MARKET PRICES ────────────────────────────────────────────────────
    const prices = [
      [cropIds['maize'], 'Maize', 'Masara', '🌽', 280, 3.2, 1.2, 'up'],
      [cropIds['rice'], 'Rice', 'Shinkafa', '🌾', 640, -5.1, -0.8, 'down'],
      [cropIds['tomato'], 'Tomato', 'Tumatir', '🍅', 420, 21.8, 5.4, 'up'],
      [cropIds['millet'], 'Millet', 'Gero', '🌿', 310, 0.9, 0.3, 'up'],
      [cropIds['onion'], 'Onion', 'Albasa', '🧅', 380, -8.0, -2.1, 'down'],
      [cropIds['sorghum'], 'Sorghum', 'Dawa', '🌱', 295, 1.5, 0.5, 'up'],
    ];
    for (const p of prices) {
      await client.query(
        `INSERT INTO market_prices (crop_id,crop_name,local_name,emoji,state,market_name,price_per_kg,change_amount,change_percent,change_direction)
         VALUES ($1,$2,$3,$4,'Kano','Kano Central Market',$5,$6,$7,$8)`,
        [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]]
      );
    }

    // ── OUTBREAKS ────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO outbreaks (disease_id,pest_or_disease_name,local_name,crop_affected,state,lga,latitude,longitude,farms_affected_count,spread_rate_km_per_day,severity,recommended_action) VALUES
       ($1,'Fall Armyworm','Masara','Maize','Kano','Zaria',11.0667,7.7000,17,3.0,'critical','Apply Cypermethrin 200EC at 1L/ha. Spray early morning or evening. Available at Kano Agro Supply.'),
       ($2,'Tomato Late Blight','Tumatir','Tomato','Kano','Daura',13.0333,8.3333,9,1.2,'warning','Apply Cymoxanil + Mancozeb. Improve drainage and remove infected plants.')
      `, [diseaseIds['armyworm'], diseaseIds['tomato-late-blight']]
    );

    // ── ALERTS ───────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO alerts (type,severity,title,body,state,lga) VALUES
       ('pest','danger','Armyworm Outbreak','Detected in Kano & Kaduna LGAs. Apply recommended pesticide immediately. Spread rate: 3km/day.','Kano','Zaria'),
       ('weather','warning','Heavy Rainfall Warning','72hrs of rain expected starting Tuesday. Delay fertilizer application. Reinforce field drainage.','Kano',NULL),
       ('disease','info','Cassava Mosaic Alert','New strain detected in Ogun State farms. Monitor whitefly populations in your area.','Ogun',NULL),
       ('planting','info','Optimal Planting Window','Weather models show ideal conditions for sorghum planting from Thursday–Saturday this week.','Kano',NULL)
      `
    );

    // ── FARMING CALENDAR (June) ──────────────────────────────────────────
    await client.query(
      `INSERT INTO farming_calendar_tasks (state,month,task,status_label,status_kind) VALUES
       ('Kano',6,'Plant late-season maize','Now ✓','ideal'),
       ('Kano',6,'Apply 2nd fertilizer dose','After rain','wait'),
       ('Kano',6,'Harvest early cowpea','This week','ready'),
       ('Kano',6,'Spray pesticide (tomato)','Delay 48hrs','danger')
      `
    );

    // ── LOAN PACKAGES ────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO loan_packages (name,description,amount,term_months,interest_rate_monthly,category) VALUES
       ('Input Starter Pack','Seeds + Fertilizer + Pesticide for 1 season',25000,3,3.5,'input'),
       ('Farm Equipment Loan','Sprayer, irrigation hose, tools',60000,6,3.5,'equipment'),
       ('Emergency Crop Rescue','For disease outbreak treatment costs',15000,2,3.5,'emergency')
      `
    );

    await client.query('COMMIT');
    console.log('✅ Seed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
