import { Library, Music4, Settings, Dumbbell } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Not yet implemented — rendered disabled. */
  comingSoon?: boolean;
}

export const navItems: NavItem[] = [
  { href: "/library", label: "Library", icon: Library },
  { href: "/player", label: "Player", icon: Music4, comingSoon: true },
  { href: "/practice", label: "Practice", icon: Dumbbell, comingSoon: true },
  { href: "/settings", label: "Settings", icon: Settings, comingSoon: true },
];
