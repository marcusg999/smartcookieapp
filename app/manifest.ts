import type { MetadataRoute } from "next";

// PWA manifest. Name, colours and icons are placeholders; theme/background
// colours will be pulled from site_settings once branding is in the CMS.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smart Cookie",
    short_name: "Smart Cookie",
    description: "Order healthy, home-cooked meals for your kids.",
    start_url: "/menu",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdf6e9",
    theme_color: "#c2410c",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
