# Reglas de la casa

Cosas que ya se rompieron una vez y no deberían romperse otra. No es documentación
del proyecto: es la lista corta de trampas conocidas.

## El "dónde está" se le pregunta al PRODUCTO, nunca a la venta

Hoy el lugar de la mercancía vive en dos tablas con dos reglas distintas:

| Dato | Dónde vive | Granularidad |
|---|---|---|
| Caja / Estante | `sales.ubicacion` + `sales.caja` | por compra |
| Paquete armado | `sale_items.paquete_booking_id` | por producto |

El paquete quedó por producto porque tenía que ser así: al armar un paquete se sacan
solo los productos que van a salir y los demás se quedan guardados. Caja y estante se
quedaron por compra, de antes.

**Mientras convivan las dos formas, cualquier pantalla que pregunte "¿este producto
tiene lugar?" mirando `sales.ubicacion` se va a equivocar con lo que ya está empacado.**

Ya pasó tres veces, y las tres se arreglaron por separado:

1. **Clientes** — mostraba en su caja cosas que ya estaban en un paquete
2. **Punto de venta** — lo mismo al sugerir dónde guardar
3. **Chequeo** — pedía ubicar la bufanda de una clienta que ya estaba empacada

El filtro correcto, como quedó en `app/api/panel/chequeo/route.js`:

```js
.is("sales.ubicacion", null)
.is("paquete_booking_id", null)   // lo que ya está en un paquete SÍ tiene lugar
```

Y para leer, `loQueTieneGuardado()` en `lib/ubicaciones.js` ya reparte bien: devuelve
`ubicacion: "paquete"` para lo empacado y el lugar de la venta solo para el resto. Si
necesitas saber dónde está algo, úsala en vez de leer `sales.ubicacion` a pelo.

### Por qué no se ha unificado

Mover el lugar a `sale_items` significa tocar ~403 ventas y ~89 puntos de código en 20
archivos, **sin que el negocio vea un solo cambio**: hoy no hay ninguna compra partida
entre dos lugares, así que copiar el lugar a cada producto daría el mismo resultado.
Todo el riesgo y cero beneficio visible.

Se hace el día que aparezca una compra que de verdad esté repartida en dos cajas.
Mientras tanto, basta con no volver a caer en la trampa.

## Otras reglas que ya costaron caro

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

- **No crees entregas de prueba con la fecha de hoy.** Le mueven la ruta al repartidor
  que está trabajando. Usa `scripts/fechaDePrueba.mjs`, que las manda 400 días adelante.
