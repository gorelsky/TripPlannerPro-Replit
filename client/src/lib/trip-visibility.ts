import type { City, TripWithDetails, User } from "@shared/schema";

const fullAccessRoles = new Set(["admin", "coordinator", "ceo", "deputy_ceo"]);
const departmentLeaderRoles = new Set([
  "marketing_director",
  "sales_director",
  "commerce_director",
  "commercial_manager",
  "hr_director",
]);

export function getVisibleEmployeeIds(
  user: User | null | undefined,
  users: User[],
  cities: City[],
) {
  if (!user) return new Set<string>();
  if (fullAccessRoles.has(user.role || "")) {
    return new Set(users.map((candidate) => candidate.id));
  }

  const visibleIds = new Set([user.id]);

  if (user.role === "territorial_manager") {
    const cityById = new Map(cities.map((city) => [city.id, city]));
    const subordinateRegions = users
      .filter((candidate) => candidate.managerId === user.id && candidate.homeCityId)
      .map((candidate) => cityById.get(candidate.homeCityId!)?.region?.trim().toLowerCase())
      .filter((region): region is string => Boolean(region));
    const ownRegion = user.homeCityId
      ? cityById.get(user.homeCityId)?.region?.trim().toLowerCase()
      : undefined;
    const regions = new Set(
      [ownRegion, ...subordinateRegions].filter((region): region is string => Boolean(region)),
    );

    if (regions.size > 0) {
      users.forEach((candidate) => {
        const region = candidate.homeCityId
          ? cityById.get(candidate.homeCityId)?.region?.trim().toLowerCase()
          : undefined;
        if (region && regions.has(region)) visibleIds.add(candidate.id);
      });
    } else {
      users
        .filter((candidate) => candidate.managerId === user.id)
        .forEach((candidate) => visibleIds.add(candidate.id));
    }
  } else if (departmentLeaderRoles.has(user.role || "") || user.role === "manager") {
    if (user.department) {
      users
        .filter((candidate) => candidate.department === user.department)
        .forEach((candidate) => visibleIds.add(candidate.id));
    } else {
      users
        .filter((candidate) => candidate.managerId === user.id)
        .forEach((candidate) => visibleIds.add(candidate.id));
    }
  }

  return visibleIds;
}

export function filterVisibleTrips(
  user: User | null | undefined,
  users: User[],
  cities: City[],
  trips: TripWithDetails[],
) {
  const visibleIds = getVisibleEmployeeIds(user, users, cities);
  return trips.filter((trip) => visibleIds.has(trip.employeeId));
}
