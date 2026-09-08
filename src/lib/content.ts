export function topicSlug(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function storyImage(story: any) {
  return story?.image?.src || `/news-images/${story.slug}.webp`;
}

export function topicCounts(stories: any[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const story of stories) {
    if (story?.status !== 'approved') continue;
    for (const tag of story?.tags || []) {
      const slug = topicSlug(tag);
      if (!slug) continue;
      const current = counts.get(slug) || { name: String(tag), count: 0 };
      current.count += 1;
      counts.set(slug, current);
    }
  }
  return counts;
}
