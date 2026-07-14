import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TRC Entregas",
    short_name: "TRC",
    description: "Sistema de entregas a domicilio",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    orientation: "portrait",
    icons: [
      { src: "/logo.png", sizes: "any", type: "image/png" },
    ],
  };
}
