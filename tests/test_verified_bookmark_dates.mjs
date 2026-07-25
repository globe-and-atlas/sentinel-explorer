import assert from 'node:assert/strict';

import { verifiedBookmarks } from '../src/verifiedBookmarks.js';

// Sentinel-2A launched 2015-06-23. No Sentinel-2 scene of an earlier event can
// exist, so a bookmark offering one as an imaging date is unsatisfiable.
const S2_FIRST_LIGHT = '2015-06-23';
const L2A_RELIABLE = '2017-01-01';

let total = 0;
let unobservable = 0;
let sparse = 0;

for (const [key, rows] of Object.entries(verifiedBookmarks)) {
  assert.ok(Array.isArray(rows) && rows.length, `${key} has bookmark rows`);

  for (const row of rows) {
    total += 1;
    const where = `${key} / ${row.label}`;

    assert.ok(row.label, `${where} has a label`);
    assert.ok(row.sourceUrl, `${where} has a source URL`);
    assert.ok(Number.isFinite(row.lat) && Number.isFinite(row.lng), `${where} has coordinates`);

    if (row.date === null) {
      unobservable += 1;
      assert.equal(row.sentinelObservable, false, `${where} declares itself unobservable`);
      assert.ok(row.eventDate, `${where} keeps its event date as provenance`);
      assert.ok(row.eventDate < S2_FIRST_LIGHT, `${where} is null only because it predates Sentinel-2`);
      continue;
    }

    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, `${where} has an ISO search-window date`);
    assert.ok(
      row.date >= S2_FIRST_LIGHT,
      `${where} must not offer a pre-Sentinel-2 imaging date (got ${row.date})`,
    );

    if (row.date < L2A_RELIABLE) {
      sparse += 1;
      assert.equal(row.sentinelObservable, 'sparse', `${where} is flagged as sparse-archive`);
      assert.ok(row.eventDate, `${where} carries its event date`);
    }
  }
}

assert.equal(total, 90, 'verifiedBookmarks retains 90 source-reviewed rows');
assert.equal(unobservable, 21, 'the 21 pre-Sentinel-2 events stay recorded but unobservable');
assert.equal(sparse, 9, 'the 9 sparse-archive rows stay flagged');

console.log(
  `test_verified_bookmark_dates: ${total} rows checked `
  + `(${unobservable} pre-Sentinel-2, ${sparse} sparse-archive)`,
);
