// Trips index: region / in-season filters and column sorting.
(() => {
  const table = document.getElementById('trips');
  if (!table) return;
  const tbody = table.tBodies[0];
  const rows = [...tbody.querySelectorAll('tr.row')];
  const groups = [...tbody.querySelectorAll('tr.grp')];
  const none = tbody.querySelector('tr.none');
  let filter = 'all', sortKey = null, dir = 1;

  const now = new Date();
  const thisMonth = String(now.getMonth() + 1).padStart(2, '0');
  // In season this month: any season overlapping the current month
  const inSeasonNow = row => (row.dataset.seasons || '').split(',').filter(Boolean).some(span => {
    const [a, b] = span.split(':');
    const ms = `${thisMonth}-01`, me = `${thisMonth}-31`;
    return a <= b ? (a <= me && b >= ms) : (a <= me || b >= ms);
  });

  function apply() {
    let shown = 0;
    rows.forEach(r => {
      const ok = filter === 'all' || (filter === 'now' ? inSeasonNow(r) : r.dataset.region === filter.slice(7));
      r.hidden = !ok; if (ok) shown++;
    });
    const ordered = [...rows].sort((a, b) => {
      if (!sortKey) return a.dataset.order - b.dataset.order;
      const x = a.dataset[sortKey], y = b.dataset[sortKey];
      const nx = parseFloat(x), ny = parseFloat(y);
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y));
      return c * dir || a.dataset.order - b.dataset.order;
    });
    if (sortKey) {
      groups.forEach(g => g.hidden = true);
      ordered.forEach(r => tbody.insertBefore(r, none));
    } else {
      // natural order: put each row back under its region header
      ordered.forEach(r => tbody.insertBefore(r, none));
      groups.forEach(g => {
        const mine = ordered.filter(r => r.dataset.region === g.dataset.region);
        if (mine.length) tbody.insertBefore(g, mine[0]);
        g.hidden = !mine.some(r => !r.hidden);
      });
    }
    none.hidden = shown > 0;
  }

  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    apply();
  }));
  table.querySelectorAll('th button[data-key]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.key;
    if (sortKey === key) { if (dir === 1) dir = -1; else { sortKey = null; dir = 1; } } else { sortKey = key; dir = 1; }
    table.querySelectorAll('th').forEach(th => th.removeAttribute('aria-sort'));
    if (sortKey) b.closest('th').setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    apply();
  }));
})();
