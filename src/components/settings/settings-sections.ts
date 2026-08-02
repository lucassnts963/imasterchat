import {
  Bell,
  CalendarClock,
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'push',
  'whatsapp',
  'templates',
  'quick-replies',
  'scheduling',
  'fields',
  'deals',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Rail grouping. `adminOnly` items are hidden for non-admins.
 * `labelKey` is a message key relative to the `Settings` namespace —
 * resolve it at render time with `useTranslations('Settings')`.
 */
export interface SectionMeta {
  id: SettingsSection;
  labelKey: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', labelKey: 'sections.overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', labelKey: 'sections.profile', icon: User, group: 'account' },
  security: { id: 'security', labelKey: 'sections.security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', labelKey: 'sections.appearance', icon: Palette, group: 'account' },
  push: { id: 'push', labelKey: 'sections.push', icon: Bell, group: 'account' },
  whatsapp: { id: 'whatsapp', labelKey: 'sections.whatsapp', icon: PlugZap, group: 'workspace' },
  templates: { id: 'templates', labelKey: 'sections.templates', icon: FileText, group: 'workspace' },
  'quick-replies': { id: 'quick-replies', labelKey: 'sections.quick-replies', icon: Zap, group: 'workspace' },
  scheduling: { id: 'scheduling', labelKey: 'sections.scheduling', icon: CalendarClock, group: 'workspace' },
  fields: { id: 'fields', labelKey: 'sections.fields', icon: Tags, group: 'workspace' },
  deals: { id: 'deals', labelKey: 'sections.deals', icon: Coins, group: 'workspace' },
  members: { id: 'members', labelKey: 'sections.members', icon: UsersRound, group: 'workspace' },
  api: { id: 'api', labelKey: 'sections.api', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { labelKey: string | null; group: SectionMeta['group'] }[] = [
  { labelKey: null, group: 'top' },
  { labelKey: 'groups.account', group: 'account' },
  { labelKey: 'groups.workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
