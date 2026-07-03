import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        excellent: { bg: '#EAF3DE', text: '#3B6D11', stripe: '#639922' },
        good:      { bg: '#FAEEDA', text: '#854F0B', stripe: '#BA7517' },
        average:   { bg: '#FAECE7', text: '#993C1D', stripe: '#D85A30' },
        bad:       { bg: '#FCEBEB', text: '#A32D2D', stripe: '#E24B4A' },
      },
    },
  },
  plugins: [],
}

export default config
