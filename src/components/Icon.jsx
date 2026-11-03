const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  history: 'M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9h4.5',
  crown: 'M3 8l4.5 3L12 5l4.5 6L21 8l-1.7 10H4.7L3 8z',
  user: 'M20 21v-1.5a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5V21M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12l16-8-6 16-2.6-6.4L4 12z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  refresh: 'M20 11a8 8 0 1 0-2.4 6M20 4v7h-7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  speaker: 'M4 10v4h3l4 4V6L8 10H4zM16 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  translate: 'M3 6h9M7.5 6v-2M9.5 6c0 4-3 7-6 8M6 10c1 2.5 3 4 5.5 4.5M13 20l4-11 4 11M14.5 16h5',
  chat: 'M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18.5 15l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z',
  download: 'M12 4v11M7.5 11l4.5 4.5L16.5 11M4 20h16',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5h3v14H9zM15 5h3v14h-3z',
  check: 'M4 12.5 9.5 18 20 6.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  logout: 'M15 4h4v16h-4M11 8l-4 4 4 4M3 12h9',
  brain: 'M12 5a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8M12 5a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8M12 5v14',
  shield: 'M12 3l8 3v6c0 4.5-3.3 7.8-8 9-4.7-1.2-8-4.5-8-9V6l8-3z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
  pen: 'M4 20l4-1 10-10-3-3L5 16l-1 4zM14.5 5.5 18.5 9.5',
  upload: 'M12 16V5M8 9l4-4 4 4M4 20h16',
  star: 'M12 4l2.5 5.2 5.5.8-4 4 1 5.5-5-2.7-5 2.7 1-5.5-4-4 5.5-.8L12 4z',
  chevron: 'M9 6l6 6-6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5h.01',
  alert: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
};

export function Icon({ name, size = 20, className = '', strokeWidth = 1.7, filled = false }) {
  const d = PATHS[name] || PATHS.sparkles;
  return (
    <svg
      className={`ico ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export default Icon;
