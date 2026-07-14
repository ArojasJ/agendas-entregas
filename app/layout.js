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
  title: "Agéndalo TRC | Agenda tus entregas fácilmente",
  description:
    "Sistema rápido y sencillo para agendar tus entregas a domicilio, bodega o paquetería en la Comarca Lagunera. Disponible 24/7.",
  metadataBase: new URL("https://www.agendalotrc.com"),
  openGraph: {
    title: "Agéndalo TRC",
    description:
      "Agenda tus entregas en segundos. Domicilio, bodega y paquetería — todo en un solo lugar.",
    url: "https://www.agendalotrc.com",
    siteName: "Agéndalo TRC",
    images: [
      {
        url: "/logo.png",
                           // 👈 pon aquí tu imagen del logo o portada
        width: 1200,
        height: 630,
        alt: "Agéndalo TRC",
      },
    ],
    locale: "es_MX",
    type: "website",
  },
  icons: {
    icon: "/favicon-v2.ico",
    shortcut: "/favicon-v2.ico",
    apple: "/favicon-v2.ico",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TRC Entregas",
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

