class KnrReviews {
  constructor(root) {
    this.root = root;
    this.track = root.querySelector('[data-knr-reviews-track]');
    this.prevBtn = root.querySelector('[data-knr-reviews-prev]');
    this.nextBtn = root.querySelector('[data-knr-reviews-next]');
    this.starSvg = root.querySelector('[data-knr-review-star]')?.innerHTML ?? '';
    this.mockUrl = root.dataset.knrMockUrl;
    this.index = 0;
    this.reviews = [];
    this.#load();
  }

  async #load() {
    if (!this.mockUrl || !this.track) {
      this.root.hidden = true;
      return;
    }
    try {
      const response = await fetch(this.mockUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        this.root.hidden = true;
        return;
      }
      const data = await response.json();
      this.reviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (this.reviews.length === 0) {
        this.root.hidden = true;
        return;
      }
      this.#render();
      this.#bind();
    } catch (err) {
      this.root.hidden = true;
    }
  }

  #stars(count) {
    return Array.from({ length: 5 }, (_, i) => {
      const off = i + 1 > count ? ' knr-reviews__star--off' : '';
      return `<span class="knr-reviews__star${off}">${this.starSvg}</span>`;
    }).join('');
  }

  #escape(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  #render() {
    this.track.innerHTML = this.reviews
      .map((review, i) => {
        const rating = Math.round(review.rating ?? 5);
        return `
          <article class="knr-reviews__item" data-knr-review-item${i === this.index ? '' : ' hidden'}>
            <div class="knr-reviews__rating">
              <span class="knr-reviews__stars">${this.#stars(rating)}</span>
              <span class="knr-reviews__author">${this.#escape(review.author)}</span>
            </div>
            <p class="knr-reviews__quote">${this.#escape(review.text)}</p>
          </article>`;
      })
      .join('');
    this.items = Array.from(this.track.querySelectorAll('[data-knr-review-item]'));
    this.#updateArrows();
  }

  #bind() {
    this.prevBtn?.addEventListener('click', () => this.#go(-1));
    this.nextBtn?.addEventListener('click', () => this.#go(1));
  }

  #go(direction) {
    const total = this.reviews.length;
    this.index = (this.index + direction + total) % total;
    this.items.forEach((item, i) => {
      item.hidden = i !== this.index;
    });
  }

  #updateArrows() {
    const single = this.reviews.length <= 1;
    if (this.prevBtn) this.prevBtn.hidden = single;
    if (this.nextBtn) this.nextBtn.hidden = single;
  }
}

document.querySelectorAll('[data-knr-reviews]').forEach((el) => new KnrReviews(el));
