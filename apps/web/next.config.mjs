/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        typedRoutes: false
    },
    // Published sites are served at /{slug}/ and need their trailing slash (relative style.css,
    // script.js). middleware.ts restores the default /x/ -> /x redirect for app routes.
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
