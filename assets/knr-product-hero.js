import { formatMoney } from '@theme/money-formatting';

const SELECTED_CLASS = 'knr-product-hero__option-value--selected';

class KnrProductHero {
  constructor(section) {
    this.section = section;
    this.variants = this.#parseVariants();
    this.variantInput = section.querySelector('[data-knr-variant-id]');
    this.priceEl = section.querySelector('[data-knr-price]');
    this.priceRow = this.priceEl?.parentElement ?? null;
    this.comparePriceEl = section.querySelector('[data-knr-compare-price]');
    this.unitPriceEl = section.querySelector('[data-knr-unit-price]');
    this.atcButton = section.querySelector('[data-knr-atc]');
    this.atcLabel = section.querySelector('[data-knr-atc-label]');
    this.ratingEl = section.querySelector('[data-knr-rating]');
    this.scoresEl = section.querySelector('[data-knr-scores]');
    this.moneyFormat = section.dataset.knrMoneyFormat || '{{amount}}';
    this.currency = section.dataset.knrCurrency || 'EUR';
    this.mockUrl = section.dataset.knrMockUrl ?? '';
    this.labels = this.#parseLabels();
    this.selectedOptions = this.#initSelectedOptions();
    this.starSvg = section.querySelector('[data-knr-star-template]')?.innerHTML ?? '';
    this.gallery = section.querySelector('[data-knr-gallery]');
    this.prevBtn = section.querySelector('[data-knr-gallery-prev]');
    this.nextBtn = section.querySelector('[data-knr-gallery-next]');
    this.lightbox = section.querySelector('[data-knr-lightbox]');
    this.lightboxImage = section.querySelector('[data-knr-lightbox-image]');
    this.lightboxClose = section.querySelector('[data-knr-lightbox-close]');
    this.reinsuranceCarousel = section.querySelector('[data-knr-reinsurance-carousel]');
    this.#bind();
    this.#bindGallery();
    this.#bindLightbox();
    this.#bindReinsuranceCarousel();
    this.#hydrateMockData();
  }

  #bindReinsuranceCarousel() {
    if (!this.reinsuranceCarousel) return;
    const steps = Array.from(this.reinsuranceCarousel.querySelectorAll('[data-knr-reinsurance-step]'));
    if (steps.length < 1) return;
    const textEl = this.reinsuranceCarousel.querySelector('[data-knr-reinsurance-text]');
    const durationMs = parseInt(this.reinsuranceCarousel.dataset.knrReinsuranceDuration ?? '4000', 10);
    this.reinsuranceCarousel.style.setProperty('--knr-stock-duration', `${durationMs}ms`);

    let current = 0;
    const tick = () => {
      const step = steps[current];
      if (textEl) textEl.textContent = step.dataset.knrReinsuranceMessage ?? '';
      // Force reflow so the width transition restarts cleanly
      void step.offsetWidth;
      step.classList.add('knr-product-hero__step--active');

      this.reinsuranceCarouselTimeout = window.setTimeout(() => {
        step.classList.remove('knr-product-hero__step--active');
        step.classList.add('knr-product-hero__step--done');
        current += 1;
        if (current >= steps.length) {
          current = 0;
          steps.forEach((s) => s.classList.remove('knr-product-hero__step--done'));
        }
        if (steps.length > 1) {
          tick();
        }
      }, durationMs);
    };

    tick();
  }

  #bindGallery() {
    if (!this.gallery) return;

    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.#scrollGallery(-1));
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.#scrollGallery(1));
    if (this.prevBtn || this.nextBtn) {
      this.gallery.addEventListener('scroll', () => this.#updateArrowState(), { passive: true });
      this.#updateArrowState();
    }
  }

  #scrollGallery(direction) {
    if (!this.gallery) return;
    const firstSlide = this.gallery.querySelector('.knr-product-hero__gallery-slide');
    const step = firstSlide?.getBoundingClientRect().width ?? this.gallery.clientWidth;
    this.gallery.scrollBy({ left: step * direction, behavior: 'smooth' });
  }

  #updateArrowState() {
    if (!this.gallery) return;
    const { scrollLeft, scrollWidth, clientWidth } = this.gallery;
    const atStart = scrollLeft <= 1;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
    if (this.prevBtn) this.prevBtn.hidden = atStart;
    if (this.nextBtn) this.nextBtn.hidden = atEnd;
  }

  #bindLightbox() {
    if (!this.lightbox || !this.lightboxImage) return;

    this.section.querySelectorAll('[data-knr-gallery-zoom]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const slide = btn.closest('.knr-product-hero__gallery-slide');
        const src = slide?.dataset.knrZoomSrc;
        const img = slide?.querySelector('img');
        if (!src) return;
        this.lightboxImage.src = src;
        this.lightboxImage.alt = img?.alt ?? '';
        this.lightbox.showModal();
      });
    });

    this.lightboxClose?.addEventListener('click', () => this.lightbox.close());
    this.lightbox.addEventListener('click', (event) => {
      if (event.target === this.lightbox) this.lightbox.close();
    });
  }

  async #hydrateMockData() {
    if (!this.mockUrl) return;
    try {
      const response = await fetch(this.mockUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      this.#renderRating(data.rating);
      this.#renderScores(data.scores);
    } catch (err) {
      /* mock data optional — fail silently */
    }
  }

  #renderRating(rating) {
    if (!this.ratingEl || !rating) return;
    const rounded = Math.round(rating.value ?? 0);
    const stars = Array.from({ length: 5 }, (_, i) => {
      const off = i + 1 > rounded ? ' knr-product-hero__star--off' : '';
      return `<span class="knr-product-hero__star${off}">${this.starSvg}</span>`;
    }).join('');
    this.ratingEl.innerHTML = `
      <div class="knr-product-hero__rating-summary">
        <div class="knr-product-hero__stars">${stars}</div>
        <span class="knr-product-hero__rating-value">${rating.value}</span>
      </div>
      <span class="knr-product-hero__rating-dot" aria-hidden="true"></span>
      <span class="knr-product-hero__rating-count">${rating.count} ${rating.label ?? ''}</span>
    `;
    this.ratingEl.hidden = false;
  }

  #renderScores(scores) {
    if (!this.scoresEl || !Array.isArray(scores) || scores.length === 0) return;
    const parts = scores.map((score) => {
      return `<span class="knr-product-hero__score"><strong>${score.label}</strong> ${score.value}</span>`;
    });
    const html = parts.join('<span class="knr-product-hero__score-dot" aria-hidden="true"></span>');
    this.scoresEl.innerHTML = html;
    this.scoresEl.hidden = false;
  }

  #parseVariants() {
    const script = this.section.querySelector('[data-knr-variants]');
    if (!script) return [];
    try {
      return JSON.parse(script.textContent ?? '[]');
    } catch (err) {
      return [];
    }
  }

  #parseLabels() {
    try {
      return JSON.parse(this.section.dataset.knrLabels ?? '{}');
    } catch (err) {
      return {};
    }
  }

  #initSelectedOptions() {
    const opts = [];
    this.section.querySelectorAll(`[data-knr-option-value].${SELECTED_CLASS}`).forEach((btn) => {
      const idx = parseInt(btn.dataset.knrOptionIndex, 10);
      if (Number.isInteger(idx)) opts[idx - 1] = btn.dataset.knrOptionValue;
    });
    return opts;
  }

  #bind() {
    this.section.querySelectorAll('[data-knr-option-value]').forEach((btn) => {
      btn.addEventListener('click', () => this.#onSelect(btn));
    });
  }

  #onSelect(btn) {
    const idx = parseInt(btn.dataset.knrOptionIndex, 10);
    if (!Number.isInteger(idx)) return;

    this.section
      .querySelectorAll(`[data-knr-option-index="${idx}"]`)
      .forEach((sibling) => {
        sibling.classList.remove(SELECTED_CLASS);
        sibling.setAttribute('aria-checked', 'false');
      });
    btn.classList.add(SELECTED_CLASS);
    btn.setAttribute('aria-checked', 'true');

    this.selectedOptions[idx - 1] = btn.dataset.knrOptionValue;
    const variant = this.#findVariant();
    this.#applyVariant(variant);
  }

  #findVariant() {
    return this.variants.find((variant) => {
      for (let i = 0; i < this.selectedOptions.length; i++) {
        const selected = this.selectedOptions[i];
        if (selected && variant[`option${i + 1}`] !== selected) return false;
      }
      return true;
    });
  }

  #applyVariant(variant) {
    if (!variant) {
      if (this.variantInput) this.variantInput.value = '';
      this.#setAtcState(false, this.labels.unavailable);
      return;
    }

    if (this.variantInput) this.variantInput.value = String(variant.id);

    this.#updatePrice(variant);
    this.#updateUnitPrice(variant);
    this.#setAtcState(variant.available, variant.available ? this.labels.add : this.labels.sold_out);
  }

  #updatePrice(variant) {
    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(variant.price, this.moneyFormat, this.currency);
    }

    const hasCompare = variant.compare_at_price && variant.compare_at_price > variant.price;
    if (hasCompare) {
      if (!this.comparePriceEl && this.priceEl) {
        const s = document.createElement('s');
        s.className = 'knr-product-hero__compare-price';
        s.dataset.knrComparePrice = '';
        this.priceEl.after(s);
        this.comparePriceEl = s;
      }
      if (this.comparePriceEl) {
        this.comparePriceEl.textContent = formatMoney(variant.compare_at_price, this.moneyFormat, this.currency);
      }
    } else if (this.comparePriceEl) {
      this.comparePriceEl.remove();
      this.comparePriceEl = null;
    }
  }

  #updateUnitPrice(variant) {
    if (!this.unitPriceEl) return;
    const measurement = variant.unit_price_measurement;
    if (!measurement || !variant.unit_price) {
      this.unitPriceEl.hidden = true;
      return;
    }
    const price = formatMoney(variant.unit_price, this.moneyFormat, this.currency);
    this.unitPriceEl.textContent = `${price} / ${measurement.reference_value}${measurement.reference_unit}`;
    this.unitPriceEl.hidden = false;
  }

  #setAtcState(enabled, label) {
    if (!this.atcButton) return;
    this.atcButton.disabled = !enabled;
    if (this.atcLabel && label) this.atcLabel.textContent = label;
  }
}

document.querySelectorAll('.knr-product-hero').forEach((section) => new KnrProductHero(section));
