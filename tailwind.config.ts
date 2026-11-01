import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './content/**/*.mdx', './public/**/*.svg'],
  theme: {
    extend: {
      colors: {
        slate: { 50: '#f6f8f7', 100: '#eef2ef', 200: '#e2e9e5', 300: '#c8d2cb', 400: '#8a9991', 500: '#738078', 600: '#56645b', 700: '#3c4b42', 800: '#29382f', 900: '#1d2925' },
        emerald: { 50: '#eff8f4', 100: '#deeee5', 200: '#b9ddca', 500: '#269879', 600: '#16886b', 700: '#137258', 800: '#165b49', 900: '#164a3c' },
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [],
} satisfies Config;
