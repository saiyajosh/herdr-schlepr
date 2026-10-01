export type NavigationCommand = "previous" | "next" | "page-previous" | "page-next" | "first" | "last";

export function navigateSelection(
  current: number,
  itemCount: number,
  command: NavigationCommand,
  pageSize = 8,
): number {
  if (itemCount <= 0) return 0;
  const last = itemCount - 1;
  switch (command) {
    case "previous":
      return current <= 0 ? last : current - 1;
    case "next":
      return current >= last ? 0 : current + 1;
    case "page-previous":
      return Math.max(0, current - pageSize);
    case "page-next":
      return Math.min(last, current + pageSize);
    case "first":
      return 0;
    case "last":
      return last;
  }
}
