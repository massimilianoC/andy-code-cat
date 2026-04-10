import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./lib/**/*.{js,ts,jsx,tsx}",
    ],
    // Disable Tailwind's CSS reset — the existing dark-theme globals.css
    // provides base styles and must not be overridden.
    corePlugins: { preflight: false },
    theme: {
        extend: {
            colors: {
                // Dark-theme palette keyed to the existing CSS design tokens
                background: "#0f1117",
                foreground: "#e8eaf0",
                card: {
                    DEFAULT: "#1a1d27",
                    foreground: "#e8eaf0",
                },
                popover: {
                    DEFAULT: "#1a1d27",
                    foreground: "#e8eaf0",
                },
                primary: {
                    DEFAULT: "#6366f1",
                    foreground: "#ffffff",
                },
                secondary: {
                    DEFAULT: "#22263a",
                    foreground: "#7c82a0",
                },
                muted: {
                    DEFAULT: "#22263a",
                    foreground: "#7c82a0",
                },
                accent: {
                    DEFAULT: "#818cf8",
                    foreground: "#0f1117",
                },
                destructive: {
                    DEFAULT: "#ef4444",
                    foreground: "#ffffff",
                },
                border: "#2e3248",
                input: "#22263a",
                ring: "#6366f1",
                success: "#22c55e",
            },
            borderRadius: {
                lg: "8px",
                md: "6px",
                sm: "4px",
            },
            fontFamily: {
                sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
            },
        },
    },
    plugins: [],
};

export default config;
