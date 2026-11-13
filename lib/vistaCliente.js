// Lo que la clienta NO debe ver de sus propias compras.
//
// Un producto revendido o perdido está resuelto de nuestro lado, pero ella no lo
// recibió. Decirle "entregado" sería mentirle, y decirle el motivo es algo que se
// habla en persona, no en una pantalla.
//
// Se limpia aquí, antes de responder, y no al pintarlo: si solo se escondiera en la
// pantalla, el dato seguiría viajando y cualquiera podría verlo en la respuesta.
//
// Vive aparte para poder probarlo sin fabricar una sesión de clienta.
export function ocultarResolucion(ventas) {
  for (const venta of ventas || []) {
    for (const item of venta.sale_items || []) {
      if (item.resolucion) item.delivery_status = null;
      delete item.resolucion;
    }
  }
  return ventas;
}
