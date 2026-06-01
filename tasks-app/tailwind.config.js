/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        blox: {
          bg:      '#0F0F23',
          card:    '#16213E',
          card2:   '#1A1A3E',
          border:  '#2D2B5A',
          red:     '#FF3333',
          blue:    '#00A2FF',
          gold:    '#FFD700',
          green:   '#00D68F',
          pink:    '#FF6B9D',
          purple:  '#9B59B6',
          text:    '#FFFFFF',
          muted:   '#8892B0',
        },
      },
      fontFamily: {
        fredoka: ['Fredoka', 'sans-serif'],
        nunito:  ['Nunito', 'sans-serif'],
      },
      boxShadow: {
        'glow-blue':   '0 0 20px rgba(0, 162, 255, 0.4)',
        'glow-gold':   '0 0 20px rgba(255, 215, 0, 0.4)',
        'glow-red':    '0 0 20px rgba(255, 51, 51, 0.4)',
        'glow-green':  '0 0 20px rgba(0, 214, 143, 0.4)',
        'glow-pink':   '0 0 20px rgba(255, 107, 157, 0.4)',
        'card':        '0 4px 24px rgba(0,0,0,0.4)',
      },
      animation: {
        'glow-pulse':  'glowPulse 2s ease-in-out infinite',
        'coin-pop':    'coinPop 0.5s ease-out forwards',
        'bounce-in':   'bounceIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275)',
        'float':       'float 3s ease-in-out infinite',
        'shake':       'shake 0.4s ease-in-out',
      },
      keyframes: {
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(0,162,255,0.3)' },
          '50%':      { boxShadow: '0 0 30px rgba(0,162,255,0.7)' },
        },
        coinPop: {
          '0%':   { transform: 'scale(0) translateY(0)', opacity: 1 },
          '80%':  { transform: 'scale(1.2) translateY(-20px)', opacity: 1 },
          '100%': { transform: 'scale(1) translateY(-30px)', opacity: 0 },
        },
        bounceIn: {
          '0%':   { transform: 'scale(0.8)', opacity: 0 },
          '100%': { transform: 'scale(1)',   opacity: 1 },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%':      { transform: 'translateX(-6px)' },
          '40%':      { transform: 'translateX(6px)' },
          '60%':      { transform: 'translateX(-4px)' },
          '80%':      { transform: 'translateX(4px)' },
        },
      },
    },
  },
  plugins: [],
}
