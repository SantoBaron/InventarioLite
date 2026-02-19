export function exportToXlsx(lines) {
  // Requiere que XLSX (SheetJS) esté cargado en window
  if (!window.XLSX) throw new Error("SheetJS (XLSX) no está cargado.");

  const rows = lines.map(l => ({
    UBICACION: l.ubicacion,
    REF_ARTICULO: l.ref,
    LOTE: l.lote ?? "",
    SUBLOTE: l.sublote ?? "",
    CANTIDAD: l.cantidad
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventario");

  const filename = `inventario_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
