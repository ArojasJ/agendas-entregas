import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Noreste CM",
    short_name: "Noreste",
    description: "Sistema de entregas a domicilio",
    // iOS mata el PWA en segundo plano al salir a Google Maps y lo relanza en frío
    // desde start_url, así que apuntarlo al panel evita caer en la página pública.
    start_url: "/panel",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    orientation: "portrait",
    icons: [
      { src: "/logo.png", sizes: "any", type: "image/png" },
    ],
  };
}
