import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';

const SOURCE = 'knr-cart-rewards';

/**
 * Drives the gamified cart drawer interactions without page reloads:
 * - sample selection (add/remove, capped by the unlocked tier),
 * - automatic add/removal of the gift product when its tier is crossed,
 * - sample cleanup when the qualifying subtotal drops below the samples tier.
 *
 * The "free" pricing itself is enforced by native Shopify automatic discounts
 * (free shipping + Buy X Get Y); this controller only manages cart lines and
 * lets the native Sections Rendering API re-render the bar/messages server-side.
 *
 * Tier thresholds are read from the freshly rendered DOM (config, stable), while
 * the qualifying subtotal is recomputed from /cart.js (authoritative state),
 * excluding lines flagged `_sample` / `_gift`.
 */
class KnrCartRewards extends Component {
  /** @type {boolean} Serializes cart operations to avoid overlapping requests. */
  #busy = false;

  /** @type {Element | null} Element focused before the chooser opened. */
  #trigger = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKeydown);
    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
  }

  /** @returns {string | undefined} */
  get sectionId() {
    return this.closest('[data-section-id]')?.dataset.sectionId;
  }

  /**
   * The stable drawer host (outside the re-rendered section), so the chooser's
   * open state survives the live morph when a sample is added/removed.
   * @returns {HTMLElement | null}
   */
  get drawer() {
    return this.closest('.knr-cart-drawer');
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target.closest('[data-samples-open]')) {
      this.#openChooser();
      return;
    }
    if (target.closest('[data-samples-close]')) {
      this.#closeChooser();
      return;
    }

    const toggle = target.closest('[data-sample-toggle]');
    if (!(toggle instanceof HTMLButtonElement) || toggle.disabled) return;

    const item = toggle.closest('[data-sample]');
    const variantId = item instanceof HTMLElement ? item.dataset.variantId : undefined;
    if (!variantId) return;

    const isSelected = item?.classList.contains('is-selected');
    if (this.#busy) return;

    if (isSelected) {
      this.#run(() => this.#removeFlagged(variantId, '_sample'));
    } else {
      this.#run(() => this.#add(variantId, { _sample: 'true' }));
    }
  };

  /** Reconcile gift + sample cap whenever the cart changes elsewhere. */
  #onCartUpdate = (event) => {
    if (event instanceof CustomEvent && event.detail?.data?.source === SOURCE) return;
    if (this.#busy) return;
    this.#run(() => this.#reconcile());
  };

  /** Close the chooser on Escape instead of dismissing the whole drawer. */
  #onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    if (!this.drawer?.classList.contains('is-choosing-samples')) return;
    event.preventDefault();
    event.stopPropagation();
    this.#closeChooser();
  };

  #openChooser() {
    const drawer = this.drawer;
    if (!drawer) return;
    this.#trigger = this.querySelector('[data-samples-open]');
    drawer.classList.add('is-choosing-samples');
    this.querySelector('[data-samples-screen] [data-samples-close]')?.focus();
  }

  #closeChooser() {
    const drawer = this.drawer;
    if (!drawer) return;
    drawer.classList.remove('is-choosing-samples');
    const trigger = this.#trigger ?? this.querySelector('[data-samples-open]');
    if (trigger instanceof HTMLElement) trigger.focus();
  }

  /**
   * Wraps an async cart operation with the busy lock and a final re-render.
   * @param {() => Promise<boolean>} operation - Resolves true if the cart changed.
   */
  async #run(operation) {
    this.#busy = true;
    try {
      const changed = await operation();
      if (changed) await this.#announce();
    } catch (error) {
      console.error('[knr-cart-rewards]', error);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Adds the gift when its tier is reached and removes it (or excess samples)
   * when the qualifying subtotal drops below the relevant threshold.
   * @returns {Promise<boolean>}
   */
  async #reconcile() {
    const cart = await this.#getCart();
    const giftTier = Number(this.dataset.giftTier) || 0;
    const giftVariant = this.dataset.giftVariant;
    const samplesTier = Number(this.dataset.samplesTier) || 0;

    let qualifying = 0;
    let giftKey = null;
    const sampleKeys = [];
    for (const item of cart.items) {
      if (item.properties?._sample) {
        sampleKeys.push(item.key);
        continue;
      }
      if (item.properties?._gift) {
        giftKey = item.key;
        continue;
      }
      qualifying += item.final_line_price;
    }

    if (giftTier > 0 && giftVariant) {
      if (qualifying >= giftTier && !giftKey) {
        await this.#add(giftVariant, { _gift: 'true' });
        return true;
      }
      if (qualifying < giftTier && giftKey) {
        await this.#change(giftKey, 0);
        return true;
      }
    }

    if (samplesTier > 0 && qualifying < samplesTier && sampleKeys.length) {
      for (const key of sampleKeys) await this.#change(key, 0);
      return true;
    }

    return false;
  }

  /** @returns {Promise<{ items: Array<any> }>} */
  async #getCart() {
    const response = await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } });
    return response.json();
  }

  /**
   * @param {string} id - Variant id.
   * @param {Record<string, string>} properties - Line item properties (e.g. `_sample`).
   */
  async #add(id, properties) {
    const body = JSON.stringify({
      items: [{ id, quantity: 1, properties }],
      sections: this.sectionId,
      sections_url: window.location.pathname,
    });
    await fetch(Theme.routes.cart_add_url, fetchConfig('javascript', { body }));
  }

  /**
   * @param {string} line - Line item key.
   * @param {number} quantity - New quantity (0 removes).
   */
  async #change(line, quantity) {
    const body = JSON.stringify({
      id: line,
      quantity,
      sections: this.sectionId,
      sections_url: window.location.pathname,
    });
    await fetch(Theme.routes.cart_change_url, fetchConfig('javascript', { body }));
  }

  /**
   * Removes every line matching a variant id and flag (used for sample toggles).
   * @param {string} variantId
   * @param {string} flag - Property name, e.g. `_sample`.
   * @returns {Promise<boolean>}
   */
  async #removeFlagged(variantId, flag) {
    const cart = await this.#getCart();
    const keys = cart.items
      .filter((item) => String(item.variant_id) === String(variantId) && item.properties?.[flag])
      .map((item) => item.key);
    for (const key of keys) await this.#change(key, 0);
    return keys.length > 0;
  }

  /**
   * Notifies the rest of the theme so the section, cart bubble and header count
   * re-render. The native cart-items-component re-renders the drawer section.
   */
  async #announce() {
    const cart = await this.#getCart();
    this.dispatchEvent(
      new CartUpdateEvent(cart, this.id || SOURCE, {
        source: SOURCE,
        itemCount: cart.item_count,
      })
    );
  }
}

if (!customElements.get('knr-cart-rewards')) {
  customElements.define('knr-cart-rewards', KnrCartRewards);
}
