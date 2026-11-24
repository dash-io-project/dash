// Fixture data for the DocumentDB adapter tests.
// The script runs once, when the data directory is new.

db.revenue.insertMany([
  { month: "2026-01", amount: 10 },
  { month: "2026-02", amount: 20 },
  { month: "2026-03", amount: 15 },
]);

db.orders.insertMany([
  { id: 1, total: 10, status: "paid", region: "Europe", note: "first" },
  { id: 2, total: 25, status: "paid", region: "Europe", note: null },
  { id: 3, total: 5, status: "open", region: "Asia Pacific", note: "third" },
  { id: 4, total: 40, status: "paid", region: "North America", note: null },
  // note is omitted, not null, so a null filter can tell the two apart.
  { id: 5, total: 25, status: "hold", region: "Other" },
]);

db.createView("paid_orders", "orders", [
  { $match: { status: "paid" } },
  { $project: { _id: 0, id: 1, total: 1, status: 1, region: 1 } },
]);
