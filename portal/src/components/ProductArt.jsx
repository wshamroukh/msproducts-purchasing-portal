// Renders a product image, or a generated illustration when the product has no image URL.
const ICONS = {
  laptop: <><rect x="4" y="5" width="16" height="10" rx="1" /><path d="M2 19h20" /></>,
  tablet: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M11 18h2" /></>,
  mouse: <><rect x="7" y="3" width="10" height="18" rx="5" /><path d="M12 7v3" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  pen: <><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></>,
  headphones: <><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="2" y="14" width="5" height="7" rx="1" /><rect x="17" y="14" width="5" height="7" rx="1" /></>,
  dock: <><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 13h2M15 13h2" /></>,
  speaker: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  webcam: <><circle cx="12" cy="10" r="6" /><circle cx="12" cy="10" r="2" /><path d="M8 21h8M12 16v5" /></>,
  display: <><rect x="2" y="4" width="20" height="13" rx="1" /><path d="M8 21h8M12 17v4" /></>,
  console: <><rect x="7" y="2" width="10" height="20" rx="1.5" /><circle cx="12" cy="6" r="1.5" /></>,
  power: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  grid: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></>,
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z" />,
  code: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  sparkle: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
  box: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
};

const RULES = [
  [/pen\b/i, 'pen'], [/keyboard/i, 'keyboard'], [/mouse/i, 'mouse'], [/headphone/i, 'headphones'],
  [/dock/i, 'dock'], [/speaker/i, 'speaker'], [/webcam|camera/i, 'webcam'], [/power|charger/i, 'power'],
  [/hub|monitor|display/i, 'display'], [/xbox|console/i, 'console'], [/laptop|book/i, 'laptop'],
  [/surface (pro|go)|tablet/i, 'tablet'], [/copilot|\bai\b/i, 'sparkle'], [/visual studio|github/i, 'code'],
  [/sql|server|azure/i, 'database'], [/365|teams|visio|project|exchange|sharepoint/i, 'cloud'], [/windows|office/i, 'grid'],
];

const CATEGORY_STYLE = {
  Hardware: { from: '#0067b8', to: '#50e6ff', fallback: 'laptop' },
  Software: { from: '#5c2d91', to: '#d16bd8', fallback: 'grid' },
  Accessories: { from: '#0b6a0b', to: '#9bd84a', fallback: 'box' },
};

export function iconFor(name = '', category = '') {
  const rule = RULES.find(([re]) => re.test(name));
  return rule ? rule[1] : (CATEGORY_STYLE[category] || {}).fallback || 'box';
}

export default function ProductArt({ product, size = 'md' }) {
  if (product.ImageUrl) {
    return (
      <div className={`art art-${size} art-img`}>
        <img src={product.ImageUrl} alt={product.Name} loading="lazy" />
      </div>
    );
  }
  const style = CATEGORY_STYLE[product.Category] || { from: '#444', to: '#999' };
  return (
    <div className={`art art-${size}`} style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[iconFor(product.Name || product.ProductName, product.Category)]}
      </svg>
    </div>
  );
}
