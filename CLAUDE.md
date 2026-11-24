# Reglas de la casa

Cosas que ya se rompieron una vez y no deberían romperse otra. No es documentación
del proyecto: es la lista corta de trampas conocidas.

## El "dónde está" se le pregunta al PRODUCTO, nunca a la venta

El lugar de la mercancía vive en el producto:

| Dato | Dónde vive |
|---|---|
| Caja / Estante | `sale_items.ubicacion` + `sale_items.caja` |
| Paquete armado | `sale_items.paquete_booking_id` |

`sales.ubicacion` sigue existiendo y sigue siendo lo que escribe la aplicación —hay
seis lugares que lo hacen—, pero ya no es de donde se lee. Dos disparadores lo bajan
al producto: `trg_bajar_lugar_a_los_productos` cuando cambia la venta, y
`trg_heredar_lugar_de_la_compra` cuando se agrega un producto. Ver la migración
`2026-11-14-lugar-por-producto.sql`.

**El día que una pantalla guarde el lugar de UN producto por su cuenta, el disparador
se lo borraría en la siguiente escritura de la venta: ese día hay que quitarlo y dejar
de escribir `sales.ubicacion`.**

Ya se equivocaron tres pantallas preguntándole el lugar a la venta, y las tres se
arreglaron por separado:

1. **Clientes** — mostraba en su caja cosas que ya estaban en un paquete
2. **Punto de venta** — lo mismo al sugerir dónde guardar
3. **Chequeo** — pedía ubicar la bufanda de una clienta que ya estaba empacada

El filtro correcto, como quedó en `app/api/panel/chequeo/route.js`:

```js
.is("sales.ubicacion", null)
.is("paquete_booking_id", null)   // lo que ya está en un paquete SÍ tiene lugar
```

Y para leer, usa `loQueTieneGuardado()` en `lib/ubicaciones.js` en vez de mirar
`sales.ubicacion` a pelo: devuelve `ubicacion: "paquete"` para lo empacado, agrupa por
lugar real y ya sabe enseñar una compra repartida en dos cajas.

La única excepción es `pendientes_sacar`, que guarda caja y ubicación **congeladas**:
ahí el producto ya dejó de pertenecer a la venta, así que preguntarle a la venta
mandaría a la bodega a la caja donde esa compra esté hoy y no a donde quedó la
mercancía. Ver `migrations/2026-11-24-sacar-de-la-bodega.sql`.

## Otras reglas que ya costaron caro

- **Quitar un producto de una venta no lo saca de la caja.** El renglón se borra y el
  producto vuelve a existencias, pero la mercancía sigue guardada: apartada a nombre de
  quien ya no la compró y, como el sistema la da por disponible, vendible por error.
  Quien quita el producto casi nunca es quien va por él, ni el mismo día ni desde el
  mismo aparato, así que el recado se escribe en `pendientes_sacar` y sale en la
  Bitácora hasta que alguien lo palomee. Vive en `editarVenta()`.

- **Entregar no es cobrar.** Marcar entregado el último producto de una venta a crédito
  no la liquida. Solo se cierra si el dinero ya estaba registrado; si sigue debiendo, se
  pregunta. El código viejo subía `down_payment` al total y borraba la deuda sin que
  nadie se enterara: 56 ventas quedaron así, y el enganche original ya no se puede
  recuperar. Vive en `liquidarSiYaSalioTodo()`.

- **La fecha de entrega la pone la base, no la aplicación.** Hay demasiados lugares que
  marcan entregado como para confiar en que todos se acuerden; el disparador
  `trg_marcar_cuando_se_entrego` lo resuelve. **Ojo: solo corre al ACTUALIZAR.** En un
  alta hay que poner la fecha a mano — ver `comoNaceElProducto()`.

- **Una venta sin clienta nace entregada.** En el mostrador la venta y la entrega son el
  mismo acto. Si nace pendiente, nadie la va a marcar nunca.

- **El doble cobro de envío solo lo dispara un domicilio fallido.** Es el viaje perdido
  lo que se vuelve a cobrar. Antes contaba todos los tipos y le cobraba $90 a quien no
  había pasado a recoger a bodega. Vive en `lib/penalizacionEnvio.js`.

- **Nunca borres una entrega que tenga productos adentro**
  (`sale_items.paquete_booking_id`): desarma el paquete sin que nadie se entere.

- **Las ventas que ya entraron a un corte de caja no se editan.** Ese dinero ya se contó.

- **No existe el saldo a favor.** Cancelar sigue penalizando el 15% y ese dinero se lo
  queda el negocio y entra al corte, igual que siempre. Lo que la clienta pagó de más
  se le devuelve EN EFECTIVO y no se apunta en ningún lado. El sistema lo acreditaba y
  nadie lo usaba nunca —ni una sola venta se pagó con saldo— mientras le prometía a la
  clienta un dinero que en la práctica se le entregaba a mano. La columna
  `clients.saldo_favor` quedó en cero para todas; no la vuelvas a llenar.

- **No crees entregas de prueba con la fecha de hoy.** Le mueven la ruta al repartidor
  que está trabajando. Usa `scripts/fechaDePrueba.mjs`, que las manda 400 días adelante.
