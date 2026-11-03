// Command-line crawler: tsx src/cli.ts --seed https://example.com --max 500 --depth 3 --same-host
import { join } from 'node:path';
import { openDb, stats } from './db';
import { Crawler } from './crawler';

const args = process.argv.slice(2);
const seeds: string[] = [];
let max = 200, depth = 3, sameHost = false, recrawl = false, delay = 1000;
let dbFile = process.env.NUDE_SEARCH_DB ?? join(process.cwd(), 'data', 'nude-search.db');
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--seed') seeds.push(args[++i]);
  else if (a === '--max') max = Number(args[++i]);
  else if (a === '--depth') depth = Number(args[++i]);
  else if (a === '--same-host') sameHost = true;
  else if (a === '--recrawl') recrawl = true;
  else if (a === '--delay') delay = Number(args[++i]);
  else if (a === '--db') dbFile = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log('Usage: npm run crawl -- --seed <url> [--seed <url>…] [--max 200] [--depth 3] [--same-host] [--delay 1000] [--db file] [--recrawl]');
    process.exit(0);
  }
}
if (!seeds.length && !recrawl) { console.error('Give at least one --seed URL (or --recrawl to refresh due pages).'); process.exit(1); }

const db = openDb(dbFile);
const crawler = new Crawler(db, { maxPages: max, maxDepth: depth, hostDelayMs: delay, allowedHosts: sameHost ? seeds.map((s) => new URL(s).hostname) : undefined, log: (m) => console.log(m) });
seeds.forEach((s) => crawler.enqueue(s, 0, 1));
crawler.run().then((r) => {
  console.log('\nCrawl finished:', r);
  console.log('Index:', stats(db));
});
