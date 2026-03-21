import { cli } from '../../adapter/registry.js';
import { Strategy } from '../../types/adapter.js';

cli({
  site: 'wikipedia',
  name: 'search',
  description: 'Search Wikipedia articles',
  domain: 'en.wikipedia.org',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
  ],
  columns: ['title', 'snippet', 'wordcount'],
  func: async (_page, kwargs) => {
    const query = encodeURIComponent(kwargs.query as string);
    const limit = (kwargs.limit as number) || 10;
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&srlimit=${limit}&format=json&origin=*`;
    const resp = await fetch(url);
    const data = (await resp.json()) as Record<string, unknown>;
    const results = ((data.query as Record<string, unknown>)?.search as Record<string, unknown>[]) || [];
    return results.map((item) => ({
      title: item.title,
      snippet: String(item.snippet || '').replace(/<[^>]+>/g, '').slice(0, 80),
      wordcount: item.wordcount,
    }));
  },
});
