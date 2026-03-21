import { cli } from '../../adapter/registry.js';
import { Strategy } from '../../types/adapter.js';

cli({
  site: 'hackernews',
  name: 'top',
  description: 'Get top stories from Hacker News',
  domain: 'news.ycombinator.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of stories to fetch' },
  ],
  columns: ['rank', 'title', 'score', 'by', 'comments'],
  func: async (_page, kwargs) => {
    const limit = (kwargs.limit as number) || 10;
    const idsResp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = (await idsResp.json()) as number[];
    const stories = await Promise.all(
      ids.slice(0, limit).map(async (id, i) => {
        const resp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const story = (await resp.json()) as Record<string, unknown>;
        return {
          rank: i + 1,
          title: story.title || '',
          url: story.url || `https://news.ycombinator.com/item?id=${id}`,
          score: story.score || 0,
          by: story.by || '',
          comments: story.descendants || 0,
        };
      })
    );
    return stories;
  },
});
