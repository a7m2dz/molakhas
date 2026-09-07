export const sections = [
  { slug: 'football', name: 'كرة القدم', icon: '⚽', description: 'أهم أخبار الكرة العالمية لحظة بلحظة.' },
  { slug: 'saudi', name: 'الكرة السعودية', icon: '🇸🇦', description: 'دوري روشن، الأندية والمنتخب السعودي.' },
  { slug: 'transfers', name: 'الانتقالات', icon: '🔁', description: 'آخر أخبار وصفقات سوق الانتقالات.' },
  { slug: 'ufc', name: 'UFC / MMA', icon: '🥊', description: 'أخبار النزالات والبطاقات والنتائج.' },
  { slug: 'wwe', name: 'WWE', icon: '🤼', description: 'آخر أخبار وعروض المصارعة.' },
  { slug: 'boxing', name: 'الملاكمة', icon: '🥊', description: 'نزالات الملاكمة والأبطال والبطاقات.' }
] as const;

export const sectionMap = Object.fromEntries(sections.map((s) => [s.slug, s]));
