const fs = require('fs');
const files = [
  'app/panel/ventas/[id]/page.js',
  'app/panel/ventas/page.js',
  'app/panel/inventario/page.js',
  'app/panel/clientes/page.js',
  'app/api/products/stats/route.js'
];
files.forEach(f => {
  if(fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    // Reemplazar \` por `
    content = content.replace(/\\\`/g, '`');
    // Reemplazar \$ por $
    content = content.replace(/\\\$/g, '$');
    fs.writeFileSync(f, content);
    console.log('Fixed', f);
  }
});
