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

- **El envío se guarda; la deuda se pregunta.** `bookings.amount_due` es UN número
  —deuda + envío— congelado al armar el paquete. Nadie puede volver a separarlo, y la
  deuda se mueve después porque la clienta abona. Restarlo para sacar el envío falla
  siempre: a Monica Luna le salieron $900 de envío (era el precio de su ropa) y a
  Katia $1,145 (era su deuda, ya pagada). El envío vive en `bookings.envio`, que es el
  único dato del cobro que no sale de ninguna venta; la deuda se le pide a la venta
  cada vez, con `resumenDeCobro()`. **El envío NO entra a las finanzas ni al corte:**
  entregar no genera ningún pago, y así se queda. Ver
  `migrations/2026-11-25-el-envio-se-guarda.sql`.

- **`amount_due` de un paquete armado es una foto vieja.** Se escribe al armar y nadie
  la refresca: si la clienta paga entre que se arma y se entrega, la tarjeta del
  repartidor la sigue mandando a cobrar. Solo se actualiza volviendo a armar el
  paquete. Mientras siga así, lo que se enseñe en pantalla se calcula en vivo, no se
  lee de ahí.

- **Un modal no ve el estado de la pantalla que lo abre.** `CashboxHistoryModal` es un
  componente aparte, y adentro traía `{cobrosPendientes.length > 0 && <CobroPendiente/>}`,
  que es estado de la pantalla de Entregas. Dos daños de un solo renglón mal puesto:
  abrir "Ver historial de cortes" tumbaba la página con *cobrosPendientes is not
  defined*, y la pregunta "¿ya te pagó?" no podía salir nunca al entregar, porque solo
  se dibujaba dentro de un modal que ni se abría. Lo segundo es peor: sin preguntar,
  entregar se parece a cobrar. Los diálogos del negocio van en la pantalla, no dentro
  de otro modal.

- **Nunca borres una entrega que tenga productos adentro**
  (`sale_items.paquete_booking_id`): desarma el paquete sin que nadie se entere.

- **Las ventas que ya entraron a un corte de caja no se editan.** Ese dinero ya se contó.

- **No existe el saldo a favor.** Cancelar sigue penalizando el 15% y ese dinero se lo
  queda el negocio y entra al corte, igual que siempre. Lo que la clienta pagó de más
  se le devuelve EN EFECTIVO y no se apunta en ningún lado. El sistema lo acreditaba y
  nadie lo usaba nunca —ni una sola venta se pagó con saldo— mientras le prometía a la
  clienta un dinero que en la práctica se le entregaba a mano. La columna
  `clients.saldo_favor` quedó en cero para todas; no la vuelvas a llenar.

- **El lugar de una entrega se guarda, no se adivina cada vez.** `bookings.lat/lng`
  existían desde siempre y estaban vacías en las 318 entregas desde octubre, mientras el
  mapa del repartidor le mandaba a Google el TEXTO de la dirección —"Cto bosque de
  leopardo, Parajes del bosque 1"— para que adivinara. El 26 de noviembre la ruta se
  abrió de Los Ángeles a Cuba con los pines encimados: cuando Google no entiende,
  contesta el centro del país, y ese solo punto desencuadra el mapa entero. Lo resuelve
  `lib/ruta/coordenadas.js`, que prefiere el pin que mandó la clienta (`location_url`),
  lo sigue si es corto, y solo entonces pregunta por el texto acotado a La Laguna.
  **Lo que caiga fuera de la caja se descarta: es la respuesta de relleno de Google, no
  una dirección.** Se guarda una vez y `geoAddress()` en `lib/address.js` ya lo prefiere.
  Quien agregue otra pantalla con mapa usa ese módulo; no vuelve a geocodificar por su
  cuenta ni manda direcciones de texto a Maps.

- **El mapa de la ruta es un mapa, no una foto.** Era un `<img>` con
  `maps/api/staticmap`: el repartidor nunca lo pudo mover ni acercar y nadie se enteró
  hasta que lo dijo él. Vive en `app/panel/entregas/ruta/MapaDeLaRuta.js`. La foto quedó
  solo como respaldo para cuando no cargue Google en la calle. **Google Maps se carga con
  `lib/ruta/googleMaps.js` y nada más:** dos cargadores sobre la misma etiqueta `<script>`
  se pisan, y el segundo usa `window.google` antes de que exista.

- **No crees entregas de prueba con la fecha de hoy.** Le mueven la ruta al repartidor
  que está trabajando. Usa `scripts/fechaDePrueba.mjs`, que las manda 400 días adelante.
