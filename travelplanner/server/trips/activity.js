// Activity feed: one row per change, written right after the change itself is saved.
import { insertActivity, listActivityRows } from "../store.js";

export function logActivity(tripId, userId, type, summary, data) {
  return insertActivity(tripId, userId, type, summary, data);
}

export function listActivity(tripId, limit = 50) {
  return listActivityRows(tripId, Math.min(200, limit));
}
