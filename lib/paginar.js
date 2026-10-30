// Supabase devuelve como máximo 1000 filas por petición y no avisa cuando corta:
// una consulta sin paginar sobre una tabla grande entrega datos incompletos que
// parecen completos. Esto trae todas las páginas.
//
// Se le pasa una función que arma la consulta desde cero, porque el cliente de
// Supabase no deja reutilizar la misma instancia con otro rango.
export async function traerTodo(construir, pagina = 1000) {
  const todo = [];
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await construir().range(desde, desde + pagina - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    todo.push(...data);
    if (data.length < pagina) break;
  }
  return todo;
}
