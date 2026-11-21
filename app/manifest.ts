import type { MetadataRoute } from "next";

// PWA manifest in the logo palette. Browsers cache it and fetch it without
// a session, so it stays static; in-page colours follow Settings.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smart Cookie",
    short_name: "Smart Cookie",
    description: "Order healthy, home-cooked meals for your kids.",
    start_url: "/menu",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fbeeea",
    theme_color: "#fbeeea",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
