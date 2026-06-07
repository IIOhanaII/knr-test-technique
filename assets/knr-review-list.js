/**
 * KNR — Review list ("Avis clients").
 * Fetches the same mock JSON as the reviews carousel (API-ready: point the
 * fetch at a real review-app endpoint to go live) and renders the rating
 * summary, the per-star distribution, a star filter and a paginated list.
 * The section hides itself when no review is returned.
 */
class KnrReviewList {
  constructor(root) {
    this.root = root;
    this.mockUrl = root.dataset.knrMockUrl;
    this.starSvg = root.querySelector('[data-knr-rl-star]')?.innerHTML ?? '';

    this.averageEl = root.querySelector('[data-knr-rl-average]');
    this.distributionEl = root.querySelector('[data-knr-rl-distribution]');
    this.itemsEl = root.querySelector('[data-knr-rl-items]');
    this.moreBtn = root.querySelector('[data-knr-rl-more]');
    this.filterToggle = root.querySelector('[data-knr-rl-filter-toggle]');
    this.filterMenu = root.querySelector('[data-knr-rl-filter-menu]');

    this.labels = {
      ratingSuffix: root.dataset.knrRlRatingSuffix ?? 'sur 5',
      basedOn: root.dataset.knrRlBasedOn ?? 'Basé sur {count} {label}',
      verified: root.dataset.knrRlVerified ?? 'Vérifié',
      filterAll: root.dataset.knrRlFilterAll ?? 'Tous les avis',
    };
    this.step = Math.max(1, parseInt(root.dataset.knrRlStep ?? '3', 10));

    this.reviews = [];
    this.filterValue = 0; // 0 = all
    this.visible = this.step;

    this.#load();
  }

  async #load() {
    if (!this.mockUrl || !this.itemsEl) {
      this.root.hidden = true;
      return;
    }
    try {
      const response = await fetch(this.mockUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('bad response');

      const data = await response.json();
      this.reviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (this.reviews.length === 0) {
        this.root.hidden = true;
        return;
      }
      this.rating = data.rating ?? {};

      this.#renderSummary();
      this.#renderDistribution();
      this.#renderFilterMenu();
      this.#renderItems();
      this.#bind();
      this.root.hidden = false;
    } catch (err) {
      this.root.hidden = true;
    }
  }

  // --- helpers -------------------------------------------------------------

  #escape(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  #stars(count) {
    const filled = Math.round(count ?? 0);
    return `<span class="knr-review-list__stars" aria-hidden="true">${Array.from(
      { length: 5 },
      (_, i) => `<span class="knr-review-list__star${i < filled ? '' : ' knr-review-list__star--off'}">${this.starSvg}</span>`
    ).join('')}</span>`;
  }

  #formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return this.#escape(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
  }

  // --- render --------------------------------------------------------------

  #renderSummary() {
    if (!this.averageEl) return;
    const value = this.rating.value ?? 0;
    const count = this.rating.count ?? this.reviews.length;
    const label = this.rating.label ?? 'avis';
    const basedOn = this.labels.basedOn
      .replace('{count}', this.#escape(String(count)))
      .replace('{label}', this.#escape(label));

    this.averageEl.innerHTML = `
      <div class="knr-review-list__average-rating">
        ${this.#stars(value)}
        <span class="knr-review-list__average-value">${this.#escape(`${value} ${this.labels.ratingSuffix}`)}</span>
      </div>
      <p class="knr-review-list__based-on">${basedOn}</p>`;
  }

  #renderDistribution() {
    if (!this.distributionEl) return;
    let rows = Array.isArray(this.rating.distribution) ? this.rating.distribution.slice() : [];
    if (rows.length === 0) {
      // Derive the breakdown from the reviews when the API omits it.
      const counts = [0, 0, 0, 0, 0];
      this.reviews.forEach((r) => {
        const n = Math.round(r.rating ?? 0);
        if (n >= 1 && n <= 5) counts[n - 1] += 1;
      });
      rows = counts.map((count, i) => ({ stars: i + 1, count }));
    }
    rows.sort((a, b) => b.stars - a.stars);
    const max = rows.reduce((m, r) => Math.max(m, r.count ?? 0), 0) || 1;

    this.distributionEl.innerHTML = rows
      .map((row) => {
        const pct = Math.round(((row.count ?? 0) / max) * 100);
        return `
          <div class="knr-review-list__dist-row">
            ${this.#stars(row.stars)}
            <span class="knr-review-list__dist-bar">
              <span class="knr-review-list__dist-fill" style="width: ${pct}%"></span>
            </span>
            <span class="knr-review-list__dist-count">${this.#escape(String(row.count ?? 0))}</span>
          </div>`;
      })
      .join('');
  }

  #renderFilterMenu() {
    if (!this.filterMenu) return;
    const available = new Set(this.reviews.map((r) => Math.round(r.rating ?? 0)));
    const options = [{ value: 0, label: this.labels.filterAll }];
    for (let stars = 5; stars >= 1; stars -= 1) {
      if (available.has(stars)) options.push({ value: stars, label: `${stars} ★` });
    }
    this.filterMenu.innerHTML = options
      .map(
        (opt) => `
        <button
          type="button"
          class="knr-review-list__filter-option"
          role="menuitemradio"
          aria-checked="${opt.value === this.filterValue}"
          data-knr-rl-filter-option="${opt.value}"
        >${this.#escape(opt.label)}</button>`
      )
      .join('');
  }

  #renderItems() {
    const list = this.filterValue
      ? this.reviews.filter((r) => Math.round(r.rating ?? 0) === this.filterValue)
      : this.reviews;
    const shown = list.slice(0, this.visible);

    this.itemsEl.innerHTML = shown
      .map((review) => {
        const badge = review.verified
          ? `<span class="knr-review-list__badge">${this.#escape(this.labels.verified)}</span>`
          : '';
        const title = review.title
          ? `<p class="knr-review-list__review-title">${this.#escape(review.title)}</p>`
          : '';
        return `
          <article class="knr-review-list__item">
            <div class="knr-review-list__item-head">
              ${this.#stars(review.rating)}
              <span class="knr-review-list__date">${this.#formatDate(review.date)}</span>
            </div>
            <div class="knr-review-list__reviewer">
              <span class="knr-review-list__author">${this.#escape(review.author)}</span>
              ${badge}
            </div>
            <div class="knr-review-list__review-content">
              ${title}
              <p class="knr-review-list__review-text">${this.#escape(review.text)}</p>
            </div>
          </article>`;
      })
      .join('');

    if (this.moreBtn) this.moreBtn.hidden = this.visible >= list.length;
  }

  // --- behaviour -----------------------------------------------------------

  #bind() {
    this.moreBtn?.addEventListener('click', () => {
      this.visible += this.step;
      this.#renderItems();
    });

    this.filterToggle?.addEventListener('click', () => this.#toggleFilter());

    this.filterMenu?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-knr-rl-filter-option]');
      if (!option) return;
      this.filterValue = parseInt(option.dataset.knrRlFilterOption, 10) || 0;
      this.visible = this.step;
      this.#renderFilterMenu();
      this.#renderItems();
      this.#toggleFilter(false);
    });

    document.addEventListener('click', (event) => {
      if (!this.root.contains(event.target)) this.#toggleFilter(false);
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#toggleFilter(false);
    });
  }

  #toggleFilter(force) {
    if (!this.filterMenu || !this.filterToggle) return;
    const open = force ?? this.filterMenu.hidden;
    this.filterMenu.hidden = !open;
    this.filterToggle.setAttribute('aria-expanded', String(open));
  }
}

document.querySelectorAll('[data-knr-review-list]').forEach((el) => new KnrReviewList(el));
