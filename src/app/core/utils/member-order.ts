export interface OrderedMember {
  uid: string;
}

export function getSavedMemberOrder(uid: string): string[] {
  const value = localStorage.getItem(`sidebarOrder:${uid}`);
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

export function sortMembersBySavedOrder<T>(
  members: readonly T[],
  currentUid: string | null,
  getUid: (member: T) => string,
  fallbackCompare?: (a: T, b: T) => number,
): T[] {
  const me = currentUid ? members.find((member) => getUid(member) === currentUid) : undefined;
  const others = members.filter((member) => getUid(member) !== currentUid);
  const savedOrder = currentUid ? getSavedMemberOrder(currentUid) : [];
  const savedIndexes = new Map(savedOrder.map((memberId, index) => [memberId, index]));

  others.sort((a, b) => {
    const aIndex = savedIndexes.get(getUid(a));
    const bIndex = savedIndexes.get(getUid(b));
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return fallbackCompare?.(a, b) ?? 0;
  });

  return me ? [me, ...others] : others;
}

export function saveMemberOrder(uid: string, members: readonly OrderedMember[]): void {
  localStorage.setItem(
    `sidebarOrder:${uid}`,
    JSON.stringify(members.map((member) => member.uid)),
  );
}
