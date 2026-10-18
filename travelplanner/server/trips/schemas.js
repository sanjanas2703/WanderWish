// Input schemas for every trip operation, used by the website routes.
import { z } from "zod";
import { COUNTRY_COORDS } from "../../shared/data.js";

export const SLOTS = ["morning", "afternoon", "evening"];
export const TRAVEL_MODES = ["walk", "transit", "drive", "bicycle"];
export const BUDGETS = ["budget", "midrange", "luxury"];
export const PACES = ["relaxed", "balanced", "adventurous"];
export const INTERESTS = ["beach", "cultural", "nature", "food", "adventure", "wellness", "shopping", "nightlife", "family", "cold"];

const text = max => z.string().trim().max(max);
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(s => !isNaN(Date.parse(s + "T00:00:00Z")), "Invalid date");

// A stop as supplied by a caller. Unknown fields are dropped.
export const stopInput = z.object({
  title: text(120).min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  loc: text(200).optional(),
  desc: text(1000).optional(),
  dur: text(40).optional(),
  cost: text(40).optional(),
  localName: text(120).nullable().optional(),
  categories: z.array(text(80)).max(10).optional(),
  placeId: text(200).optional(),
  travelMode: z.enum(TRAVEL_MODES).optional(),
  custom: z.boolean().optional()
}).strict();

export const tripPrefs = z.object({
  country: z.string().refine(c => !!COUNTRY_COORDS[c], "Unknown country"),
  days: z.number().int().min(1).max(14),
  budget: z.enum(BUDGETS).default("midrange"),
  pace: z.enum(PACES).default("balanced"),
  types: z.array(z.enum(INTERESTS)).min(1).max(10).default(["cultural"]),
  startDate: isoDate.optional(),
  title: text(80).min(1).optional()
}).strict();

export const ops = {
  add_stop: z.object({
    day: z.number().int().min(1).max(14),
    slot: z.enum(SLOTS).default("evening"),
    index: z.number().int().min(0).optional(), // position within the slot; default = end
    stop: stopInput
  }).strict(),
  move_stop: z.object({
    stopId: uuid,
    toDay: z.number().int().min(1).max(14),
    toSlot: z.enum(SLOTS).optional(),          // default: keep the current slot
    toIndex: z.number().int().min(0).optional() // default: end of the slot
  }).strict(),
  remove_stop: z.object({ stopId: uuid }).strict(),
  set_note: z.object({ stopId: uuid, note: text(500) }).strict(), // "" clears the note
  rename_trip: z.object({ title: text(80).min(1) }).strict(),
  set_dates: z.object({ startDate: isoDate }).strict(),
  set_stop_details: z.object({
    stopId: uuid,
    details: z.object({
      title: text(120).min(1).optional(),
      desc: text(1000).optional(),
      dur: text(40).optional(),
      cost: text(40).optional(),
      loc: text(200).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
      travelMode: z.enum(TRAVEL_MODES).optional()
    }).strict().refine(d => Object.keys(d).length > 0, "Nothing to change")
      .refine(d => (d.lat === undefined) === (d.lon === undefined), "lat and lon must change together")
  }).strict()
};

export const commentInput = z.object({ stopId: z.string().min(1).max(200), text: text(500).min(1) }).strict();
export const expenseInput = z.object({
  description: text(120).min(1),
  amount: z.number().positive().max(9_999_999),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paidBy: z.number().int(),
  splitAmong: z.array(z.number().int()).min(1).max(50)
}).strict();
