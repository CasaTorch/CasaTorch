/* HouseOS card for Home Assistant dashboards (install with HACS as a "Dashboard" repository).
 *   type: custom:houseos-card
 *   url: http://homeassistant.local:8090   # where HouseOS runs (the add-on uses port 8090)
 *   view: home | panel | 3d | ask           # optional, default home
 *   height: 600                             # optional, pixels
 *   title: My house                         # optional
 * It shows HouseOS inside the card. If Home Assistant is opened over https (Nabu Casa or a
 * reverse proxy), HouseOS must be reachable over https too, or the browser blocks it. */
const PATHS = { home: '/', panel: '/?panel=1', '3d': '/floorplan.html?embed=1', ask: '/?panel=1#ask' };
class HouseOSCard extends HTMLElement {
  setConfig(c) {
    if (!c || !c.url) throw new Error('Set url: to your HouseOS address, e.g. http://homeassistant.local:8090');
    if (c.view && !PATHS[c.view]) throw new Error('view: must be home, panel, 3d or ask');
    this._c = { view: 'home', height: 600, ...c };
    this._render();
  }
  set hass(_h) { /* HouseOS talks to Home Assistant itself */ }
  getCardSize() { return Math.ceil((Number(this._c?.height) || 600) / 50); }
  getGridOptions() { return { columns: 12, rows: Math.ceil((Number(this._c?.height) || 600) / 56), min_rows: 4 }; }
  static getStubConfig() { return { url: 'http://homeassistant.local:8090', view: '3d', height: 600 }; }
  _render() {
    const c = this._c, src = c.url.replace(/\/+$/, '') + PATHS[c.view];
    const card = document.createElement('ha-card');
    if (c.title) card.setAttribute('header', c.title);
    if (location.protocol === 'https:' && src.startsWith('http:')) {
      const p = document.createElement('div'); p.style.padding = '16px';
      p.textContent = 'This dashboard is open over https, so the browser blocks HouseOS at an http:// address. Open Home Assistant on your home network (http://homeassistant.local:8123), or give HouseOS an https address.';
      card.append(p);
    } else {
      const f = document.createElement('iframe');
      f.src = src; f.title = 'HouseOS'; f.allow = 'fullscreen; screen-wake-lock';
      f.style.cssText = `display:block;width:100%;height:${Number(c.height) || 600}px;border:0;border-radius:var(--ha-card-border-radius, 12px)`;
      card.append(f);
    }
    this.replaceChildren(card);
  }
}
if (!customElements.get('houseos-card')) customElements.define('houseos-card', HouseOSCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'houseos-card', name: 'HouseOS', description: 'Your HouseOS dashboard, wall panel, 3D home or AI assistant inside a Home Assistant dashboard.', preview: false });
