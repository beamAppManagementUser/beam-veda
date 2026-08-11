import { all } from "./db.js";

// shippedQty / remainingQty / status — computed live, never stored.
export async function withBalance(db, entry) {
  const shipments = await all(
    db,
    `SELECT number_of_pipes, outward_date FROM outward_shipments WHERE inward_id = ? ORDER BY outward_date DESC`,
    entry.id
  );
  const shippedQty = shipments.reduce((sum, s) => sum + s.number_of_pipes, 0);
  const remainingQty = entry.number_of_pipes - shippedQty;
  const status = remainingQty <= 0 ? "closed" : shippedQty > 0 ? "partial" : "open";
  const lastShipmentDate = shipments.length ? shipments[0].outward_date : null;
  return { ...entry, shippedQty, remainingQty, status, lastShipmentDate, shipmentCount: shipments.length };
}

export async function shippedQtyFor(db, inwardId, excludeShipmentId = null) {
  const rows = await all(
    db,
    excludeShipmentId
      ? `SELECT number_of_pipes FROM outward_shipments WHERE inward_id = ? AND id != ?`
      : `SELECT number_of_pipes FROM outward_shipments WHERE inward_id = ?`,
    ...(excludeShipmentId ? [inwardId, excludeShipmentId] : [inwardId])
  );
  return rows.reduce((sum, r) => sum + r.number_of_pipes, 0);
}
