import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';
import { morphSection, sectionRenderer } from '@theme/section-renderer';

const SOURCE = 'knr-cart-rewards';

// Cart attribute marking the gift as declined, so it isn't re-added while the
// cart stays above its tier (cleared when the cart drops back below). A cart
// attribute (vs sessionStorage) survives reloads and storage-partitioned
// contexts like the theme editor preview iframe.
const GIFT_DISMISS_ATTR = '_gift_dismissed';

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

  /** @type {Element | null} Stable drawer the rewards UI is delegated from. */
  #root = null;

  /** @type {Record<string, string> | null} Rendered sections from the last mutation. */
  #sections = null;

  /** @type {HTMLElement | null} Sample tile showing the loading state, if any. */
  #loadingItem = null;

  /** @type {boolean} Highlight the gift line once after it is auto-added. */
  #revealGift = false;

  connectedCallback() {
    super.connectedCallback();
    // The rewards UI is spread across the drawer (samples card lives in the
    // footer, the chooser is a full overlay), so delegate from the stable
    // drawer rather than from `this`.
    this.#root = this.drawer ?? this;
    this.#root.addEventListener('click', this.#onClick);
    this.#root.addEventListener('keydown', this.#onKeydown);
    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#root?.removeEventListener('click', this.#onClick);
    this.#root?.removeEventListener('keydown', this.#onKeydown);
    document.removeEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate);
    this.#root = null;
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

    const removeBtn = target.closest('[data-line-remove]');
    if (removeBtn instanceof HTMLElement) {
      if (this.#busy) return;
      const row = removeBtn.closest('[data-key]');
      const key = row instanceof HTMLElement ? row.dataset.key : undefined;
      if (!key) return;
      const isGift = row instanceof HTMLElement && row.hasAttribute('data-gift-line');
      if (row instanceof HTMLElement) {
        this.#loadingItem = row;
        row.classList.add('is-loading');
        row.setAttribute('aria-busy', 'true');
      }
      this.#run(() => this.#removeLine(key, isGift));
      return;
    }

    const toggle = target.closest('[data-sample-toggle]');
    if (!(toggle instanceof HTMLButtonElement) || toggle.disabled) return;

    const item = toggle.closest('[data-sample]');
    const variantId = item instanceof HTMLElement ? item.dataset.variantId : undefined;
    if (!variantId) return;

    const isSelected = item?.classList.contains('is-selected');
    if (this.#busy) return;

    // Surfacing a spinner on the tile: the add/remove round-trip + re-render is
    // slow enough to feel broken without immediate feedback.
    if (item instanceof HTMLElement) {
      this.#loadingItem = item;
      item.classList.add('is-loading');
      item.setAttribute('aria-busy', 'true');
    }

    if (isSelected) {
      this.#run(() => this.#removeFlagged(variantId, '_sample'));
    } else {
      this.#run(() => this.#add(variantId, { _sample: 'true' }));
    }
  };

  /** Reconcile gift + sample cap whenever the cart changes elsewhere. */
  #onCartUpdate = (event) => {
    const source = event instanceof CustomEvent ? event.detail?.data?.source : undefined;
    if (source === SOURCE) return;
    if (this.#busy) return;
    this.#run(async () => {
      const changed = await this.#reconcile();
      // A reconcile mutation already triggers a re-render via #run → #announce.
      // Otherwise, refresh the drawer ourselves for external additions (e.g. the
      // product page): the native Sections Rendering morph is unreliable for a
      // header-group section, so line items and the count bubble stay stale.
      // The in-drawer cart-items-component already morphs its own quantity edits.
      if (!changed && source !== 'cart-items-component') {
        await this.#refresh();
      }
      return changed;
    });
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
    this.#trigger = drawer.querySelector('[data-samples-open]');
    drawer.classList.add('is-choosing-samples');
    drawer.querySelector('[data-samples-screen] [data-samples-close]')?.focus();
  }

  #closeChooser() {
    const drawer = this.drawer;
    if (!drawer) return;
    drawer.classList.remove('is-choosing-samples');
    const trigger = this.#trigger ?? drawer.querySelector('[data-samples-open]');
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
      // Clear the tile spinner. After a successful toggle the morph already
      // re-rendered the tile without it; this covers the error path.
      this.#loadingItem?.classList.remove('is-loading');
      this.#loadingItem?.removeAttribute('aria-busy');
      this.#loadingItem = null;
    }
  }

  /**
   * Re-renders the drawer section in place (count bubble + line items) without a
   * cart mutation. Uses hydration mode so the open dialog and the samples chooser
   * overlay state (held on the parent component) are left untouched.
   */
  async #refresh() {
    const id = this.sectionId;
    if (!id) return;
    await sectionRenderer.renderSection(id, { cache: false, mode: 'hydration' });
  }

  /** Plays a one-shot highlight on the gift line freshly added at the threshold. */
  #revealGiftLine() {
    const line = this.#root?.querySelector('[data-gift-line]');
    if (!(line instanceof HTMLElement)) return;
    line.classList.add('is-revealed');
    line.addEventListener('animationend', () => line.classList.remove('is-revealed'), { once: true });
  }

  /**
   * Persists whether the user declined the gift, as a cart attribute.
   * @param {boolean} value
   */
  async #setGiftDismissed(value) {
    const body = JSON.stringify({
      attributes: { [GIFT_DISMISS_ATTR]: value ? 'true' : '' },
      sections: this.sectionId,
      sections_url: window.location.pathname,
    });
    const response = await fetch(Theme.routes.cart_update_url, fetchConfig('json', { body }));
    const result = await response.json();
    if (result.sections) this.#sections = result.sections;
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
    const giftDismissed = cart.attributes?.[GIFT_DISMISS_ATTR] === 'true';

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

    // Run every applicable mutation in a single pass (line keys stay valid across
    // removals), so dropping below several tiers at once doesn't strand a line.
    let changed = false;

    if (giftTier > 0 && giftVariant) {
      if (qualifying < giftTier) {
        // Below the tier: clear any decline (re-offer on the next crossing) and
        // pull the gift if it is still in the cart.
        if (giftDismissed) await this.#setGiftDismissed(false);
        if (giftKey) {
          await this.#change(giftKey, 0);
          changed = true;
        }
      } else if (!giftKey && !giftDismissed) {
        this.#revealGift = true;
        await this.#add(giftVariant, { _gift: 'true' });
        changed = true;
      }
    }

    if (samplesTier > 0 && qualifying < samplesTier && sampleKeys.length) {
      for (const key of sampleKeys) await this.#change(key, 0);
      changed = true;
    }

    return changed;
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
    const response = await fetch(Theme.routes.cart_add_url, fetchConfig('json', { body }));
    const result = await response.json();
    if (result.sections) this.#sections = result.sections;
    return true;
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
    const response = await fetch(Theme.routes.cart_change_url, fetchConfig('json', { body }));
    const result = await response.json();
    if (result.sections) this.#sections = result.sections;
  }

  /**
   * Removes a paid cart line, then reconciles rewards (drops the gift/samples if
   * the qualifying subtotal fell below their tiers). Routed through our own
   * hydration-safe re-render so the drawer stays open with a loader — the native
   * line remove cascades into a full re-render that re-animates the drawer.
   * @param {string} key - Line item key.
   * @param {boolean} [isGift] - Whether the removed line is the free gift.
   * @returns {Promise<boolean>}
   */
  async #removeLine(key, isGift = false) {
    // Removing the gift is a deliberate decline — persist it (cart attribute)
    // before reconciling so the gift isn't re-added while still above the tier.
    if (isGift) await this.#setGiftDismissed(true);
    await this.#change(key, 0);
    await this.#reconcile();
    return true;
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
    const id = this.sectionId;
    const cart = await this.#getCart();
    // Re-render the drawer in place from the section HTML captured during the
    // mutations. Hydration mode only morphs the keyed inner, leaving the
    // <dialog> and the chooser overlay state (held on the parent component)
    // untouched — so adding/removing samples or lines never re-animates or
    // closes the open drawer, and the chooser keeps the user on the grid.
    const html = id ? this.#sections?.[id] : null;
    if (id && html) {
      await morphSection(id, html, { mode: 'hydration' });
    } else {
      await this.#refresh();
    }
    this.#sections = null;
    if (this.#revealGift) {
      this.#revealGift = false;
      this.#revealGiftLine();
    }
    // Notify the rest of the theme (header count bubble, product-form quantity
    // sync). Dispatched from the cart-items-component so its own listener bails
    // (event.target === this) instead of full-morphing the open drawer.
    const host = this.closest('cart-items-component') ?? this;
    host.dispatchEvent(
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
