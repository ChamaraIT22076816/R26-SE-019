/**
 * SoundGuard — Color Palette
 * A dark-first design system optimized for battery life,
 * reduced eye strain, and high accessibility contrast ratios.
 */

// Primary accent — a vibrant cyan-teal that pops against deep blacks
const accent = '#00E5CC';
const accentMuted = '#00B8A3';

// Urgent / SOS red
const urgent = '#FF4C6E';
const urgentMuted = '#CC3D58';

// Surface hierarchy (darkest → lightest)
const black = '#000000';
const surface0 = '#0A0A0F'; // App background
const surface1 = '#12121A'; // Card / elevated surface
const surface2 = '#1A1A26'; // Secondary surface
const surface3 = '#242433'; // Borders, dividers
const surface4 = '#2E2E40'; // Hover / pressed states

// Text hierarchy
const textPrimary = '#F0F0F5';
const textSecondary = '#9B9BB0';
const textTertiary = '#64647A';

export const theme = {
  colors: {
    // Backgrounds
    background: surface0,
    surface: surface1,
    surfaceElevated: surface2,
    border: surface3,
    borderLight: surface4,

    // Accents
    accent,
    accentMuted,
    urgent,
    urgentMuted,

    // Text
    text: textPrimary,
    textSecondary,
    textTertiary,

    // Tab bar
    tabBar: surface1,
    tabBarBorder: surface3,
    tabIconDefault: textTertiary,
    tabIconSelected: accent,

    // Status bar
    statusBar: black,

    // Misc
    black,
    white: '#FFFFFF',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },

  // Font sizes — large & legible for accessibility
  fontSizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
    hero: 40,
  },

  // Spacing scale
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },

  // Border radius
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 999,
  },
};

// Legacy export for compatibility with Themed.tsx
export default {
  light: {
    text: theme.colors.text,
    background: theme.colors.background,
    tint: theme.colors.accent,
    tabIconDefault: theme.colors.tabIconDefault,
    tabIconSelected: theme.colors.tabIconSelected,
  },
  dark: {
    text: theme.colors.text,
    background: theme.colors.background,
    tint: theme.colors.accent,
    tabIconDefault: theme.colors.tabIconDefault,
    tabIconSelected: theme.colors.tabIconSelected,
  },
};
