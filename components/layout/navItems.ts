export interface NavItem {
  href: string;
  label: string;
  /** Not yet implemented — rendered with a SOON badge and no link target. */
  comingSoon?: boolean;
}

/**
 * Nav rows carry no icon: the "Score" sidebar marks state with a dot rather
 * than a glyph, so there is nothing to import here.
 */
export const navItems: NavItem[] = [
  { href: "/library", label: "Library" },
  { href: "/player", label: "Player", comingSoon: true },
  { href: "/practice", label: "Practice", comingSoon: true },
  { href: "/settings", label: "Settings", comingSoon: true },
];
