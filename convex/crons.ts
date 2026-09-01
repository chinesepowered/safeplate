import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Menus change. A dish the kitchen confirmed safe in March may be cooked in a
 * shared fryer by June, so a saved restaurant is re-scraped weekly: if the dish
 * list has changed, the review runs again and the card raises a "menu changed"
 * badge rather than leaving a stale green pin a parent would trust.
 */
const crons = cronJobs();

crons.weekly(
  "weekly menu re-scan",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.menu.rescanAll,
  {},
);

export default crons;
