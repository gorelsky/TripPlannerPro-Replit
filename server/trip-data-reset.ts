export type TripDataResetCounts = {
  trips: number;
  approvals: number;
  chatMessages: number;
  contactMessages: number;
};

export const TRIP_DATA_RESET_TABLES = ["trips", "approvals", "chatMessages"] as const;
export const TRIP_DATA_RESET_PRESERVED_TABLES = [
  "users", "cities", "routes", "holidays", "dailyAllowance", "contactMessages",
] as const;

export function buildTripDataResetPreview(counts: TripDataResetCounts) {
  return {
    counts,
    deleted: TRIP_DATA_RESET_TABLES,
    preserved: TRIP_DATA_RESET_PRESERVED_TABLES,
  };
}
