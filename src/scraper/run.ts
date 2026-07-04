// CLI 진입점: `npm run scrape [상세개수]`
import { runScrape } from './index.js';

const limitArg = process.argv[2];
const detailLimit = limitArg ? Number(limitArg) : undefined;

runScrape({ detailLimit, onProgress: (m) => console.log(`  ${m}`) })
  .then((r) => {
    console.log('\n=== 수집 결과 ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('수집 실패:', err);
    process.exit(1);
  });
