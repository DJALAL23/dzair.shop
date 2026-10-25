import { countTrips } from "@/events/meter";

/** The D1 binding, counting each trip to the database: a statement run on its own, or a whole batch. */
export function countingD1(raw: D1Database) {
  let trips = 0;
  return { raw: countTrips(raw, () => (trips += 1)), trips: () => trips };
}
