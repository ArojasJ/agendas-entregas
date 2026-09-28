import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#020617",
};

// 🧠 Metadatos personalizados
export const metadata = {
  title: "Noreste CM | Agenda tus entregas fácilmente",
  description:
    "Sistema rápido y sencillo para agendar tus entregas a domicilio, bodega o paquetería en la Comarca Lagunera. Disponible 24/7.",
  metadataBase: new URL("https://www.norestecm.com"),
  openGraph: {
    title: "Noreste CM",
    description:
      "Agenda tus entregas en segundos. Domicilio, bodega y paquetería — todo en un solo lugar.",
    url: "https://www.norestecm.com",
    siteName: "Noreste CM",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "Noreste CM",
      },
    ],
    locale: "es_MX",
    type: "website",
  },
  icons: {
    icon: "/favicon-v2.ico",
    shortcut: "/favicon-v2.ico",
    apple: [{ url: "/logo.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Noreste CM",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

