export const sections = [
  { slug: 'football', name: 'كرة القدم', icon: '/brand/icon-football.svg', description: 'أهم أخبار الكرة العالمية لحظة بلحظة.' },
  { slug: 'saudi', name: 'الكرة السعودية', icon: '/brand/icon-saudi.svg', description: 'دوري روشن، الأندية والمنتخب السعودي.' },
  { slug: 'transfers', name: 'الانتقالات', icon: '/brand/icon-transfers.svg', description: 'آخر أخبار وصفقات سوق الانتقالات.' },
  { slug: 'basketball', name: 'كرة السلة / NBA', icon: '/brand/icon-basketball.svg', description: 'أخبار NBA وكرة السلة العالمية والنتائج والصفقات.' },
  { slug: 'sports', name: 'رياضات عامة', icon: '/brand/icon-sports.svg', description: 'أخبار الرياضات العالمية من أبرز الشبكات والمصادر.' },
  { slug: 'ufc', name: 'UFC / MMA', icon: '/brand/icon-mma.svg', description: 'أخبار النزالات والبطاقات والنتائج.' },
  { slug: 'wwe', name: 'WWE', icon: '/brand/icon-wwe.svg', description: 'آخر أخبار وعروض المصارعة.' },
  { slug: 'boxing', name: 'الملاكمة', icon: '/brand/icon-boxing.svg', description: 'نزالات الملاكمة والأبطال والبطاقات.' }
] as const;

export const sectionMap = Object.fromEntries(sections.map((s) => [s.slug, s]));
