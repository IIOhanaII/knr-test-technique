/* KNR footer — auto-submit the country/language selectors on change. */
class KnrFooterLocalization extends HTMLElement {
  connectedCallback() {
    this.querySelectorAll('select').forEach((select) => {
      select.addEventListener('change', () => {
        select.closest('form')?.submit();
      });
    });
  }
}

if (!customElements.get('knr-footer-localization')) {
  customElements.define('knr-footer-localization', KnrFooterLocalization);
}
