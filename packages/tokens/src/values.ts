export interface ColorScheme {
  hue: {
    accent: string;
    ok: string;
    bad: string;
    warn: string;
    purple: string;
    cyan: string;
  };
  text: {
    fg: string;
    muted: string;
    mutedText: string;
    accentText: string;
    redText: string;
  };
  surface: {
    chrome: string;
    bg: string;
    panel: string;
    card: string;
  };
  line: {
    border: string;
    soft: string;
    grid: string;
  };
  dot: {
    ok: string;
    warn: string;
    bad: string;
  };
  wash: string;
}

export interface Tokens {
  light: ColorScheme;
  dark: ColorScheme;
  font: {
    mono: string;
    sans: string;
    baseSize: string;
    lineHeight: string;
  };
}

export const TOKENS: Tokens = {
  light: {
    hue: {
      accent: '#2e7de9',
      ok: '#587539',
      bad: '#f52a65',
      warn: '#8c6c3e',
      purple: '#7847bd',
      cyan: '#007197',
    },
    text: {
      // Canonical 6-digit spelling; CSS_TEXT below overrides the shipped
      // spelling back to the 3-digit `#222`.
      fg: '#222222',
      muted: '#8990b3',
      mutedText: '#565d80',
      accentText: '#1c5fbf',
      redText: '#c8214f',
    },
    surface: {
      chrome: '#f3f4f7',
      bg: '#f7f8fa',
      panel: '#fbfbfc',
      card: '#ffffff',
    },
    line: {
      border: '#c8cad6',
      soft: '#d5d7e2',
      grid: 'rgba(52, 59, 88, 0.05)',
    },
    dot: {
      ok: '#1f9d3a',
      warn: '#e08a00',
      bad: '#e5153f',
    },
    wash: '10%',
  },
  dark: {
    hue: {
      accent: '#7aa2f7',
      ok: '#9ece6a',
      bad: '#f7768e',
      warn: '#e0af68',
      purple: '#bb9af7',
      cyan: '#7dcfff',
    },
    text: {
      fg: '#e3e7f6',
      muted: '#7e86ad',
      mutedText: '#969ec2',
      accentText: '#7aa2f7',
      redText: '#f7768e',
    },
    surface: {
      chrome: '#232a47',
      bg: '#16161e',
      panel: '#232a47',
      card: '#2c3352',
    },
    line: {
      border: '#3b4261',
      soft: '#313853',
      grid: 'rgba(122, 162, 247, 0.06)',
    },
    dot: {
      ok: '#4ade5b',
      warn: '#ffbb3d',
      bad: '#ff5c72',
    },
    wash: '15%',
  },
  font: {
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    baseSize: '13.5px',
    lineHeight: '1.55',
  },
};

// Dot-path (e.g. 'light.text.fg') into TOKENS, keyed to the exact CSS text an
// emitter must print in place of the six-digit canonical value at that path.
// Emitters print CSS_TEXT[path] ?? value, so shipped CSS keeps its historical
// spelling while every consumer of TOKENS itself does color math in six-digit
// hex.
export const CSS_TEXT: Record<string, string> = {
  'light.text.fg': '#222',
};
