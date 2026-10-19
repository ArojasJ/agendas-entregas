import Link from "next/link";

export const NEGOCIO = {
  responsable: "Antonio Rojas",
  marca: "Noreste Clothes & More",
  domicilio: "Aguamarina 929 Pte., Col. Rosales, Gómez Palacio, Durango, C.P. 35020",
  whatsapp: "871 480 9146",
  whatsappLink: "5218714809146",
  instagram: "@noresteclothesandmore",
  sitio: "www.norestecm.com",
};

export function LegalLayout({ titulo, actualizado, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-5 py-10 md:py-16">
        <Link href="/catalogo" className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors">
          ← Volver al catálogo
        </Link>

        <h1 className="text-3xl md:text-4xl font-black text-slate-900 mt-6 leading-tight">{titulo}</h1>
        <p className="text-sm text-slate-400 mt-2">Última actualización: {actualizado}</p>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-slate-700">
          {children}
        </div>

        <div className="mt-12 pt-6 border-t border-slate-200 text-sm text-slate-500 space-y-1">
          <p className="font-bold text-slate-700">{NEGOCIO.marca}</p>
          <p>{NEGOCIO.responsable}</p>
          <p>{NEGOCIO.domicilio}</p>
          <p>
            WhatsApp{" "}
            <a href={`https://wa.me/${NEGOCIO.whatsappLink}`} className="font-semibold text-slate-700 underline">
              {NEGOCIO.whatsapp}
            </a>{" "}
            · Instagram{" "}
            <a href={`https://instagram.com/${NEGOCIO.instagram.replace("@", "")}`} className="font-semibold text-slate-700 underline">
              {NEGOCIO.instagram}
            </a>
          </p>
        </div>

        <div className="mt-6 flex gap-4 text-sm">
          <Link href="/terminos-y-condiciones" className="font-bold text-slate-600 hover:text-slate-900">
            Términos y Condiciones
          </Link>
          <Link href="/aviso-de-privacidad" className="font-bold text-slate-600 hover:text-slate-900">
            Aviso de Privacidad
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Seccion({ titulo, children }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-lg font-black text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

export function Lista({ items }) {
  return (
    <ul className="space-y-1.5 pl-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="text-slate-300 shrink-0">—</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
