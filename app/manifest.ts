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
    lang: "es-MX",
    // Android pide un icono de 192 y uno de 512 para ofrecer instalarla; con un solo
    // PNG de sizes:"any" no siempre cuenta, y ese archivo pesa 752 KB. Estos son el
    // mismo logo redimensionado: 14 KB y 111 KB.
    //
    // El maskable es aparte a propósito: Android recorta el icono a la forma del
    // sistema —círculo, cuadrado redondeado— y sin uno declarado le dibuja un recuadro
    // blanco alrededor para no cortar nada.
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // El repartidor llega a su ruta sin pasar por el menú: se deja apretado el icono y
    // ahí está. start_url se queda en /panel porque la app la usan todos, no solo él.
    shortcuts: [
      { name: "Ruta del día", short_name: "Ruta", url: "/panel/entregas/ruta" },
      { name: "Entregas", short_name: "Entregas", url: "/panel/entregas" },
      { name: "Nueva venta", short_name: "Vender", url: "/panel/pos" },
    ],
  };
}
