/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}", "./DashboardOftalmoplus.jsx"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 10px 30px rgba(2, 8, 23, 0.06)",
      },
      colors: {
        brand: {
          navy: "#0A2540",
          cyan: "#00A896",
        },
      },
    },
  },
  plugins: [],
};
