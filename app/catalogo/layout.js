import { CartProvider } from "./CartProvider";

export default function CatalogoLayout({ children }) {
  return <CartProvider>{children}</CartProvider>;
}
