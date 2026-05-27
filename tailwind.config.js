/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mango: {
          50:  '#fffbeb',
          100: '#fef3c7',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#F5C518',
          600: '#d97706',
          700: '#b45309',
        },
        warrior: {
          50:  '#fff1f2',
          100: '#ffe4e6',
          400: '#fb7185',
          500: '#E63946',
          600: '#dc2626',
          700: '#b91c1c',
        },
      },
    },
  },
  plugins: [],
}